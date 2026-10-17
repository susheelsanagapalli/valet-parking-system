import { join } from 'node:path';

export interface Config {
  port: number;
  /** Extra https port with a self-signed certificate, for testing GPS and camera on phones; off in production. */
  httpsPort?: number;
  certDir: string;
  publicBaseUrl: string;
  store: 'memory' | 'google';
  seedDemo: boolean;
  /** Shows test credentials on the sign-in page; never on in production. */
  demoMode: boolean;
  authSecret: string;
  pinSecret: string;
  staffUsersFile?: string;
  photoStorage: 'local' | 'google_drive';
  uploadsDir: string;
  drivePhotoFolderId?: string;
  queuePath: string;
  webDist?: string;
  production: boolean;
  /** File for the SMS settings chosen in the admin panel; they override SMS_PROVIDER. */
  smsSettingsPath: string;
  /** File for the Google account connected in the admin panel (client secret, refresh token, sharing). */
  googleSettingsPath: string;
  /** Must match the redirect URI registered on the Google OAuth client. */
  googleRedirectUri: string;
  /** Git commit being run, reported by /api/health so deployments can confirm the new version is live. */
  commit?: string;
  /** Other web app origins allowed to call the API, e.g. https://<user>.github.io for GitHub Pages. */
  corsOrigins: string[];
  sms:
    | { provider: 'off' }
    | { provider: 'log' }
    | { provider: 'manual' }
    | { provider: 'smsgate'; url: string; username: string; password: string }
    | { provider: 'httpsms'; apiKey: string; from: string };
}

function smsConfig(env: Record<string, string | undefined>, production: boolean): Config['sms'] {
  const provider = env.SMS_PROVIDER ?? 'manual';
  const need = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`${name} is required when SMS_PROVIDER=${provider}`);
    return v;
  };
  switch (provider) {
    case 'off':
    case 'log':
    case 'manual':
      return { provider };
    case 'smsgate':
      return { provider, url: env.SMSGATE_URL ?? 'https://api.sms-gate.app/3rdparty/v1/message', username: need('SMSGATE_USERNAME'), password: need('SMSGATE_PASSWORD') };
    case 'httpsms':
      return { provider, apiKey: need('HTTPSMS_API_KEY'), from: need('SMS_FROM') };
    default:
      throw new Error(`Unknown SMS_PROVIDER "${provider}"; use manual, smsgate, httpsms, log or off`);
  }
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
  const seedDemo = env.SEED_DEMO ? env.SEED_DEMO === 'true' : store === 'memory' && !production;
  if (production && seedDemo) {
    throw new Error('SEED_DEMO must be false in production: demo users and test credentials must not go live');
  }
  // Hosts such as Render provide https and the public address themselves.
  const hostedUrl = env.RENDER_EXTERNAL_URL?.replace(/\/$/, '');
  const httpsPort = env.HTTPS_PORT === 'off' || hostedUrl ? undefined : env.HTTPS_PORT ? Number(env.HTTPS_PORT) : production ? undefined : 8443;
  // Folder for files the server writes (Google connection, SMS settings, write queue, uploads, certificates).
  const dataDir = env.DATA_DIR ?? '.';
  const inData = (name: string) => join(dataDir, name);
  return {
    port: Number(env.PORT ?? 8080),
    httpsPort,
    certDir: env.CERT_DIR ?? inData('certs'),
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? hostedUrl ?? 'http://localhost:5173').replace(/\/$/, ''),
    store,
    seedDemo,
    demoMode: seedDemo && !production,
    authSecret: secret('AUTH_SECRET'),
    pinSecret: secret('PIN_HMAC_SECRET'),
    staffUsersFile: env.STAFF_USERS_FILE || undefined,
    photoStorage: env.PHOTO_STORAGE === 'google_drive' ? 'google_drive' : 'local',
    uploadsDir: env.UPLOADS_DIR ?? inData('uploads'),
    drivePhotoFolderId: env.DRIVE_PHOTO_FOLDER_ID || undefined,
    queuePath: env.QUEUE_PATH ?? inData('valet.queue.json'),
    webDist: env.WEB_DIST,
    production,
    smsSettingsPath: env.SMS_SETTINGS_PATH ?? inData('sms-settings.json'),
    googleSettingsPath: env.GOOGLE_SETTINGS_PATH ?? inData('google-settings.json'),
    // Google accepts https addresses or localhost, so local testing uses localhost and hosting uses its https address.
    googleRedirectUri: env.GOOGLE_REDIRECT_URI ?? `${hostedUrl ?? `http://localhost:${Number(env.PORT ?? 8080)}`}/api/google/callback`,
    commit: env.RENDER_GIT_COMMIT ?? env.GIT_COMMIT,
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean),
    sms: smsConfig(env, production),
  };
}
