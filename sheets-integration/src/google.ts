import { google, type drive_v3, type sheets_v4 } from 'googleapis';
import { TABS, type BookKind } from './schema.js';
import { GoogleSheetStore } from './store/GoogleSheetStore.js';

/** Only files created or picked by VPS are accessible (SRS NFR-SEC-05). */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];

export type GoogleEnv = Record<string, string | undefined>;

/** OAuth with the operator's own account (FR-DATA-01), or a service account key for development. */
export function createGoogleAuth(env: GoogleEnv = process.env) {
  if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    const client = new google.auth.OAuth2(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET);
    client.setCredentials({ refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN });
    return client;
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    return new google.auth.GoogleAuth({ keyFile: env.GOOGLE_APPLICATION_CREDENTIALS, scopes: GOOGLE_SCOPES });
  }
  throw new Error('Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REFRESH_TOKEN, or GOOGLE_APPLICATION_CREDENTIALS');
}

export type GoogleAuthClient = ReturnType<typeof createGoogleAuth>;

export function sheetsClient(auth: GoogleAuthClient): sheets_v4.Sheets {
  return google.sheets({ version: 'v4', auth });
}

export function driveClient(auth: GoogleAuthClient): drive_v3.Drive {
  return google.drive({ version: 'v3', auth });
}

export const BOOK_ENV: Record<BookKind, string> = {
  config: 'SHEET_CONFIG_ID',
  transactions: 'SHEET_TRANSACTIONS_ID',
  guest: 'SHEET_GUEST_ID',
  audit: 'SHEET_AUDIT_ID',
};

export function booksFromEnv(env: Record<string, string | undefined> = process.env): Record<BookKind, string> {
  const books = {} as Record<BookKind, string>;
  for (const [book, key] of Object.entries(BOOK_ENV) as Array<[BookKind, string]>) {
    const id = env[key];
    if (!id) throw new Error(`${key} is not set; run npm run setup:google first`);
    books[book] = id;
  }
  return books;
}

export function bookTitle(book: BookKind, appName: string, month: string): string {
  switch (book) {
    case 'config':
      return `${appName} – Config`;
    case 'transactions':
      return `${appName} – Transactions ${month}`;
    case 'guest':
      return `${appName} – Guest data ${month}`;
    case 'audit':
      return `${appName} – Audit log ${month}`;
  }
}

/**
 * Creates the four books in a Drive folder (SRS 6.4), creates every tab with headers and dropdowns,
 * and removes the default empty sheet. Returns the spreadsheet id of each book.
 */
export async function createBooks(options: {
  auth: GoogleAuthClient;
  folderId?: string;
  appName: string;
  month?: string;
}): Promise<Record<BookKind, string>> {
  const drive = driveClient(options.auth);
  const sheets = sheetsClient(options.auth);
  const month = options.month ?? new Date().toISOString().slice(0, 7);
  const books = {} as Record<BookKind, string>;

  for (const book of Object.keys(BOOK_ENV) as BookKind[]) {
    const file = await drive.files.create({
      requestBody: {
        name: bookTitle(book, options.appName, month),
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: options.folderId ? [options.folderId] : undefined,
      },
      fields: 'id',
      supportsAllDrives: true,
    });
    if (!file.data.id) throw new Error(`Could not create the ${book} spreadsheet`);
    books[book] = file.data.id;
  }

  const store = new GoogleSheetStore({ sheets, books });
  for (const t of TABS) await store.ensureTab(t);

  for (const spreadsheetId of Object.values(books)) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' });
    const ours = new Set(TABS.map((t) => t.name));
    const extra = (meta.data.sheets ?? []).filter((s) => s.properties?.title && !ours.has(s.properties.title));
    const keep = (meta.data.sheets ?? []).length - extra.length;
    if (keep > 0 && extra.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: extra.map((s) => ({ deleteSheet: { sheetId: s.properties?.sheetId ?? 0 } })) },
      });
    }
  }
  return books;
}
