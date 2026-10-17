import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MemorySheetStore, ValetSheetsRepository, type LocationRow } from '@valet/sheets-integration';
import { createApp } from '../src/app.js';
import { hashPassword, UserDirectory } from '../src/auth.js';
import { LocalPhotoStore } from '../src/photos.js';
import { DEMO_PASSWORD, seedLocations, seedUsers } from '../src/seed.js';

const uploads = mkdtempSync(join(tmpdir(), 'valet-uploads-'));
afterAll(() => rmSync(uploads, { recursive: true, force: true }));

// 1×1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let app: ReturnType<typeof createApp>;
let repo: ValetSheetsRepository;
let users: UserDirectory;
let clock: Date;

async function login(username: string) {
  const res = await request(app).post('/api/auth/login').send({ username, password: DEMO_PASSWORD });
  expect(res.status).toBe(200);
  return `Bearer ${res.body.token as string}`;
}

function byProfile(profile: LocationRow['service_profile']): LocationRow {
  const l = repo.listLocations().find((x) => x.service_profile === profile);
  if (!l) throw new Error(profile);
  return l;
}

beforeEach(async () => {
  clock = new Date('2026-10-17T12:00:00.000Z');
  const now = () => new Date(clock);
  repo = new ValetSheetsRepository({ store: new MemorySheetStore(), pinSecret: 'pin', flushIntervalMs: 0, now });
  await repo.load();
  seedLocations(repo);
  users = new UserDirectory('auth', [], () => clock.getTime());
  seedUsers(users);
  app = createApp({ repo, users, photos: new LocalPhotoStore(uploads), authSecret: 'auth', publicBaseUrl: 'https://valet.example', now });
});

describe('auth and permissions', () => {
  it('rejects requests without a token and wrong passwords', async () => {
    expect((await request(app).get('/api/locations')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ username: 'admin', password: 'nope' })).status).toBe(401);
  });

  it('locks an account after 5 failed sign-ins', async () => {
    for (let i = 0; i < 4; i++) await request(app).post('/api/auth/login').send({ username: 'admin', password: 'bad' });
    expect((await request(app).post('/api/auth/login').send({ username: 'admin', password: 'bad' })).status).toBe(423);
    expect((await request(app).post('/api/auth/login').send({ username: 'admin', password: DEMO_PASSWORD })).status).toBe(423);
    clock = new Date(clock.getTime() + 16 * 60_000);
    expect((await request(app).post('/api/auth/login').send({ username: 'admin', password: DEMO_PASSWORD })).status).toBe(200);
  });

  it('lets only admins change settings', async () => {
    const loc = byProfile('restaurant');
    const attendant = await login('attendant');
    const admin = await login('admin');
    expect((await request(app).put(`/api/locations/${loc.id}/settings`).set('Authorization', attendant).send({ spotGps: 'off' })).status).toBe(403);
    const ok = await request(app).put(`/api/locations/${loc.id}/settings`).set('Authorization', admin).send({ spotGps: 'optional', spotPhoto: 'optional' });
    expect(ok.status).toBe(200);
    expect(ok.body.spotGps).toBe('optional');
    const bad = await request(app).put(`/api/locations/${loc.id}/settings`).set('Authorization', admin).send({ spotText: 'off', spotGps: 'off', spotPhoto: 'off' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/FR-PARK-11/);
  });

  it('blocks staff from locations they are not assigned to', async () => {
    const loc = byProfile('restaurant');
    users.add({ id: 'u-x', username: 'other', name: 'Other', role: 'attendant', locations: ['elsewhere'], passwordHash: hashPassword(DEMO_PASSWORD) });
    const other = await login('other');
    expect((await request(app).get(`/api/locations/${loc.id}/tickets`).set('Authorization', other)).status).toBe(403);
  });
});

