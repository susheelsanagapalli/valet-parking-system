import { createServer as createHttpsServer } from 'node:https';
import { resolve } from 'node:path';
import {
  GoogleSheetStore,
  MemorySheetStore,
  ValetSheetsRepository,
  booksFromEnv,
  createGoogleAuth,
  driveClient,
  sheetsClient,
  type SheetStore,
} from '@valet/sheets-integration';
import { createApp } from './app.js';
import { UserDirectory } from './auth.js';
import { loadConfig } from './config.js';
import { loadOrCreateDevCert, localAddresses, type DevCert } from './devCert.js';
import { RealGoogleConnector } from './google/connector.js';
import { DataManager } from './google/dataManager.js';
import { googlePublicRoutes, googleStaffRoutes } from './google/routes.js';
import { GoogleSettingsStore } from './google/settings.js';
import { DrivePhotoStore, LocalPhotoStore, type PhotoStore } from './photos.js';
import { Swappable } from './runtime.js';
import { DEMO_PASSWORD, seedLocations, seedTickets, seedUsers } from './seed.js';
import { HttpSmsSender, LogSmsSender, ManualSmsSender, Notifier, OffSmsSender, SmsGateSender } from './sms.js';
import { SmsSettingsStore, senderFor } from './smsSettings.js';

const config = loadConfig();
const onWriteError = (err: unknown) => console.error('Write to Google Sheets failed; will retry:', err);
const localPhotos = new LocalPhotoStore(config.uploadsDir);

// Data store: a Google account connected in the admin panel wins; then STORE=google from .env; else memory.
let store: SheetStore;
let photos: PhotoStore = localPhotos;
let storeName: string = config.store;
if (config.store === 'google') {
  const auth = createGoogleAuth();
  store = new GoogleSheetStore({ sheets: sheetsClient(auth), books: booksFromEnv() });
  if (config.photoStorage === 'google_drive') photos = new DrivePhotoStore(driveClient(auth), config.drivePhotoFolderId);
} else {
  store = new MemorySheetStore();
}

const googleSettings = new GoogleSettingsStore(config.googleSettingsPath);
const repoHolder = new Swappable<ValetSheetsRepository>(
  new ValetSheetsRepository({ store, pinSecret: config.pinSecret, persistPath: config.store === 'google' ? config.queuePath : undefined, onWriteError }),
);
const photoHolder = new Swappable<PhotoStore>(photos);
const data = new DataManager({
  repo: repoHolder,
  photos: photoHolder,
  localPhotos,
  connector: new RealGoogleConnector(),
  settings: googleSettings,
  pinSecret: config.pinSecret,
  queuePath: config.queuePath,
  redirectUri: config.googleRedirectUri,
  onWriteError,
});

const connected = await data.startupRepository().catch((e: unknown) => {
  console.error('Could not open the connected Google spreadsheets; using memory until fixed:', e);
  return undefined;
});
if (connected) {
  repoHolder.current = connected.repo;
  photoHolder.current = connected.photos;
  storeName = `google (${googleSettings.get().connection?.email ?? ''})`;
} else {
  await repoHolder.current.load();
}
const repo = repoHolder.proxy();

const users = config.staffUsersFile ? UserDirectory.fromFile(config.staffUsersFile, config.authSecret) : new UserDirectory(config.authSecret);
let demoPins = new Map<string, string>();
if (config.seedDemo) {
  seedLocations(repo);
  seedUsers(users);
  demoPins = await seedTickets(repo);
}

const sms = config.sms;
const notifier = new Notifier(
  sms.provider === 'smsgate'
    ? new SmsGateSender({ url: sms.url, username: sms.username, password: sms.password })
    : sms.provider === 'httpsms'
      ? new HttpSmsSender({ apiKey: sms.apiKey, from: sms.from })
      : sms.provider === 'manual'
        ? new ManualSmsSender()
        : sms.provider === 'log'
          ? new LogSmsSender()
          : new OffSmsSender(),
);
// Settings saved in the admin panel take precedence over SMS_PROVIDER.
const smsSettings = new SmsSettingsStore(config.smsSettingsPath);
const savedSms = smsSettings.get();
if (savedSms) notifier.setSender(senderFor(savedSms));

let devCert: DevCert | undefined;
if (config.httpsPort) {
  try {
    devCert = loadOrCreateDevCert(config.certDir);
  } catch (e) {
    console.error('Could not create the test HTTPS certificate; https is off:', e);
  }
}

const googleDeps = { data, repo, authSecret: config.authSecret, appName: () => repo.listLocations()[0]?.app_name ?? 'ValetPay' };
const webDist = config.webDist ?? resolve(import.meta.dirname, '../../web/dist');
const app = createApp({
  repo,
  users,
  photos: photoHolder.proxy(),
  authSecret: config.authSecret,
  publicBaseUrl: config.publicBaseUrl,
  webDist,
  demo: config.demoMode ? { password: DEMO_PASSWORD, pins: demoPins } : undefined,
  notifier,
  smsSettings,
  devCertDer: devCert?.der,
  commit: config.commit,
  corsOrigins: config.corsOrigins,
  extraPublicRoutes: googlePublicRoutes(googleDeps),
  extraStaffRoutes: googleStaffRoutes(googleDeps),
});

const server = app.listen(config.port, () => {
  console.log(`Valet server on http://localhost:${config.port} (store: ${storeName}, photos: ${photoHolder.current.kind}, SMS: ${notifier.sender.name})`);
  if (config.demoMode) console.log(`Test credentials are shown on ${config.publicBaseUrl}/login (removed when NODE_ENV=production)`);
});

let httpsServer: ReturnType<typeof createHttpsServer> | undefined;
if (devCert && config.httpsPort) {
  const port = config.httpsPort;
  httpsServer = createHttpsServer({ cert: devCert.cert, key: devCert.key }, app).listen(port, () => {
    const ips = localAddresses();
    console.log(`Test HTTPS for phones (GPS and camera): ${ips.map((ip) => `https://${ip}:${port}`).join(', ') || `https://localhost:${port}`}`);
    console.log(`Install the certificate on a phone once: http://${ips[0] ?? 'localhost'}:${config.port}/dev-cert.crt`);
  });
}

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal}: sending queued writes…`);
  server.close();
  httpsServer?.close();
  try {
    await repoHolder.current.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
