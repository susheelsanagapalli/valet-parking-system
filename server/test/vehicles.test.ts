import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_VEHICLE_CATALOGUE, MemorySheetStore, ValetSheetsRepository, type LocationRow } from '@valet/sheets-integration';
import { createApp } from '../src/app.js';
import { UserDirectory } from '../src/auth.js';
import { LocalPhotoStore } from '../src/photos.js';
import { DEMO_PASSWORD, seedLocations, seedUsers } from '../src/seed.js';

const uploads = mkdtempSync(join(tmpdir(), 'valet-vehicles-'));
afterAll(() => rmSync(uploads, { recursive: true, force: true }));

let app: ReturnType<typeof createApp>;
let repo: ValetSheetsRepository;
let loc: LocationRow;

async function auth(username: string) {
  const res = await request(app).post('/api/auth/login').send({ username, password: DEMO_PASSWORD });
  return `Bearer ${res.body.token as string}`;
}
const checkIn = async (token: string, body: object) => request(app).post(`/api/locations/${loc.id}/tickets`).set('Authorization', token).send({ plateNumber: 'KA01VV1234', keyTag: 'K-1', ...body });
const setList = async (token: string, vehicleCatalogue: object) => request(app).put(`/api/locations/${loc.id}/settings`).set('Authorization', token).send({ vehicleCatalogue });

beforeEach(async () => {
  repo = new ValetSheetsRepository({ store: new MemorySheetStore(), pinSecret: 'pin', flushIntervalMs: 0 });
  await repo.load();
  seedLocations(repo);
  loc = repo.listLocations().find((l) => l.service_profile === 'restaurant')!;
  const users = new UserDirectory('auth');
  seedUsers(users);
  app = createApp({ repo, users, photos: new LocalPhotoStore(uploads), authSecret: 'auth', publicBaseUrl: 'https://valet.example' });
});

describe('vehicle list', () => {
  it('every location starts with the default list, including locations saved before it existed', async () => {
    const settings = await request(app).get(`/api/locations/${loc.id}/settings`).set('Authorization', await auth('attendant'));
    expect(settings.body.vehicleCatalogue.makes.length).toBe(DEFAULT_VEHICLE_CATALOGUE.makes.length);
    expect(settings.body.vehicleCatalogue.colours).toContain('White');
  });

  it('admins edit the list; attendants cannot', async () => {
    const list = { makes: [{ name: 'Tata', models: ['Nexon', 'Punch'] }], colours: ['White', 'Red'], allowOther: false };
    expect((await setList(await auth('attendant'), list)).status).toBe(403);
    const saved = await setList(await auth('admin'), list);
    expect(saved.status).toBe(200);
    expect(saved.body.vehicleCatalogue).toEqual(list);
  });

  it('without "Other", check-in only accepts listed makes, models of that make and colours', async () => {
    const admin = await auth('admin');
    await setList(admin, { makes: [{ name: 'Tata', models: ['Nexon'] }, { name: 'Kia', models: ['Seltos'] }], colours: ['White'], allowOther: false });
    const attendant = await auth('attendant');
    expect((await checkIn(attendant, { make: 'Tata', model: 'Nexon', colour: 'White' })).status).toBe(200);
    expect((await checkIn(attendant, { make: 'tata', model: 'nexon', colour: 'white' })).status).toBe(200);
    expect((await checkIn(attendant, { make: 'Ferrari' })).body.error).toMatch(/not in this location's list of makes/);
    expect((await checkIn(attendant, { make: 'Tata', model: 'Seltos' })).body.error).toMatch(/not in the list of Tata/);
    expect((await checkIn(attendant, { colour: 'Pink' })).body.error).toMatch(/list of colours/);
    // All three stay optional.
    expect((await checkIn(attendant, {})).status).toBe(200);
  });

  it('with "Other" allowed, an unlisted car can be typed', async () => {
    const admin = await auth('admin');
    await setList(admin, { makes: [{ name: 'Tata', models: ['Nexon'] }], colours: ['White'], allowOther: true });
    expect((await checkIn(await auth('attendant'), { make: 'Lamborghini', model: 'Urus', colour: 'Lime' })).status).toBe(200);
  });

  it('rejects duplicates, empty names and oversized lists', async () => {
    const admin = await auth('admin');
    expect((await setList(admin, { makes: [{ name: 'Tata', models: [] }, { name: 'tata', models: [] }], colours: [], allowOther: true })).body.error).toMatch(/only be listed once/);
    expect((await setList(admin, { makes: [{ name: 'Kia', models: ['Seltos', 'seltos'] }], colours: [], allowOther: true })).body.error).toMatch(/Kia: each model/);
    expect((await setList(admin, { makes: [{ name: ' ', models: [] }], colours: [], allowOther: true })).body.error).toMatch(/1–40 characters/);
    expect((await setList(admin, { makes: [], colours: [], allowOther: false })).body.error).toMatch(/at least one make/);
    expect((await setList(admin, { makes: [], colours: Array.from({ length: 51 }, (_, i) => `C${i}`), allowOther: true })).status).toBe(400);
  });
});
