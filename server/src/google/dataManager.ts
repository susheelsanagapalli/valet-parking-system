import { MemorySheetStore, TABS, ValetSheetsRepository, type SheetStore } from '@valet/sheets-integration';
import type { PhotoStore } from '../photos.js';
import type { Swappable } from '../runtime.js';
import type { BookUsage, GoogleConnector } from './connector.js';
import type { GoogleClient, GoogleConnection, GoogleSettingsStore, SharedPerson } from './settings.js';

export interface DataManagerOptions {
  repo: Swappable<ValetSheetsRepository>;
  photos: Swappable<PhotoStore>;
  localPhotos: PhotoStore;
  connector: GoogleConnector;
  settings: GoogleSettingsStore;
  pinSecret: string;
  queuePath?: string;
  redirectUri: string;
  onWriteError?: (err: unknown) => void;
  now?: () => Date;
}

export interface DataStatus {
  storage: 'google' | 'memory';
  redirectUri: string;
  client: { clientId: string; hasSecret: boolean } | null;
  connection: {
    email: string;
    connectedAt: string;
    connectedBy: string;
    folderUrl: string;
    books: Array<{ book: string; url: string }>;
  } | null;
  pendingWrites: number;
  sharing: SharedPerson[];
  lastBackupAt: string | null;
}

