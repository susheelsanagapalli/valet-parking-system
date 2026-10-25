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
import { ManualSmsSender, Notifier, OffSmsSender } from '../src/sms.js';
import { SmsSettingsStore } from '../src/smsSettings.js';

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

describe('test credentials (demo mode only)', () => {
  it('lists staff logins and open guest tickets with their PINs', async () => {
    const demoApp = createApp({
      repo,
      users,
      photos: new LocalPhotoStore(uploads),
      authSecret: 'auth',
      publicBaseUrl: 'https://valet.example',
      now: () => new Date(clock),
      demo: { password: DEMO_PASSWORD, pins: new Map() },
    });
    const attendant = `Bearer ${(await request(demoApp).post('/api/auth/login').send({ username: 'attendant', password: DEMO_PASSWORD })).body.token as string}`;
    const loc = byProfile('restaurant');
    const checkIn = await request(demoApp).post(`/api/locations/${loc.id}/tickets`).set('Authorization', attendant).send({ plateNumber: 'DM1', keyTag: 'K' });

    const res = await request(demoApp).get('/api/demo/credentials');
    expect(res.status).toBe(200);
    expect(res.body.password).toBe(DEMO_PASSWORD);
    expect(res.body.users.map((u: { username: string }) => u.username)).toContain('platform');
    expect(res.body.users[0]).not.toHaveProperty('passwordHash');
    expect(res.body.guestTickets[0]).toMatchObject({ ticketNumber: checkIn.body.ticket.ticket_number, pin: checkIn.body.handoverPin, guestLink: checkIn.body.guestLink });
  });

  it('is not available outside demo mode', async () => {
    // Answers "off" (not an error, so the sign-in page console stays clean) and reveals nothing.
    const res = await request(app).get('/api/demo/credentials');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false });
  });

  it('lets a web app on GitHub Pages call the API only from allowed origins', async () => {
    const corsApp = createApp({ repo, users, photos: new LocalPhotoStore(uploads), authSecret: 'auth', publicBaseUrl: 'x', corsOrigins: ['https://susheelsanagapalli.github.io'] });
    const ok = await request(corsApp).options('/api/auth/login').set('Origin', 'https://susheelsanagapalli.github.io');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('https://susheelsanagapalli.github.io');
    const bad = await request(corsApp).options('/api/auth/login').set('Origin', 'https://evil.example');
    expect(bad.status).toBe(403);
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('uses the hosting address on Render and keeps localhost locally', async () => {
    const { loadConfig } = await import('../src/config.js');
    const hosted = loadConfig({ RENDER_EXTERNAL_URL: 'https://valetpay.onrender.com', RENDER_GIT_COMMIT: 'abc123', DATA_DIR: '/var/data', PORT: '10000' });
    expect(hosted).toMatchObject({
      port: 10000,
      httpsPort: undefined,
      publicBaseUrl: 'https://valetpay.onrender.com',
      googleRedirectUri: 'https://valetpay.onrender.com/api/google/callback',
      commit: 'abc123',
    });
    expect(hosted.googleSettingsPath.replace(/\\/g, '/')).toBe('/var/data/google-settings.json');
    const local = loadConfig({ PUBLIC_BASE_URL: 'http://192.168.1.5:8080' });
    expect(local).toMatchObject({ httpsPort: 8443, googleRedirectUri: 'http://localhost:8080/api/google/callback', googleSettingsPath: 'google-settings.json' });
  });

  it('refuses to start production with demo data', async () => {
    const { loadConfig } = await import('../src/config.js');
    expect(() => loadConfig({ NODE_ENV: 'production', SEED_DEMO: 'true', AUTH_SECRET: 'a'.repeat(32), PIN_HMAC_SECRET: 'b'.repeat(32) })).toThrow(/SEED_DEMO/);
    const live = { NODE_ENV: 'production', AUTH_SECRET: 'a'.repeat(32), PIN_HMAC_SECRET: 'b'.repeat(32), STAFF_USERS_FILE: 'staff.json', PUBLIC_BASE_URL: 'https://valet.example.com' };
    expect(loadConfig(live).demoMode).toBe(false);
    // Go-live mistakes are refused at start-up instead of failing later.
    expect(() => loadConfig({ ...live, STAFF_USERS_FILE: '' })).toThrow(/STAFF_USERS_FILE/);
    expect(() => loadConfig({ ...live, PUBLIC_BASE_URL: undefined })).toThrow(/PUBLIC_BASE_URL/);
    expect(loadConfig({ ...live, PUBLIC_BASE_URL: undefined, RENDER_EXTERNAL_URL: 'https://valet.onrender.com' }).publicBaseUrl).toBe('https://valet.onrender.com');
    expect(loadConfig({}).demoMode).toBe(true);
  });
});

