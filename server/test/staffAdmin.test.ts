import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MemorySheetStore, ValetSheetsRepository } from '@valet/sheets-integration';
import { createApp } from '../src/app.js';
import { UserDirectory } from '../src/auth.js';
import { LocalPhotoStore } from '../src/photos.js';
import { DEMO_PASSWORD, seedLocations, seedUsers } from '../src/seed.js';

const dir = mkdtempSync(join(tmpdir(), 'valet-staff-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let app: ReturnType<typeof createApp>;
let repo: ValetSheetsRepository;
let users: UserDirectory;
let clock: Date;

async function signIn(username: string, password = DEMO_PASSWORD) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  return { res, auth: `Bearer ${res.body.token as string}` };
}
const as = (auth: string) => ({
  get: (path: string) => request(app).get(`/api${path}`).set('Authorization', auth),
  post: (path: string, body: object = {}) => request(app).post(`/api${path}`).set('Authorization', auth).send(body),
  put: (path: string, body: object) => request(app).put(`/api${path}`).set('Authorization', auth).send(body),
  del: (path: string) => request(app).delete(`/api${path}`).set('Authorization', auth),
});

beforeEach(async () => {
  clock = new Date('2026-10-25T09:00:00.000Z');
  const now = () => new Date(clock);
  repo = new ValetSheetsRepository({ store: new MemorySheetStore(), pinSecret: 'pin', flushIntervalMs: 0, now });
  await repo.load();
  seedLocations(repo);
  users = new UserDirectory('auth', [], () => clock.getTime());
  seedUsers(users);
  app = createApp({ repo, users, photos: new LocalPhotoStore(dir), authSecret: 'auth', publicBaseUrl: 'https://valet.example', now });
});

describe('staff accounts', () => {
  it('admin creates a user who must choose their own password before using the app', async () => {
    const admin = as((await signIn('admin')).auth);
    const loc = repo.listLocations()[0]!;
    const created = await admin.post('/staff/users', { username: 'Kiran', name: 'Kiran', role: 'attendant', locations: [loc.id], password: 'Start-pass-123' });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ username: 'kiran', role: 'attendant', roleName: 'Attendant', mustChangePassword: true, locations: [loc.id] });
    expect(created.body.passwordHash).toBeUndefined();

    const { res, auth } = await signIn('kiran', 'Start-pass-123');
    expect(res.body.user.mustChangePassword).toBe(true);
    const kiran = as(auth);
    // Only "who am I" and the password change are allowed until then.
    expect((await kiran.get('/me')).status).toBe(200);
    const blocked = await kiran.get(`/locations/${loc.id}/tickets`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    expect((await kiran.post('/auth/change-password', { currentPassword: 'wrong', newPassword: 'My-own-password-1' })).status).toBe(400);
    expect((await kiran.post('/auth/change-password', { currentPassword: 'Start-pass-123', newPassword: 'short' })).body.error).toMatch(/at least 10/);
    const changed = await kiran.post('/auth/change-password', { currentPassword: 'Start-pass-123', newPassword: 'My-own-password-1' });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);

    // The old session ends; the new token works; the old password no longer does.
    expect((await kiran.get('/me')).status).toBe(401);
    expect((await as(`Bearer ${changed.body.token as string}`).get(`/locations/${loc.id}/tickets`)).status).toBe(200);
    expect((await signIn('kiran', 'Start-pass-123')).res.status).toBe(401);
    expect((await signIn('kiran', 'My-own-password-1')).res.status).toBe(200);
  });

  it('admin resets a password and switches an account off, ending its sessions', async () => {
    const admin = as((await signIn('admin')).auth);
    const ravi = await signIn('attendant');
    const id = users.list().find((u) => u.username === 'attendant')!.id;

    expect((await admin.post(`/staff/users/${id}/password`, { password: 'Reset-pass-456' })).body.mustChangePassword).toBe(true);
    expect((await as(ravi.auth).get('/me')).status).toBe(401);
    expect((await signIn('attendant', 'Reset-pass-456')).res.status).toBe(200);

    expect((await admin.put(`/staff/users/${id}`, { disabled: true })).status).toBe(200);
    const off = await signIn('attendant', 'Reset-pass-456');
    expect(off.res.status).toBe(403);
    expect(off.res.body.error).toMatch(/switched off/);
    await admin.put(`/staff/users/${id}`, { disabled: false });
    expect((await signIn('attendant', 'Reset-pass-456')).res.status).toBe(200);
  });

  it("operator admins can't create or touch platform admins, or give locations they don't have", async () => {
    const loc = repo.listLocations()[0]!;
    const admin = as((await signIn('admin')).auth);
    expect((await admin.post('/staff/users', { username: 'boss', name: 'Boss', role: 'platform_admin', locations: 'all', password: 'Start-pass-123' })).status).toBe(403);
    const platformId = users.list().find((u) => u.role === 'platform_admin')!.id;
    expect((await admin.post(`/staff/users/${platformId}/password`, { password: 'Taken-over-123' })).status).toBe(403);
    expect((await admin.get('/staff/users')).body.find((u: { id: string }) => u.id === platformId).manageable).toBe(false);

    // A location-limited admin can only hand out their own locations.
    const limited = await admin.post('/staff/users', { username: 'mgr', name: 'Manager', role: 'operator_admin', locations: [loc.id], password: 'Start-pass-123' });
    expect(limited.status).toBe(200);
    const first = await signIn('mgr', 'Start-pass-123');
    const changed = await as(first.auth).post('/auth/change-password', { currentPassword: 'Start-pass-123', newPassword: 'Mgr-own-pass-1' });
    const mgr = as(`Bearer ${changed.body.token as string}`);
    expect((await mgr.post('/staff/users', { username: 'att1', name: 'A One', role: 'attendant', locations: 'all', password: 'Start-pass-123' })).status).toBe(403);
    expect((await mgr.post('/staff/users', { username: 'att1', name: 'A One', role: 'attendant', locations: [loc.id], password: 'Start-pass-123' })).status).toBe(200);
  });

  it("attendants can't manage staff, and admins can't lock themselves out", async () => {
    const attendant = as((await signIn('attendant')).auth);
    expect((await attendant.get('/staff/users')).status).toBe(403);
    const admin = as((await signIn('admin')).auth);
    const me = users.list().find((u) => u.username === 'admin')!.id;
    expect((await admin.put(`/staff/users/${me}`, { disabled: true })).status).toBe(400);
    expect((await admin.put(`/staff/users/${me}`, { role: 'attendant' })).status).toBe(400);
    expect((await admin.del(`/staff/users/${me}`)).status).toBe(400);
  });

  it('rejects duplicate usernames, unknown locations and weak passwords', async () => {
    const admin = as((await signIn('admin')).auth);
    expect((await admin.post('/staff/users', { username: 'ATTENDANT', name: 'Dup', role: 'attendant', locations: 'all', password: 'Start-pass-123' })).status).toBe(409);
    expect((await admin.post('/staff/users', { username: 'new1', name: 'New', role: 'attendant', locations: ['nowhere'], password: 'Start-pass-123' })).status).toBe(404);
    expect((await admin.post('/staff/users', { username: 'new1', name: 'New', role: 'attendant', locations: 'all', password: 'new1' })).status).toBe(400);
  });
});

