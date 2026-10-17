export interface Config {
  port: number;
  publicBaseUrl: string;
  store: 'memory' | 'google';
  seedDemo: boolean;
  authSecret: string;
  pinSecret: string;
  staffUsersFile?: string;
  photoStorage: 'local' | 'google_drive';
  uploadsDir: string;
  drivePhotoFolderId?: string;
  queuePath: string;
  webDist?: string;
  production: boolean;
}

const DEV_SECRET = 'dev-only-secret-change-me';

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const secret = (name: string): string => {
    const value = env[name];
    if (value && value !== 'change-me') return value;
    if (production) throw new Error(`${name} must be set to a long random value in production`);
    return `${DEV_SECRET}-${name}`;
  };
  const store = env.STORE === 'google' ? 'google' : 'memory';
  return {
    port: Number(env.PORT ?? 8080),
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
    store,
    seedDemo: env.SEED_DEMO ? env.SEED_DEMO === 'true' : store === 'memory',
    authSecret: secret('AUTH_SECRET'),
    pinSecret: secret('PIN_HMAC_SECRET'),
    staffUsersFile: env.STAFF_USERS_FILE || undefined,
    photoStorage: env.PHOTO_STORAGE === 'google_drive' ? 'google_drive' : 'local',
    uploadsDir: env.UPLOADS_DIR ?? 'uploads',
    drivePhotoFolderId: env.DRIVE_PHOTO_FOLDER_ID || undefined,
    queuePath: env.QUEUE_PATH ?? 'valet.queue.json',
    webDist: env.WEB_DIST,
    production,
  };
}