describe('guest SMS', () => {
  it('texts the ticket link and PIN at check-in, then car ready and receipt', async () => {
    const sent: Array<{ to: string; text: string }> = [];
    const notifier = new Notifier({ name: 'test', send: async (to, text) => void sent.push({ to, text }) });
    const smsApp = createApp({ repo, users, photos: new LocalPhotoStore(uploads), authSecret: 'auth', publicBaseUrl: 'https://valet.example', now: () => new Date(clock), notifier });
    const token = `Bearer ${(await request(smsApp).post('/api/auth/login').send({ username: 'attendant', password: DEMO_PASSWORD })).body.token as string}`;
    const loc = byProfile('restaurant');

    const checkIn = await request(smsApp).post(`/api/locations/${loc.id}/tickets`).set('Authorization', token).send({ plateNumber: 'SMS1', keyTag: 'K', guestMobile: '98000 00001' });
    expect(checkIn.body.sms).toBe('sending');
    await new Promise((r) => setTimeout(r, 20));
    expect(sent[0]?.to).toBe('+919800000001');
    expect(sent[0]?.text).toContain(`PIN (OTP) ${checkIn.body.handoverPin as string}`);
    expect(sent[0]?.text).toContain(checkIn.body.guestLink);

    const id = checkIn.body.ticket.id as string;
    await request(smsApp).post(`/api/tickets/${id}/spot`).set('Authorization', token).send({ text: 'Lane 1', gps: { lat: 1, lng: 1, accuracyM: 5 } });
    await request(smsApp).post(`/api/tickets/${id}/request`).set('Authorization', token).send({});
    const queue = await request(smsApp).get(`/api/locations/${loc.id}/queue`).set('Authorization', token);
    await request(smsApp).post(`/api/tasks/${queue.body.queue[0].task.id as string}/accept`).set('Authorization', token);
    await request(smsApp).post(`/api/tickets/${id}/ready`).set('Authorization', token);
    await request(smsApp).post(`/api/tickets/${id}/confirm`).set('Authorization', token).send({ result: 'no_damage', method: 'signature' });
    await request(smsApp).post(`/api/tickets/${id}/handover`).set('Authorization', token).send({});
    await new Promise((r) => setTimeout(r, 20));
    expect(sent.map((m) => m.text.split(' ').slice(1, 4).join(' '))).toEqual(['Car SMS1 parked', 'Your car SMS1', 'Thank you! Ticket']);
    expect(sent[2]?.text).toContain('No charge.');

    const noMobile = await request(smsApp).post(`/api/locations/${loc.id}/tickets`).set('Authorization', token).send({ plateNumber: 'SMS2', keyTag: 'K' });
    expect(noMobile.body.sms).toBe('no_mobile');
  });

  it('tap-to-send: returns a draft for the Messages app and records when it is opened', async () => {
    const notifier = new Notifier(new ManualSmsSender());
    const smsApp = createApp({ repo, users, photos: new LocalPhotoStore(uploads), authSecret: 'auth', publicBaseUrl: 'https://valet.example', now: () => new Date(clock), notifier });
    const token = `Bearer ${(await request(smsApp).post('/api/auth/login').send({ username: 'attendant', password: DEMO_PASSWORD })).body.token as string}`;
    const loc = byProfile('restaurant');

    const checkIn = await request(smsApp).post(`/api/locations/${loc.id}/tickets`).set('Authorization', token).send({ plateNumber: 'TAP1', keyTag: 'K', guestMobile: '9515858993' });
    expect(checkIn.body.sms).toBe('tap_to_send');
    expect(checkIn.body.smsDraft).toMatchObject({ to: '+919515858993' });
    expect(checkIn.body.smsDraft.text).toContain(`PIN (OTP) ${checkIn.body.handoverPin as string}`);

    expect((await request(smsApp).post(`/api/sms/${checkIn.body.smsDraft.id as string}/opened`)).status).toBe(401);
    expect((await request(smsApp).post(`/api/sms/${checkIn.body.smsDraft.id as string}/opened`).set('Authorization', token)).status).toBe(200);
    expect(notifier.recent()[0]?.status).toBe('opened');

    const id = checkIn.body.ticket.id as string;
    await request(smsApp).post(`/api/tickets/${id}/spot`).set('Authorization', token).send({ text: 'Lane 1', gps: { lat: 1, lng: 1, accuracyM: 5 } });
    await request(smsApp).post(`/api/tickets/${id}/request`).set('Authorization', token).send({});
    const queue = await request(smsApp).get(`/api/locations/${loc.id}/queue`).set('Authorization', token);
    await request(smsApp).post(`/api/tasks/${queue.body.queue[0].task.id as string}/accept`).set('Authorization', token);
    const ready = await request(smsApp).post(`/api/tickets/${id}/ready`).set('Authorization', token);
    expect(ready.body.smsDraft.text).toContain('is ready at Main entrance');
  });
});