const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;
const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}`;

/**
 * Connects the operator's Google account and keeps the running server on it: the spreadsheets are
 * the data store, photos go to Drive, and admins share the data folder with staff (FR-DATA-01..12).
 */
export class DataManager {
  constructor(private readonly o: DataManagerOptions) {}

  private requireClient(): GoogleClient {
    const client = this.o.settings.get().client;
    if (!client?.clientId || !client.clientSecret) throw new Error('Enter the Google OAuth client ID and secret first');
    return client;
  }

  private requireConnection(): { client: GoogleClient; conn: GoogleConnection } {
    const conn = this.o.settings.get().connection;
    if (!conn) throw new Error('Google is not connected');
    return { client: this.requireClient(), conn };
  }

  status(): DataStatus {
    const s = this.o.settings.get();
    return {
      storage: s.connection ? 'google' : 'memory',
      redirectUri: this.o.redirectUri,
      client: s.client ? { clientId: s.client.clientId, hasSecret: Boolean(s.client.clientSecret) } : null,
      connection: s.connection
        ? {
            email: s.connection.email,
            connectedAt: s.connection.connectedAt,
            connectedBy: s.connection.connectedBy,
            folderUrl: folderUrl(s.connection.folderId),
            books: Object.entries(s.connection.books).map(([book, id]) => ({ book, url: sheetUrl(id) })),
          }
        : null,
      pendingWrites: this.o.repo.current.queue.pending,
      sharing: s.sharing,
      lastBackupAt: s.lastBackupAt ?? null,
    };
  }

  setClient(clientId: string, clientSecret: string | undefined, by: string): void {
    void by;
    this.o.settings.update((d) => {
      const keep = d.client?.clientId === clientId ? d.client.clientSecret : '';
      d.client = { clientId: clientId.trim(), clientSecret: clientSecret?.trim() || keep };
    });
  }

  authUrl(state: string): string {
    if (this.o.settings.get().connection) throw new Error('Google is already connected. Disconnect it first to use another account.');
    return this.o.connector.authUrl(this.requireClient(), this.o.redirectUri, state);
  }

  /** Repository on a store, loaded; when the store is empty, the current data is copied in. */
  private async repositoryOn(store: SheetStore, copyFrom?: ValetSheetsRepository, by = 'system', persist = true): Promise<ValetSheetsRepository> {
    const repo = new ValetSheetsRepository({
      store,
      pinSecret: this.o.pinSecret,
      persistPath: persist ? this.o.queuePath : undefined,
      onWriteError: this.o.onWriteError,
      now: this.o.now,
    });
    await repo.load();
    if (copyFrom && repo.listLocations().length === 0) {
      repo.importRows(copyFrom.exportRows(), by);
      await repo.flush();
    }
    return repo;
  }

  /** Finishes the Google sign-in: creates the Drive folder and spreadsheets, copies the data in and switches to them. */
  async connect(code: string, by: string, appName: string): Promise<void> {
    const client = this.requireClient();
    const { refreshToken, email } = await this.o.connector.exchange(client, this.o.redirectUri, code);
    const files = await this.o.connector.setup(client, refreshToken, appName);
    const conn: GoogleConnection = { ...files, email, refreshToken, connectedAt: (this.o.now?.() ?? new Date()).toISOString(), connectedBy: by };

    const old = this.o.repo.current;
    await old.flush().catch(() => undefined);
    const next = await this.repositoryOn(this.o.connector.sheetStore(client, conn), old, by);
    this.o.settings.update((d) => {
      d.connection = conn;
      d.sharing = [];
    });
    this.o.repo.current = next;
    this.o.photos.current = this.o.connector.photoStore(client, conn);
    await old.close().catch(() => undefined);
  }

  /** Stops using Google; the data stays in the operator's Drive and the server keeps a copy in memory. */
  async disconnect(): Promise<void> {
    const { client, conn } = this.requireConnection();
    const old = this.o.repo.current;
    await old.flush();
    const next = await this.repositoryOn(new MemorySheetStore(), old, 'system', false);
    this.o.repo.current = next;
    this.o.photos.current = this.o.localPhotos;
    this.o.settings.update((d) => {
      delete d.connection;
      d.sharing = [];
    });
    await this.o.connector.revoke(client, conn);
  }

  /** Repository for start-up: Google when connected, otherwise undefined. */
  async startupRepository(): Promise<{ repo: ValetSheetsRepository; photos: PhotoStore } | undefined> {
    const s = this.o.settings.get();
    if (!s.connection || !s.client) return undefined;
    const repo = await this.repositoryOn(this.o.connector.sheetStore(s.client, s.connection));
    return { repo, photos: this.o.connector.photoStore(s.client, s.connection) };
  }

  async sync(): Promise<number> {
    await this.o.repo.current.flush();
    return this.o.repo.current.queue.pending;
  }

  async backup(): Promise<number> {
    const { client, conn } = this.requireConnection();
    await this.o.repo.current.flush();
    const copied = await this.o.connector.backup(client, conn);
    this.o.settings.update((d) => {
      d.lastBackupAt = (this.o.now?.() ?? new Date()).toISOString();
    });
    return copied;
  }

  /** Re-creates missing tabs and headers and reports tabs whose columns were changed by hand. */
  async verify(): Promise<{ checked: number; problems: string[] }> {
    const { client, conn } = this.requireConnection();
    const store = this.o.connector.sheetStore(client, conn);
    const problems: string[] = [];
    for (const t of TABS) {
      try {
        await store.ensureTab(t);
      } catch (e) {
        problems.push(`${t.name}: ${(e as Error).message}`);
      }
    }
    return { checked: TABS.length, problems };
  }

  usage(): Promise<BookUsage[]> {
    const { client, conn } = this.requireConnection();
    return this.o.connector.usage(client, conn);
  }

  /** Gives someone view or edit access to the data folder, or changes their access (FR-DATA-09). */
  async share(email: string, access: 'reader' | 'writer', by: string): Promise<SharedPerson[]> {
    const { client, conn } = this.requireConnection();
    const normalized = email.trim().toLowerCase();
    if (normalized === conn.email.toLowerCase()) throw new Error('That is the account that owns the data; it already has full access');
    const existing = this.o.settings.get().sharing.find((p) => p.email === normalized);
    if (existing) await this.o.connector.unshare(client, conn, existing.permissionId);
    const permissionId = await this.o.connector.share(client, conn, normalized, access);
    return this.o.settings.update((d) => {
      d.sharing = [
        ...d.sharing.filter((p) => p.email !== normalized),
        { email: normalized, access, permissionId, addedBy: by, addedAt: (this.o.now?.() ?? new Date()).toISOString() },
      ];
    }).sharing;
  }

  async unshare(email: string): Promise<SharedPerson[]> {
    const { client, conn } = this.requireConnection();
    const person = this.o.settings.get().sharing.find((p) => p.email === email.trim().toLowerCase());
    if (!person) throw new Error('That person does not have access');
    await this.o.connector.unshare(client, conn, person.permissionId);
    return this.o.settings.update((d) => {
      d.sharing = d.sharing.filter((p) => p.email !== person.email);
    }).sharing;
  }
}
