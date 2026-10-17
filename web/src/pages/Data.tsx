import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, apiUrl, errorText, getToken } from '../api';
import { useAction, usePolling } from '../hooks';

interface SharedPerson {
  email: string;
  access: 'reader' | 'writer';
  addedAt: string;
}

interface DataStatus {
  storage: 'google' | 'memory';
  redirectUri: string;
  client: { clientId: string; hasSecret: boolean } | null;
  connection: { email: string; connectedAt: string; folderUrl: string; books: Array<{ book: string; url: string }> } | null;
  pendingWrites: number;
  sharing: SharedPerson[];
  lastBackupAt: string | null;
}

interface BookUsage {
  book: string;
  title: string;
  url: string;
  cells: number;
  percent: number;
}

const BOOK_LABEL: Record<string, string> = {
  config: 'Config (locations, settings)',
  transactions: 'Transactions (tickets, tasks, payments)',
  guest: 'Guest data (customers, vehicles)',
  audit: 'Audit log',
};

const ACCESS_LABEL = { reader: 'Can view', writer: 'Can edit' } as const;

/** Data storage and Google Drive administration for operator admins (SRS FR-DATA-01..12). */
export function DataPage() {
  const { data: status, error, setData, refresh } = usePolling(() => api<DataStatus>('/google/status'), [], 10_000);
  const [params, setParams] = useSearchParams();
  const result = params.get('google');
  const resultMessage = params.get('message');

  if (!status) return <div className="muted">{error ?? 'Loading…'}</div>;

  return (
    <div className="stack">
      {result === 'connected' && <div className="notice ok">Google Drive connected. Your data is now stored in Google Sheets.</div>}
      {result === 'error' && <div className="notice error">Google connection failed: {resultMessage}</div>}
      {result && (
        <button type="button" onClick={() => setParams({})} style={{ alignSelf: 'flex-start' }}>
          Dismiss
        </button>
      )}

      <StatusCard status={status} onChanged={(s) => setData(s)} refresh={refresh} />
      {status.connection ? (
        <>
          <SheetsCard status={status} onChanged={(s) => setData(s)} />
          <SharingCard status={status} onChanged={(sharing) => setData({ ...status, sharing })} />
        </>
      ) : (
        <ConnectCard status={status} onChanged={(s) => setData(s)} />
      )}
    </div>
  );
}