describe('SMS settings from the admin panel', () => {
  it('switches between iPhone tap-to-send and the Android gateway', async () => {
    const notifier = new Notifier(new OffSmsSender());
    const smsSettings = new SmsSettingsStore();
    const smsApp = createApp({ repo, users, photos: new LocalPhotoStore(uploads), authSecret: 'auth', publicBaseUrl: 'https://valet.example', now: () => new Date(clock), notifier, smsSettings });
    const login = async (u: string) => `Bearer ${(await request(smsApp).post('/api/auth/login').send({ username: u, password: DEMO_PASSWORD })).body.token as string}`;
    const admin = await login('admin');
    const attendant = await login('attendant');

    expect((await request(smsApp).get('/api/sms/config').set('Authorization', attendant)).status).toBe(403);
    const empty = await request(smsApp).get('/api/sms/config').set('Authorization', admin);
    expect(empty.body).toMatchObject({ settings: null, activeMethod: 'off' });
    expect(empty.body.androidDownload).toBe('https://github.com/capcom6/android-sms-gateway/releases/latest/download/app-release.apk');

    expect((await request(smsApp).put('/api/sms/config').set('Authorization', admin).send({ phoneType: 'iphone', senderNumber: '12345' })).status).toBe(400);
    const iphone = await request(smsApp).put('/api/sms/config').set('Authorization', admin).send({ phoneType: 'iphone', senderNumber: '9515858993' });
    expect(iphone.body).toMatchObject({ activeMethod: 'manual', settings: { phoneType: 'iphone', senderNumber: '+919515858993' } });
    const test = await request(smsApp).post('/api/sms/test').set('Authorization', admin).send({});
    expect(test.body.smsDraft.to).toBe('+919515858993');

    expect((await request(smsApp).put('/api/sms/config').set('Authorization', admin).send({ phoneType: 'android', senderNumber: '9515858993', android: { username: 'gw' } })).status).toBe(400);
    const android = await request(smsApp)
      .put('/api/sms/config')
      .set('Authorization', admin)
      .send({ phoneType: 'android', senderNumber: '9515858993', android: { username: 'gw', password: 'secret' } });
    expect(android.body).toMatchObject({ activeMethod: 'smsgate', settings: { android: { username: 'gw', hasPassword: true } } });
    expect(JSON.stringify(android.body)).not.toContain('secret');
    // Saving again without a password keeps the stored one.
    const again = await request(smsApp).put('/api/sms/config').set('Authorization', admin).send({ phoneType: 'android', senderNumber: '9515858993', android: { username: 'gw2' } });
    expect(again.body.settings.android).toMatchObject({ username: 'gw2', hasPassword: true });
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

    // Scanning the guest's QR finds the ticket; a foreign QR is rejected.
    const found = await request(app).get(`/api/tickets/by-qr?code=${encodeURIComponent(guestLink)}`).set('Authorization', holder);
    expect(found.body.ticket_number).toBe(checkIn.body.ticket.ticket_number);
    expect((await request(app).get('/api/tickets/by-qr?code=https%3A%2F%2Fexample.com%2Fnot-a-ticket').set('Authorization', holder)).status).toBe(404);

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
