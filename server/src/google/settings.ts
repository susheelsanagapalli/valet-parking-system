import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { BookKind } from '@valet/sheets-integration';

/** OAuth client created by the operator in Google Cloud Console (FR-DATA-01). */
export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

/** The operator's connected Google account and the Drive files VPS created in it (SRS 6.4). */
export interface GoogleConnection {
  email: string;
  refreshToken: string;
  folderId: string;
  photosFolderId: string;
  backupsFolderId: string;
  books: Record<BookKind, string>;
  connectedAt: string;
  connectedBy: string;
}

/** Someone given access to the data folder in Google Drive (FR-DATA-09). */
export interface SharedPerson {
  email: string;
  access: 'reader' | 'writer';
  permissionId: string;
  addedBy: string;
  addedAt: string;
}

export interface GoogleSettingsData {
  client?: GoogleClient;
  connection?: GoogleConnection;
  sharing: SharedPerson[];
  lastBackupAt?: string;
}

/**
 * Server-side file with the Google client secret, refresh token and sharing list. It is kept out of
 * the spreadsheets (which staff can open) and out of git; secrets are never sent to the browser.
 */
export class GoogleSettingsStore {
  private data: GoogleSettingsData = { sharing: [] };

  constructor(private readonly path?: string) {
    if (path && existsSync(path)) {
      const saved = JSON.parse(readFileSync(path, 'utf8')) as Partial<GoogleSettingsData>;
      this.data = { ...saved, sharing: saved.sharing ?? [] };
    }
  }

  get(): GoogleSettingsData {
    return structuredClone(this.data);
  }

  update(fn: (d: GoogleSettingsData) => void): GoogleSettingsData {
    const next = structuredClone(this.data);
    fn(next);
    this.data = next;
    if (this.path) {
      writeFileSync(`${this.path}.tmp`, JSON.stringify(next, null, 2));
      renameSync(`${this.path}.tmp`, this.path);
    }
    return this.get();
  }
}
