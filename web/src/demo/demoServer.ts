/**
 * The Valet server running inside the browser, for the demo site. It uses the same route
 * code (server/src/api.ts) and data layer as the real server, with in-memory data kept in this
 * browser's storage. Nothing is shared between devices, and Google Sheets and SMS gateways are off;
 * SMS uses tap-to-send through the phone's Messages app.
 */
import { MemorySheetStore, ValetSheetsRepository, type Row } from '@valet/sheets-integration';
import { apiRoutes, handleRequest } from '../../../server/src/api';
import { StaffDirectory, type PasswordHasher, type StaffData, type TokenCodec } from '../../../server/src/staffDirectory';
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
  /** Staff accounts and custom roles created in this browser. */
  staff?: StaffData;
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

/**
 * Demo password hashing. Not secure (this browser holds all demo data anyway, and only demo users
 * live here); it just avoids keeping typed passwords as plain text. The server uses scrypt, and
 * never accepts these hashes.
 */
function demoHash(password: string, salt: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const ch of `${salt}:${password}`) {
    const c = ch.charCodeAt(0);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const demoHasher: PasswordHasher = {
  hash(password) {
    const salt = globalThis.crypto.randomUUID().slice(0, 8);
    return `demo$${salt}$${demoHash(password, salt)}`;
  },
  check(password, stored) {
    const [scheme, salt, hash] = stored.split('$');
    return scheme === 'demo' && Boolean(salt) && demoHash(password, salt!) === hash;
  },
};

/** Tokens live only in this browser: "demo.<user id>.<version>.<random>". */
const demoTokens: TokenCodec = {
  sign: (p) => `demo.${p.sub}.${p.v}.${globalThis.crypto.randomUUID()}`,
  read(token) {
    const [kind, sub, v] = token.split('.');
    return kind === 'demo' && sub ? { sub, v: Number(v) || 0, exp: Number.MAX_SAFE_INTEGER } : undefined;
  },
};

function demoStaff(saved: StaffData | undefined): StaffDirectory {
  const data: StaffData = saved ?? { users: DEMO_USERS.map((u) => ({ ...u, passwordHash: demoHasher.hash(DEMO_PASSWORD) })), roles: [] };
  return new StaffDirectory({ hasher: demoHasher, tokens: demoTokens }, data);
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
  const snapshot = load<Snapshot>(STORAGE_KEY);
  const users = demoStaff(snapshot?.staff);
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
        'Demo running in your browser: data stays on this device only, so open guest links on the same device. SMS opens your Messages app; Google Sheets is off.',
    },
    notifier,
    smsSettings,
  });

  const state = { routes, users, version: loadedVersion, persist: () => undefined as void };
  state.persist = () => {
    save(STORAGE_KEY, { rows: repo.exportRows(), pins: [...pins], sms: smsSettings.get(), staff: users.data() } satisfies Snapshot);
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
