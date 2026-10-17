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
import { DrivePhotoStore, LocalPhotoStore, type PhotoStore } from './photos.js';
import { DEMO_PASSWORD, seedLocations, seedUsers } from './seed.js';

const config = loadConfig();

let store: SheetStore;
let photos: PhotoStore;
if (config.store === 'google') {
  const auth = createGoogleAuth();
  store = new GoogleSheetStore({ sheets: sheetsClient(auth), books: booksFromEnv() });
  photos = config.photoStorage === 'google_drive' ? new DrivePhotoStore(driveClient(auth), config.drivePhotoFolderId) : new LocalPhotoStore(config.uploadsDir);
} else {
  store = new MemorySheetStore();
  photos = new LocalPhotoStore(config.uploadsDir);
}

const repo = new ValetSheetsRepository({
  store,
  pinSecret: config.pinSecret,
  persistPath: config.store === 'google' ? config.queuePath : undefined,
  onWriteError: (err) => console.error('Write to Google Sheets failed; will retry:', err),
});
await repo.load();

const users = config.staffUsersFile ? UserDirectory.fromFile(config.staffUsersFile, config.authSecret) : new UserDirectory(config.authSecret);
if (config.seedDemo) {
  seedLocations(repo);
  seedUsers(users);
}

const webDist = config.webDist ?? resolve(import.meta.dirname, '../../web/dist');
const app = createApp({ repo, users, photos, authSecret: config.authSecret, publicBaseUrl: config.publicBaseUrl, webDist });

const server = app.listen(config.port, () => {
  console.log(`Valet server on http://localhost:${config.port} (store: ${config.store}, photos: ${photos.kind})`);
  if (config.seedDemo && !config.staffUsersFile) {
    console.log(`Demo users: platform, admin, supervisor, attendant, attendant2 — password "${DEMO_PASSWORD}"`);
  }
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal}: sending queued writes…`);
  server.close();
  try {
    await repo.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