describe('restaurant flow: check-in to handover via the guest page', () => {
  it('runs the whole journey', async () => {
    const loc = byProfile('restaurant');
    const attendant = await login('attendant');
    const attendant2 = await login('attendant2');

    const up = await request(app).post('/api/uploads').set('Authorization', attendant).send({ dataUrl: PNG });
    expect(up.status).toBe(200);

    const checkIn = await request(app)
      .post(`/api/locations/${loc.id}/tickets`)
      .set('Authorization', attendant)
      .send({ plateNumber: 'KA01AB1234', keyTag: 'K-7', guestMobile: '+919876543210', vehiclePhotoRefs: [up.body.fileRef] });
    expect(checkIn.status).toBe(200);
    const { ticket, handoverPin, guestLink } = checkIn.body as { ticket: { id: string; guest_mobile: string; photos: Array<{ url: string }> }; handoverPin: string; guestLink: string };
    expect(ticket.guest_mobile).toBe('••••••3210');
    expect(ticket).not.toHaveProperty('handover_pin_hash');
    expect(guestLink).toMatch(/^https:\/\/valet\.example\/t\//);
    const token = guestLink.split('/t/')[1] as string;

    const photo = await request(app).get(ticket.photos[0]?.url ?? '');
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toBe('image/png');

    const noGps = await request(app).post(`/api/tickets/${ticket.id}/spot`).set('Authorization', attendant).send({ text: 'Lane 3, near the tree' });
    expect(noGps.status).toBe(200);
    expect(noGps.body.warnings[0]).toMatch(/No GPS/);

    const page = await request(app).get(`/api/guest/${token}`);
    expect(page.body).toMatchObject({ appName: 'ValetPay', status: 'parked', fee: 0, arrivalTimeRequest: true });

    clock = new Date(clock.getTime() + 90 * 60_000);
    const req = await request(app).post(`/api/guest/${token}/request`).send({ arriveInMinutes: 10 });
    expect(req.status).toBe(200);
    expect(req.body.etaMinutes).toBe(10);

    let queue = await request(app).get(`/api/locations/${loc.id}/queue`).set('Authorization', attendant2);
    expect(queue.body.queue).toHaveLength(0);
    clock = new Date(clock.getTime() + 3 * 60_000);
    queue = await request(app).get(`/api/locations/${loc.id}/queue`).set('Authorization', attendant2);
    expect(queue.body.queue).toHaveLength(1);
    const taskId = queue.body.queue[0].task.id as string;

    const [a, b] = await Promise.all([
      request(app).post(`/api/tasks/${taskId}/accept`).set('Authorization', attendant2),
      request(app).post(`/api/tasks/${taskId}/accept`).set('Authorization', attendant),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const holder = a.status === 200 ? attendant2 : attendant;

    expect((await request(app).post(`/api/tickets/${ticket.id}/ready`).set('Authorization', holder)).status).toBe(200);
    const wrongPin = handoverPin === '0000' ? '1111' : '0000';
    expect((await request(app).post(`/api/tickets/${ticket.id}/verify`).set('Authorization', holder).send({ pin: wrongPin })).body.verified).toBe(false);
    expect((await request(app).post(`/api/tickets/${ticket.id}/verify`).set('Authorization', holder).send({ qrToken: guestLink })).body.verified).toBe(true);

    expect((await request(app).post(`/api/tickets/${ticket.id}/handover`).set('Authorization', holder).send({})).status).toBe(409);
    expect((await request(app).post(`/api/guest/${token}/confirm`).send({ result: 'no_damage' })).status).toBe(200);
    const done = await request(app).post(`/api/tickets/${ticket.id}/handover`).set('Authorization', holder).send({});
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('closed');

    const rated = await request(app).post(`/api/guest/${token}/rating`).send({ rating: 5 });
    expect(rated.body.rating).toBe(5);
    clock = new Date(clock.getTime() + 8 * 86_400_000);
    expect((await request(app).get(`/api/guest/${token}`)).status).toBe(410);
  });
});

describe('payment QR', () => {
  it('needs platform approval before guests see it, and QR payments need verification', async () => {
    const loc = byProfile('paid_parking');
    const admin = await login('admin');
    const platform = await login('platform');
    const attendant = await login('attendant');
    const supervisor = await login('supervisor');

    expect((await request(app).put(`/api/locations/${loc.id}/payment-qr`).set('Authorization', admin).send({ imageDataUrl: PNG, payeeName: 'City Centre Parking' })).status).toBe(200);
    expect((await request(app).get('/api/payment-qr/pending').set('Authorization', admin)).status).toBe(403);
    expect((await request(app).get('/api/payment-qr/pending').set('Authorization', platform)).body).toHaveLength(1);

    const checkIn = await request(app).post(`/api/locations/${loc.id}/tickets`).set('Authorization', attendant).send({ plateNumber: 'MH01ZZ1', keyTag: 'K1' });
    const token = (checkIn.body.guestLink as string).split('/t/')[1] as string;
    await request(app).post(`/api/tickets/${checkIn.body.ticket.id}/spot`).set('Authorization', attendant).send({ zoneCode: 'A', slotNumber: '3' });
    expect((await request(app).get(`/api/guest/${token}`)).body.paymentQr).toBeNull();

    await request(app).post(`/api/locations/${loc.id}/payment-qr/review`).set('Authorization', platform).send({ decision: 'approved' });
    expect((await request(app).get(`/api/guest/${token}`)).body.paymentQr.payeeName).toBe('City Centre Parking');

    clock = new Date(clock.getTime() + 75 * 60_000);
    await request(app).post(`/api/guest/${token}/request`).send({});
    const paid = await request(app).post(`/api/guest/${token}/payment`).send({ transactionReference: '425931234567' });
    expect(paid.body).toMatchObject({ pendingPayment: true, balanceDue: 100 });

    const pending = await request(app).get(`/api/locations/${loc.id}/payments/pending`).set('Authorization', supervisor);
    expect(pending.body).toHaveLength(1);
    expect((await request(app).post(`/api/payments/${pending.body[0].payment.id}/verify`).set('Authorization', attendant).send({ decision: 'verified' })).status).toBe(403);
    await request(app).post(`/api/payments/${pending.body[0].payment.id}/verify`).set('Authorization', supervisor).send({ decision: 'verified' });
    expect((await request(app).get(`/api/guest/${token}`)).body.balanceDue).toBe(0);
  });
});
