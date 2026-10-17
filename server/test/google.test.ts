import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MemorySheetStore, ValetSheetsRepository, type BookKind, type SheetStore } from '@valet/sheets-integration';
import { createApp } from '../src/app.js';
import { UserDirectory } from '../src/auth.js';
import type { BookUsage, GoogleConnector } from '../src/google/connector.js';
import { DataManager } from '../src/google/dataManager.js';
import { googlePublicRoutes, googleStaffRoutes, readState, signState } from '../src/google/routes.js';
import { GoogleSettingsStore, type GoogleClient, type GoogleConnection } from '../src/google/settings.js';
import { LocalPhotoStore, type PhotoStore } from '../src/photos.js';
import { Swappable } from '../src/runtime.js';
import { DEMO_PASSWORD, seedLocations, seedTickets, seedUsers } from '../src/seed.js';

const dir = mkdtempSync(join(tmpdir(), 'valet-google-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Stands in for Google: spreadsheets are in-memory stores, sharing and backups are recorded. */
class FakeGoogle implements GoogleConnector {
  readonly sheets = new MemorySheetStore();
  readonly shared = new Map<string, { email: string; access: string }>();
  backups = 0;
  revoked = false;
  private nextPermission = 1;

  authUrl(client: GoogleClient, redirectUri: string, state: string) {
    return `https://accounts.google.test/auth?client_id=${client.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  }
  async exchange(_c: GoogleClient, _r: string, code: string) {
    if (code !== 'good-code') throw new Error('invalid_grant');
    return { refreshToken: 'refresh-1', email: 'owner@example.com' };
  }
  async setup() {
    const books = { config: 'c', transactions: 't', guest: 'g', audit: 'a' } as Record<BookKind, string>;
    return { folderId: 'folder-1', photosFolderId: 'photos-1', backupsFolderId: 'backups-1', books };
  }
  sheetStore(): SheetStore {
    return this.sheets;
  }
  photoStore(): PhotoStore {
    return { kind: 'google_drive', save: async () => 'drive:photo-1', read: async () => ({ data: Buffer.from(''), mime: 'image/png' }) };
  }
  async share(_c: GoogleClient, _conn: GoogleConnection, email: string, access: 'reader' | 'writer') {
    const id = `perm-${this.nextPermission++}`;
    this.shared.set(id, { email, access });
    return id;
  }
  async unshare(_c: GoogleClient, _conn: GoogleConnection, id: string) {
    this.shared.delete(id);
  }
  async backup() {
    this.backups++;
    return 4;
  }
  async usage(): Promise<BookUsage[]> {
    return [{ book: 'transactions', title: 'ValetPay – Transactions', url: 'https://docs.google.com/spreadsheets/d/t', cells: 26_000, percent: 0.3 }];
  }
  async revoke() {
    this.revoked = true;
  }
}

let google: FakeGoogle;
let app: ReturnType<typeof createApp>;
let holder: Swappable<ValetSheetsRepository>;
let photos: Swappable<PhotoStore>;
let settings: GoogleSettingsStore;

beforeEach(async () => {
  google = new FakeGoogle();
  const repo = new ValetSheetsRepository({ store: new MemorySheetStore(), pinSecret: 'pin', flushIntervalMs: 0 });
  await repo.load();
  seedLocations(repo);
  await seedTickets(repo);
  holder = new Swappable(repo);
  const local = new LocalPhotoStore(join(dir, 'uploads'));
  photos = new Swappable<PhotoStore>(local);
  settings = new GoogleSettingsStore(join(dir, `google-${Math.random()}.json`));
  const data = new DataManager({ repo: holder, photos, localPhotos: local, connector: google, settings, pinSecret: 'pin', redirectUri: 'http://localhost:8080/api/google/callback' });
  const users = new UserDirectory('auth');
  seedUsers(users);
  const proxy = holder.proxy();
  const deps = { data, repo: proxy, authSecret: 'auth', appName: () => 'ValetPay' };
  app = createApp({ repo: proxy, users, photos: photos.proxy(), authSecret: 'auth', publicBaseUrl: 'http://x', extraPublicRoutes: googlePublicRoutes(deps), extraStaffRoutes: googleStaffRoutes(deps) });
});

async function login(username: string) {
  return `Bearer ${(await request(app).post('/api/auth/login').send({ username, password: DEMO_PASSWORD })).body.token as string}`;
}

describe('Google Drive connection', () => {
  it('connects, copies the data into the spreadsheets and switches to them', async () => {
    const admin = await login('admin');
    const before = holder.current;
    const ticketsBefore = before.listLocations().flatMap((l) => before.listTickets(l.id)).length;

    expect((await request(app).post('/api/google/connect').set('Authorization', admin)).body.error).toMatch(/client ID/);
    await request(app).put('/api/google/client').set('Authorization', admin).send({ clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'shh' }).expect(200);
    const status = await request(app).get('/api/google/status').set('Authorization', admin);
    expect(status.body).toMatchObject({ storage: 'memory', client: { clientId: '123-abc.apps.googleusercontent.com', hasSecret: true } });
    expect(JSON.stringify(status.body)).not.toContain('shh');

    const { url } = (await request(app).post('/api/google/connect').set('Authorization', admin)).body as { url: string };
    const state = new URL(url).searchParams.get('state') ?? '';
    expect(readState('auth', state)).toBe('u-admin');

    const cb = await request(app).get(`/api/google/callback?code=good-code&state=${state}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/staff/data?google=connected');

    expect(holder.current).not.toBe(before);
    expect(photos.current.kind).toBe('google_drive');
    expect(google.sheets.tabs.get('Tickets')).toHaveLength(ticketsBefore);
    const after = (await request(app).get('/api/google/status').set('Authorization', admin)).body;
    expect(after).toMatchObject({ storage: 'google', connection: { email: 'owner@example.com', folderUrl: 'https://drive.google.com/drive/folders/folder-1' } });
    expect(JSON.stringify(after)).not.toContain('refresh-1');

    // New writes go to the spreadsheets.
    const attendant = await login('attendant');
    const loc = holder.current.listLocations().find((l) => l.service_profile === 'restaurant')!;
    await request(app).post(`/api/locations/${loc.id}/tickets`).set('Authorization', attendant).send({ plateNumber: 'GD1', keyTag: 'K' }).expect(200);
    await request(app).post('/api/google/sync').set('Authorization', admin).expect(200);
    expect(google.sheets.tabs.get('Tickets')).toHaveLength(ticketsBefore + 1);
  });

  it('acts as the database: after a restart, all data is loaded back from the spreadsheets', async () => {
    const admin = await login('admin');
    await request(app).put('/api/google/client').set('Authorization', admin).send({ clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'shh' });
    await request(app).get(`/api/google/callback?code=good-code&state=${signState('auth', 'u-admin')}`);
    const attendant = await login('attendant');
    const loc = holder.current.listLocations().find((l) => l.service_profile === 'restaurant')!;
    const created = await request(app).post(`/api/locations/${loc.id}/tickets`).set('Authorization', attendant).send({ plateNumber: 'DB1', keyTag: 'K-9', guestMobile: '9515858993' });
    await request(app).post(`/api/tickets/${created.body.ticket.id as string}/spot`).set('Authorization', attendant).send({ text: 'Row 4', gps: { lat: 1, lng: 1, accuracyM: 5 } });
    await holder.current.flush();

    // "Restart": a new server process with nothing in memory, same saved Google connection.
    const freshHolder = new Swappable(new ValetSheetsRepository({ store: new MemorySheetStore(), pinSecret: 'pin', flushIntervalMs: 0 }));
    const local = new LocalPhotoStore(join(dir, 'uploads'));
    const restarted = new DataManager({ repo: freshHolder, photos: new Swappable<PhotoStore>(local), localPhotos: local, connector: google, settings, pinSecret: 'pin', redirectUri: 'x' });
    const loaded = await restarted.startupRepository();
    const details = loaded?.repo.getTicketDetails(created.body.ticket.id as string, { showFullMobile: true });
    expect(details?.ticket).toMatchObject({ status: 'parked', spot_text: 'Row 4', key_tag: 'K-9' });
    expect(details?.vehicle?.plate_number).toBe('DB1');
    expect(details?.customer?.mobile).toBe('9515858993');
  });

  it('rejects a tampered or expired sign-in and a failed code', async () => {
    expect((await request(app).get('/api/google/callback?code=good-code&state=forged.sig')).headers.location).toMatch(/google=error/);
    const old = signState('auth', 'u-admin', Date.now() - 11 * 60_000);
    expect((await request(app).get(`/api/google/callback?code=good-code&state=${old}`)).headers.location).toMatch(/expired/);
    const admin = await login('admin');
    await request(app).put('/api/google/client').set('Authorization', admin).send({ clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'shh' });
    const bad = await request(app).get(`/api/google/callback?code=bad&state=${signState('auth', 'u-admin')}`);
    expect(bad.headers.location).toMatch(/invalid_grant/);
    expect(settings.get().connection).toBeUndefined();
  });

  it('is limited to admins', async () => {
    const supervisor = await login('supervisor');
    expect((await request(app).get('/api/google/status').set('Authorization', supervisor)).status).toBe(403);
    expect((await request(app).get('/api/data/export.xlsx').set('Authorization', supervisor)).status).toBe(403);
  });
});

