import { google } from 'googleapis';
import { GoogleSheetStore, createBooks, type BookKind, type SheetStore } from '@valet/sheets-integration';
import { DrivePhotoStore, type PhotoStore } from '../photos.js';
import type { GoogleClient, GoogleConnection } from './settings.js';

/** drive.file: VPS sees only the files it creates, never the rest of the operator's Drive (NFR-SEC-05). */
export const OAUTH_SCOPES = ['https://www.googleapis.com/auth/drive.file', 'openid', 'email'];
const CELL_LIMIT = 10_000_000;

export interface BookUsage {
  book: BookKind;
  title: string;
  url: string;
  cells: number;
  percent: number;
}

/** Everything the server needs from Google; replaced by a fake in tests. */
export interface GoogleConnector {
  authUrl(client: GoogleClient, redirectUri: string, state: string): string;
  exchange(client: GoogleClient, redirectUri: string, code: string): Promise<{ refreshToken: string; email: string }>;
  /** Creates the data folder with Photos and Backups subfolders and the four spreadsheets. */
  setup(client: GoogleClient, refreshToken: string, appName: string): Promise<Pick<GoogleConnection, 'folderId' | 'photosFolderId' | 'backupsFolderId' | 'books'>>;
  sheetStore(client: GoogleClient, conn: GoogleConnection): SheetStore;
  photoStore(client: GoogleClient, conn: GoogleConnection): PhotoStore;
  share(client: GoogleClient, conn: GoogleConnection, email: string, access: 'reader' | 'writer'): Promise<string>;
  unshare(client: GoogleClient, conn: GoogleConnection, permissionId: string): Promise<void>;
  backup(client: GoogleClient, conn: GoogleConnection): Promise<number>;
  usage(client: GoogleClient, conn: GoogleConnection): Promise<BookUsage[]>;
  revoke(client: GoogleClient, conn: GoogleConnection): Promise<void>;
}

const FOLDER = 'application/vnd.google-apps.folder';

export class RealGoogleConnector implements GoogleConnector {
  private oauth(client: GoogleClient, redirectUri?: string, refreshToken?: string) {
    const auth = new google.auth.OAuth2(client.clientId, client.clientSecret, redirectUri);
    if (refreshToken) auth.setCredentials({ refresh_token: refreshToken });
    return auth;
  }

  authUrl(client: GoogleClient, redirectUri: string, state: string): string {
    return this.oauth(client, redirectUri).generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: OAUTH_SCOPES, state, include_granted_scopes: true });
  }

  async exchange(client: GoogleClient, redirectUri: string, code: string) {
    const auth = this.oauth(client, redirectUri);
    const { tokens } = await auth.getToken(code);
    if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.');
    auth.setCredentials(tokens);
    const info = await google.oauth2({ version: 'v2', auth }).userinfo.get();
    return { refreshToken: tokens.refresh_token, email: info.data.email ?? 'unknown' };
  }

  async setup(client: GoogleClient, refreshToken: string, appName: string) {
    const auth = this.oauth(client, undefined, refreshToken);
    const drive = google.drive({ version: 'v3', auth });
    const folder = async (name: string, parent?: string) => {
      const res = await drive.files.create({ requestBody: { name, mimeType: FOLDER, parents: parent ? [parent] : undefined }, fields: 'id' });
      if (!res.data.id) throw new Error(`Could not create the folder "${name}"`);
      return res.data.id;
    };
    const folderId = await folder(`${appName} – Valet data`);
    const photosFolderId = await folder('Photos', folderId);
    const backupsFolderId = await folder('Backups', folderId);
    const books = await createBooks({ auth, folderId, appName });
    return { folderId, photosFolderId, backupsFolderId, books };
  }

  sheetStore(client: GoogleClient, conn: GoogleConnection): SheetStore {
    return new GoogleSheetStore({ sheets: google.sheets({ version: 'v4', auth: this.oauth(client, undefined, conn.refreshToken) }), books: conn.books });
  }

  photoStore(client: GoogleClient, conn: GoogleConnection): PhotoStore {
    return new DrivePhotoStore(google.drive({ version: 'v3', auth: this.oauth(client, undefined, conn.refreshToken) }), conn.photosFolderId);
  }

  async share(client: GoogleClient, conn: GoogleConnection, email: string, access: 'reader' | 'writer') {
    const drive = google.drive({ version: 'v3', auth: this.oauth(client, undefined, conn.refreshToken) });
    const res = await drive.permissions.create({
      fileId: conn.folderId,
      requestBody: { type: 'user', role: access, emailAddress: email },
      sendNotificationEmail: true,
      emailMessage: 'You now have access to the valet parking data in Google Drive.',
      fields: 'id',
    });
    if (!res.data.id) throw new Error('Google did not confirm the sharing');
    return res.data.id;
  }

  async unshare(client: GoogleClient, conn: GoogleConnection, permissionId: string) {
    const drive = google.drive({ version: 'v3', auth: this.oauth(client, undefined, conn.refreshToken) });
    await drive.permissions.delete({ fileId: conn.folderId, permissionId });
  }

  /** Copies each spreadsheet into the Backups folder (NFR-REC-01). */
  async backup(client: GoogleClient, conn: GoogleConnection) {
    const drive = google.drive({ version: 'v3', auth: this.oauth(client, undefined, conn.refreshToken) });
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    let copied = 0;
    for (const id of Object.values(conn.books)) {
      const meta = await drive.files.get({ fileId: id, fields: 'name' });
      await drive.files.copy({ fileId: id, requestBody: { name: `${meta.data.name ?? 'Valet data'} – backup ${stamp}`, parents: [conn.backupsFolderId] } });
      copied++;
    }
    return copied;
  }

  /** Cells used per spreadsheet against Google's 10 million cell limit (FR-DATA-12). */
  async usage(client: GoogleClient, conn: GoogleConnection) {
    const sheets = google.sheets({ version: 'v4', auth: this.oauth(client, undefined, conn.refreshToken) });
    const out: BookUsage[] = [];
    for (const [book, id] of Object.entries(conn.books) as Array<[BookKind, string]>) {
      const res = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'properties.title,sheets.properties.gridProperties' });
      const cells = (res.data.sheets ?? []).reduce((n, s) => n + (s.properties?.gridProperties?.rowCount ?? 0) * (s.properties?.gridProperties?.columnCount ?? 0), 0);
      out.push({ book, title: res.data.properties?.title ?? book, url: `https://docs.google.com/spreadsheets/d/${id}`, cells, percent: Math.round((cells / CELL_LIMIT) * 1000) / 10 });
    }
    return out;
  }

  async revoke(client: GoogleClient, conn: GoogleConnection) {
    await this.oauth(client).revokeToken(conn.refreshToken).catch(() => undefined);
  }
}

