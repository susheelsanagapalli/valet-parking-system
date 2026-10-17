/**
 * The Valet server running inside the browser, for the GitHub Pages demo. It uses the same route
 * code (server/src/api.ts) and data layer as the real server, with in-memory data kept in this
 * browser's storage. Nothing is shared between devices, and Google Sheets and SMS gateways are off;
 * SMS uses tap-to-send through the phone's Messages app.
 */
import { MemorySheetStore, ValetSheetsRepository, type Row } from '@valet/sheets-integration';
import { apiRoutes, handleRequest } from '../../../server/src/api';
import type { StaffUser, UserAuth } from '../../../server/src/permissions';
import { DEMO_PASSWORD, DEMO_USERS, seedLocations, seedTickets } from '../../../server/src/seedData';
import { ManualSmsSender, Notifier } from '../../../server/src/sms';
import { SmsSettingsMemory, type SmsSettings } from '../../../server/src/smsOptions';

const STORAGE_KEY = 'valet.demo.v1';
const PHOTO_KEY = 'valet.demo.photos.v1';
/** Changes on every save, so other tabs (e.g. the guest page next to the attendant's) reload the data. */
const VERSION_KEY = 'valet.demo.version';

function storedVersion(): string | null {
  try {
    return localStorage.getItem(VERSION_KEY);
  } catch {
    return null;
  }
}

interface Snapshot {
  rows: Record<string, Row[]>;
  pins: Array<[string, string]>;
  sms?: SmsSettings | null;
}

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (private mode): the demo keeps working until the page is closed.
  }
}

/** Demo sign-in: every demo user's password is DEMO_PASSWORD; tokens live only in this browser. */
class DemoUsers implements UserAuth {
  private readonly users: StaffUser[] = DEMO_USERS.map((u) => ({ ...u, passwordHash: '' }));

  login(username: string, password: string) {
    const user = this.users.find((u) => u.username === username.trim().toLowerCase());
    if (!user || password !== DEMO_PASSWORD) return { error: 'invalid' as const };
    return { token: `demo.${user.id}.${globalThis.crypto.randomUUID()}`, user };
  }

  verify(token: string) {
    const id = token.startsWith('demo.') ? token.split('.')[1] : undefined;
    return this.users.find((u) => u.id === id);
  }

  list() {
    return this.users;
  }
}

export function resetDemoData(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PHOTO_KEY);
    localStorage.removeItem(VERSION_KEY);
  } catch {
    // ignore
  }
}

async function start() {
  const loadedVersion = storedVersion();
  const repo = new ValetSheetsRepository({ store: new MemorySheetStore(), pinSecret: 'browser-demo', flushIntervalMs: 0 });
  await repo.load();
  const users = new DemoUsers();
  const snapshot = load<Snapshot>(STORAGE_KEY);
  const photos = new Map<string, string>(load<Array<[string, string]>>(PHOTO_KEY) ?? []);
  let pins = new Map<string, string>();

  if (snapshot) {
    try {
      repo.importRows(snapshot.rows, 'demo');
      pins = new Map(snapshot.pins);
    } catch {
      resetDemoData();
    }
  }
  if (repo.listLocations().length === 0) {
    seedLocations(repo);
    pins = await seedTickets(repo);
  }

  const notifier = new Notifier(new ManualSmsSender());
  const smsSettings = new SmsSettingsMemory(snapshot?.sms ?? { phoneType: 'iphone', senderNumber: '+919515858993' });
  const base = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}`;

  const routes = apiRoutes({
    repo,
    users,
    publicBaseUrl: base,
    photoUrl: (ref) => photos.get(ref) ?? '',
    saveUpload: async (dataUrl) => {
      if (!/^data:image\/(png|jpeg);base64,/.test(dataUrl)) throw new Error('Expected a JPEG or PNG image');
      const ref = `demo:${globalThis.crypto.randomUUID()}`;
      photos.set(ref, dataUrl);
      save(PHOTO_KEY, [...photos]);
      return { fileRef: ref, storage: 'object_storage' };
    },
    photoStorage: () => 'object_storage',
    demo: {
      password: DEMO_PASSWORD,
      pins,
      notice:
        'Demo running in your browser on GitHub Pages: data stays on this device only, so open guest links on the same device. SMS opens your Messages app; Google Sheets is off.',
    },
    notifier,
    smsSettings,
  });

  const state = { routes, users, version: loadedVersion, persist: () => undefined as void };
  state.persist = () => {
    save(STORAGE_KEY, { rows: repo.exportRows(), pins: [...pins], sms: smsSettings.get() } satisfies Snapshot);
    const version = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    save(VERSION_KEY, version);
    state.version = storedVersion();
  };
  return state;
}

let server: ReturnType<typeof start> | undefined;

/** Handles one API request in the browser; `path` is after /api and may include a query string. */
export async function demoRequest(method: string, path: string, body: unknown, token: string | null): Promise<{ status: number; body: unknown }> {
  // Reload when another tab saved changes since this tab loaded the data.
  if (server && (await server).version !== storedVersion()) server = undefined;
  server ??= start();
  const { routes, users, persist } = await server;
  const url = new URL(path, 'http://demo.local');
  const query = Object.fromEntries(url.searchParams.entries());
  const result = await handleRequest(routes, users, { method, path: url.pathname, query, body, token });
  if (method !== 'GET' && result.status < 400) persist();
  return result;
}