describe('sharing and maintenance', () => {
  async function connected() {
    const admin = await login('admin');
    await request(app).put('/api/google/client').set('Authorization', admin).send({ clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'shh' });
    await request(app).get(`/api/google/callback?code=good-code&state=${signState('auth', 'u-admin')}`);
    return admin;
  }

  it('shares the data folder by email, changes access and removes it', async () => {
    const admin = await connected();
    const shared = await request(app).post('/api/google/sharing').set('Authorization', admin).send({ email: 'Manager@Example.com', access: 'reader' });
    expect(shared.body.sharing).toMatchObject([{ email: 'manager@example.com', access: 'reader' }]);
    const upgraded = await request(app).post('/api/google/sharing').set('Authorization', admin).send({ email: 'manager@example.com', access: 'writer' });
    expect(upgraded.body.sharing).toMatchObject([{ email: 'manager@example.com', access: 'writer' }]);
    expect([...google.shared.values()]).toEqual([{ email: 'manager@example.com', access: 'writer' }]);
    expect((await request(app).post('/api/google/sharing').set('Authorization', admin).send({ email: 'owner@example.com', access: 'reader' })).body.error).toMatch(/owns/);
    const removed = await request(app).delete('/api/google/sharing/manager%40example.com').set('Authorization', admin);
    expect(removed.body.sharing).toEqual([]);
    expect(google.shared.size).toBe(0);
  });

  it('backs up, checks tabs, reports usage and exports Excel', async () => {
    const admin = await connected();
    expect((await request(app).post('/api/google/backup').set('Authorization', admin)).body.copied).toBe(4);
    expect(google.backups).toBe(1);
    expect((await request(app).post('/api/google/verify').set('Authorization', admin)).body).toMatchObject({ checked: 12, problems: [] });
    expect((await request(app).get('/api/google/usage').set('Authorization', admin)).body[0]).toMatchObject({ book: 'transactions', percent: 0.3 });
    const xlsx = await request(app).get('/api/data/export.xlsx').set('Authorization', admin).buffer(true);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
  });

  it('disconnects back to memory, keeping the data', async () => {
    const admin = await connected();
    const count = google.sheets.tabs.get('Tickets')?.length ?? 0;
    const res = await request(app).post('/api/google/disconnect').set('Authorization', admin);
    expect(res.body).toMatchObject({ storage: 'memory', connection: null });
    expect(google.revoked).toBe(true);
    expect(holder.current.listLocations().flatMap((l) => holder.current.listTickets(l.id))).toHaveLength(count);
    expect(photos.current.kind).toBe('object_storage');
  });
});