function StatusCard({ status, onChanged, refresh }: { status: DataStatus; onChanged: (s: DataStatus) => void; refresh: () => Promise<void> }) {
  const action = useAction();
  const [message, setMessage] = useState<string | null>(null);

  async function downloadExcel() {
    setMessage(null);
    await action.run(async () => {
      const res = await fetch(apiUrl('/api/data/export.xlsx'), { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: `valet-data-${new Date().toISOString().slice(0, 10)}.xlsx` });
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  async function sync() {
    const res = await action.run(() => api<{ pendingWrites: number }>('/google/sync', { body: {} }));
    if (res) {
      setMessage(res.pendingWrites === 0 ? 'Everything is saved.' : `${res.pendingWrites} changes still waiting; they will be retried.`);
      await refresh();
    }
  }

  async function disconnect() {
    if (!window.confirm('Stop saving to Google Drive? The data already in Drive stays there. Until you connect again, the server keeps data in memory only.')) return;
    const res = await action.run(() => api<DataStatus>('/google/disconnect', { body: {} }));
    if (res) onChanged(res);
  }

  return (
    <div className="card stack">
      <h1>Data</h1>
      {status.connection ? (
        <div className="notice ok">
          Stored in <strong>Google Sheets</strong> in {status.connection.email}'s Google Drive · connected {new Date(status.connection.connectedAt).toLocaleString()}
        </div>
      ) : (
        <div className="notice warn">
          Stored in <strong>temporary memory</strong>: data is lost when the server restarts. Connect Google Drive below to keep it.
        </div>
      )}
      {status.connection && (
        <p className="muted" style={{ margin: 0 }}>
          Changes waiting to be saved to Google Sheets: {status.pendingWrites} (saved automatically every few seconds)
        </p>
      )}
      <div className="row">
        {status.connection && (
          <button type="button" disabled={action.busy} onClick={() => void sync()}>
            Save now
          </button>
        )}
        <button type="button" disabled={action.busy} onClick={() => void downloadExcel()}>
          Download Excel
        </button>
        {status.connection && (
          <button type="button" className="danger" disabled={action.busy} onClick={() => void disconnect()}>
            Disconnect Google
          </button>
        )}
      </div>
      {message && <div className="notice ok">{message}</div>}
      {action.error && <div className="notice error">{action.error}</div>}
    </div>
  );
}

function ConnectCard({ status, onChanged }: { status: DataStatus; onChanged: (s: DataStatus) => void }) {
  const [clientId, setClientId] = useState(status.client?.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const save = useAction();
  const connect = useAction();
  const onLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const redirectHost = new URL(status.redirectUri).host;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const res = await save.run(() => api<DataStatus>('/google/client', { method: 'PUT', body: { clientId, clientSecret: clientSecret || undefined } }));
    if (res) {
      onChanged(res);
      setClientSecret('');
    }
  }

  async function startConnect() {
    const res = await connect.run(() => api<{ url: string }>('/google/connect', { body: {} }));
    if (res) window.location.href = res.url;
  }

  return (
    <div className="card stack">
      <h2>Connect Google Drive</h2>
      <p style={{ margin: 0 }}>
        Your data will be kept in Google Sheets in your own Google account, with photos and backups in a Google Drive folder. You then decide who can open it.
      </p>

      <h3>1. Create a Google sign-in for this app (once, about 10 minutes)</h3>
      <ol style={{ margin: 0, paddingLeft: 20 }} className="stack">
        <li>
          Open{' '}
          <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">
            Google Cloud Console
          </a>{' '}
          with the Google account that should own the data, and create a project (e.g. “Valet Parking”).
        </li>
        <li>
          Turn on the{' '}
          <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">
            Google Drive API
          </a>{' '}
          and the{' '}
          <a href="https://console.cloud.google.com/apis/library/sheets.googleapis.com" target="_blank" rel="noreferrer">
            Google Sheets API
          </a>
          .
        </li>
        <li>
          Open{' '}
          <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">
            Google Auth Platform
          </a>{' '}
          (OAuth consent screen): app name “Valet Parking”, audience <strong>External</strong>, and add your Google account under <strong>Test users</strong>.
        </li>
        <li>
          Under{' '}
          <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">
            Clients
          </a>
          , create an OAuth client of type <strong>Web application</strong>, with this <strong>Authorised redirect URI</strong>:
          <div className="mono wrap" style={{ background: 'var(--surface-2)', padding: 8, borderRadius: 8, marginTop: 4 }}>
            {status.redirectUri}
          </div>
        </li>
        <li>Copy the Client ID and Client secret into the form below.</li>
      </ol>

      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          Client ID
          <input value={clientId} onChange={(e) => setClientId(e.target.value.trim())} placeholder="1234567890-abc.apps.googleusercontent.com" required />
        </label>
        <label>
          Client secret
          <span className="hint">{status.client?.hasSecret ? 'Saved. Leave empty to keep it.' : 'Kept on the server only; never shown again.'}</span>
          <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="off" required={!status.client?.hasSecret} />
        </label>
        {save.error && <div className="notice error">{save.error}</div>}
        <button type="submit" disabled={save.busy}>
          Save Google client
        </button>
      </form>

      <h3>2. Connect your Google account</h3>
      {!onLocalhost && (
        <div className="notice warn">
          Google only returns to the address registered above ({redirectHost}). Do this step on the computer running the server, at {status.redirectUri.replace('/api/google/callback', '/staff/data')}.
        </div>
      )}
      <p className="muted" style={{ margin: 0 }}>
        Google asks you to allow the app to “See, edit, create and delete only the specific Google Drive files you use with this app”. It cannot see your other files. The app then creates a “Valet data” folder and four spreadsheets, and copies the current data into them.
      </p>
      {connect.error && <div className="notice error">{connect.error}</div>}
      <button className="primary big" type="button" disabled={!status.client?.hasSecret || connect.busy} onClick={() => void startConnect()}>
        Connect Google account
      </button>
    </div>
  );
}

function SheetsCard({ status, onChanged }: { status: DataStatus; onChanged: (s: DataStatus) => void }) {
  const [usage, setUsage] = useState<BookUsage[] | null>(null);
  const [verify, setVerify] = useState<{ checked: number; problems: string[] } | null>(null);
  const [backedUp, setBackedUp] = useState<number | null>(null);
  const action = useAction();

  useEffect(() => {
    void api<BookUsage[]>('/google/usage').then(setUsage, () => setUsage(null));
  }, []);

  async function backup() {
    setBackedUp(null);
    const res = await action.run(() => api<{ copied: number; status: DataStatus }>('/google/backup', { body: {} }));
    if (res) {
      setBackedUp(res.copied);
      onChanged(res.status);
    }
  }

  return (
    <div className="card stack">
      <h2>Spreadsheets</h2>
      <div className="row">
        <a className="button primary" href={status.connection?.folderUrl} target="_blank" rel="noreferrer">
          Open Drive folder
        </a>
      </div>
      <div>
        {status.connection?.books.map((b) => {
          const u = usage?.find((x) => x.book === b.book);
          return (
            <div className="ticket-item" key={b.book}>
              <div className="stack" style={{ gap: 4, flex: 1 }}>
                <a href={b.url} target="_blank" rel="noreferrer">
                  {BOOK_LABEL[b.book] ?? b.book}
                </a>
                {u && (
                  <>
                    <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }} aria-label={`${u.percent}% of Google's cell limit`}>
                      <div style={{ width: `${Math.max(1, Math.min(100, u.percent))}%`, height: '100%', background: u.percent >= 70 ? 'var(--danger)' : 'var(--accent)' }} />
                    </div>
                    <span className="muted" style={{ fontSize: '0.85rem' }}>
                      {u.cells.toLocaleString()} cells · {u.percent}% of Google's 10 million limit
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        The tabs are managed by the app. Open them to read or build reports, but change data through the app; editing tab headers by hand can stop saving. Last backup:{' '}
        {status.lastBackupAt ? new Date(status.lastBackupAt).toLocaleString() : 'never'}.
      </p>
      <div className="row">
        <button type="button" disabled={action.busy} onClick={() => void backup()}>
          Back up now
        </button>
        <button
          type="button"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              setVerify(await api<{ checked: number; problems: string[] }>('/google/verify', { body: {} }));
            })
          }
        >
          Check &amp; repair tabs
        </button>
      </div>
      {backedUp !== null && <div className="notice ok">Copied {backedUp} spreadsheets into the Backups folder.</div>}
      {verify && (
        <div className={`notice ${verify.problems.length ? 'error' : 'ok'}`}>
          {verify.problems.length === 0 ? `All ${verify.checked} tabs are in order.` : verify.problems.map((p) => <div key={p}>{p}</div>)}
        </div>
      )}
      {action.error && <div className="notice error">{action.error}</div>}
    </div>
  );
}

function SharingCard({ status, onChanged }: { status: DataStatus; onChanged: (sharing: SharedPerson[]) => void }) {
  const [email, setEmail] = useState('');
  const [access, setAccess] = useState<'reader' | 'writer'>('reader');
  const action = useAction();

  async function add(e: FormEvent) {
    e.preventDefault();
    const res = await action.run(() => api<{ sharing: SharedPerson[] }>('/google/sharing', { body: { email, access } }));
    if (res) {
      onChanged(res.sharing);
      setEmail('');
    }
  }

  async function change(person: SharedPerson, next: 'reader' | 'writer') {
    const res = await action.run(() => api<{ sharing: SharedPerson[] }>('/google/sharing', { body: { email: person.email, access: next } }));
    if (res) onChanged(res.sharing);
  }

  async function remove(person: SharedPerson) {
    if (!window.confirm(`Remove ${person.email}'s access to the data folder?`)) return;
    const res = await action.run(() => api<{ sharing: SharedPerson[] }>(`/google/sharing/${encodeURIComponent(person.email)}`, { method: 'DELETE' }));
    if (res) onChanged(res.sharing);
  }

  return (
    <div className="card stack">
      <h2>Who can open the data</h2>
      <p style={{ margin: 0 }}>
        People you add can open the Valet data folder in Google Drive and Google Sheets on any phone, tablet or computer, signed in with that Google account. Google emails them the link.
      </p>
      <ul style={{ margin: 0, paddingLeft: 20 }} className="muted">
        <li>
          <strong>Can view</strong>: managers, accountants, owners who need reports. They can read and download, not change.
        </li>
        <li>
          <strong>Can edit</strong>: only other admins who maintain the spreadsheets. Edits made directly in the sheet bypass the app's checks.
        </li>
        <li>Guest names, mobile numbers and plates are in the Guest data spreadsheet; share it only with people who need it.</li>
      </ul>

      <div>
        <div className="ticket-item">
          <div>
            <strong>{status.connection?.email}</strong>
            <div className="muted">Owner · full access</div>
          </div>
        </div>
        {status.sharing.map((p) => (
          <div className="ticket-item" key={p.email}>
            <div style={{ minWidth: 0 }}>
              <strong className="wrap">{p.email}</strong>
              <div className="muted">Added {new Date(p.addedAt).toLocaleDateString()}</div>
            </div>
            <div className="stack" style={{ minWidth: 140 }}>
              <select value={p.access} onChange={(e) => void change(p, e.target.value as 'reader' | 'writer')} aria-label={`Access for ${p.email}`} disabled={action.busy}>
                <option value="reader">{ACCESS_LABEL.reader}</option>
                <option value="writer">{ACCESS_LABEL.writer}</option>
              </select>
              <button type="button" className="danger" disabled={action.busy} onClick={() => void remove(p)}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      <form className="row" onSubmit={(e) => void add(e)}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" required style={{ flex: '2 1 200px' }} aria-label="Email to share with" />
        <select value={access} onChange={(e) => setAccess(e.target.value as 'reader' | 'writer')} style={{ flex: '1 1 120px' }} aria-label="Access level">
          <option value="reader">{ACCESS_LABEL.reader}</option>
          <option value="writer">{ACCESS_LABEL.writer}</option>
        </select>
        <button className="primary" type="submit" disabled={action.busy}>
          Share
        </button>
      </form>
      {action.error && <div className="notice error">{errorText(new Error(action.error))}</div>}
    </div>
  );
}