describe('custom roles', () => {
  it('admin defines a role with chosen permissions, and it applies to its users', async () => {
    const admin = as((await signIn('admin')).auth);
    const role = await admin.post('/staff/roles', { name: 'Night supervisor', permissions: ['tickets.view', 'tickets.request_car', 'tasks.accept', 'handover.hand_over', 'reports.view'] });
    expect(role.status).toBe(200);
    expect(role.body).toMatchObject({ id: 'custom-night-supervisor', builtIn: false });

    await admin.post('/staff/users', { username: 'nina', name: 'Nina', role: 'custom-night-supervisor', locations: 'all', password: 'Start-pass-123' });
    const first = await signIn('nina', 'Start-pass-123');
    expect(first.res.body.user.roleName).toBe('Night supervisor');
    const changed = await as(first.auth).post('/auth/change-password', { currentPassword: 'Start-pass-123', newPassword: 'Nina-own-pass-1' });
    const nina = as(`Bearer ${changed.body.token as string}`);
    const loc = repo.listLocations()[0]!;
    expect((await nina.get(`/locations/${loc.id}/dashboard`)).status).toBe(200);
    // Not ticked, so refused.
    expect((await nina.get(`/locations/${loc.id}/payments/pending`)).status).toBe(403);

    // Changing the role changes what its users can do straight away.
    await admin.put('/staff/roles/custom-night-supervisor', { permissions: ['tickets.view', 'payments.verify'] });
    expect((await nina.get(`/locations/${loc.id}/payments/pending`)).status).toBe(200);
    expect((await nina.get(`/locations/${loc.id}/dashboard`)).status).toBe(200);

    // A role in use can't be deleted.
    expect((await admin.del('/staff/roles/custom-night-supervisor')).status).toBe(409);
  });

  it("refuses permissions the admin doesn't have, and changes to built-in roles", async () => {
    const admin = as((await signIn('admin')).auth);
    const res = await admin.post('/staff/roles', { name: 'Approver', permissions: ['payment_qr.approve'] });
    expect(res.status).toBe(403);
    expect((await admin.put('/staff/roles/attendant', { permissions: ['tickets.view'] })).status).toBe(400);
    expect((await admin.post('/staff/roles', { name: 'Attendant', permissions: ['tickets.view'] })).status).toBe(409);
    const roles = await admin.get('/staff/roles');
    expect(roles.body.permissions.find((p: { id: string }) => p.id === 'payment_qr.approve').grantable).toBe(false);
  });
});

describe('saving accounts', () => {
  it('copies STAFF_USERS_FILE on first start, then keeps changes made in the app', () => {
    const bootstrap = join(dir, 'staff-users.json');
    const saved = join(dir, 'staff.json');
    const seeded = new UserDirectory('auth');
    seedUsers(seeded);
    writeFileSync(bootstrap, JSON.stringify(seeded.list()));

    const first = UserDirectory.open('auth', saved, bootstrap);
    expect(first.source).toBe('bootstrap');
    expect(existsSync(saved)).toBe(true);
    const admin = first.users.list().find((u) => u.username === 'admin')!;
    const withPerms = { ...admin, permissions: first.users.permissionsFor(admin.role) };
    first.users.createRole(withPerms, { name: 'Valet lead', permissions: ['tickets.view'] });
    first.users.createUser(withPerms, { username: 'lead1', name: 'Lead', role: 'custom-valet-lead', locations: 'all', password: 'Start-pass-123' });
    const id = first.users.list().find((u) => u.username === 'lead1')!.id;
    first.users.changeOwnPassword(id, 'Start-pass-123', 'Changed-pass-99');

    // A restart reads the saved file, not the bootstrap one.
    const second = UserDirectory.open('auth', saved, bootstrap);
    expect(second.source).toBe('saved');
    expect(second.users.roles().some((r) => r.id === 'custom-valet-lead')).toBe(true);
    expect('token' in second.users.login('lead1', 'Changed-pass-99')).toBe(true);
    expect('token' in second.users.login('lead1', 'Start-pass-123')).toBe(false);
    expect(readFileSync(saved, 'utf8')).not.toContain('Changed-pass-99');
  });
});
