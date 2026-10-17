import { useEffect, useState } from 'react';
import { IS_BROWSER_DEMO, api, setToken } from '../api';
import { STATUS_LABEL, type TicketStatus } from '../types';

interface DemoCredentials {
  notice: string;
  password: string;
  users: Array<{ username: string; name: string; role: string }>;
  guestTickets: Array<{ ticketNumber: string; location: string; status: TicketStatus; guestLink: string; pin: string | null }>;
  smsProvider: string;
  sms: Array<{ at: string; ticketNumber: string; to: string; text: string; status: 'sending' | 'sent' | 'failed' | 'awaiting_tap' | 'opened'; attempts: number; error?: string }>;
}

const SMS_STATUS: Record<string, { label: string; badge: string }> = {
  sending: { label: 'Sending', badge: 'retrieval_requested' },
  sent: { label: 'Sent', badge: 'ready_for_pickup' },
  failed: { label: 'Failed', badge: 'cancelled' },
  awaiting_tap: { label: 'Waiting for staff to send', badge: 'retrieval_requested' },
  opened: { label: 'Opened in Messages', badge: 'ready_for_pickup' },
};

const PROVIDER_LABEL: Record<string, string> = {
  off: 'off',
  manual: 'tap-to-send from the staff phone (iPhone or Android)',
  log: 'test mode (shown here, not sent)',
  smsgate: 'SMS Gateway for Android',
  httpsms: 'httpSMS',
};

const ROLE_LABEL: Record<string, string> = {
  platform_admin: 'Platform admin',
  operator_admin: 'Operator admin',
  location_manager: 'Location manager',
  supervisor: 'Supervisor',
  attendant: 'Attendant',
  merchant_validator: 'Merchant validator',
};

/**
 * Phones only allow GPS and the live camera on https pages. The test server also runs on https
 * (port 8443) with its own certificate, which the phone must trust once.
 */
function PhoneHttpsHelp() {
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const httpsUrl = `https://${host}:8443/login`;
  const certUrl = `http://${host}:8080/dev-cert.crt`;
  if (window.isSecureContext && !isLocal) return <div className="notice ok">Secure address: GPS and the live camera work on this phone.</div>;
  return (
    <details>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>GPS and camera on phones</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <p style={{ margin: 0 }}>
          Phones only share GPS and the live camera with secure (https) pages. {isLocal ? 'On a phone, use this computer’s network address with https.' : 'This address is http, so on a phone open the https address instead:'}
        </p>
        {!isLocal && (
          <a href={httpsUrl} className="mono wrap">
            {httpsUrl}
          </a>
        )}
        <strong>Trust the test certificate once</strong>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            On the phone, open{' '}
            <a href={certUrl} className="mono wrap">
              {isLocal ? 'http://<this computer’s IP>:8080/dev-cert.crt' : certUrl}
            </a>{' '}
            and allow the download.
          </li>
          <li>
            <strong>iPhone:</strong> Settings → General → VPN & Device Management → install “Valet Parking test server”. Then Settings → General → About → Certificate Trust Settings → switch it on.
          </li>
          <li>
            <strong>Android:</strong> Settings → Security → Encryption & credentials → Install a certificate → CA certificate → choose the downloaded file.
          </li>
          <li>Open the https address above. The browser no longer warns, and Capture location and Scan QR use the GPS and camera.</li>
        </ol>
        <p className="muted" style={{ margin: 0 }}>
          This is only for testing. The live site will use a normal https certificate, with nothing to install.
        </p>
      </div>
    </details>
  );
}

/**
 * All test logins and guest ticket links in one place. The server only answers in demo mode, so
 * this renders nothing in production.
 */
export function TestCredentials({ onUse }: { onUse: (username: string, password: string) => void }) {
  const [data, setData] = useState<DemoCredentials | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setData(await api<DemoCredentials>('/demo/credentials', { auth: false }));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!data) return null;

  return (
    <section className="card stack" aria-labelledby="test-credentials">
      <h2 id="test-credentials">Test credentials</h2>
      <div className="notice warn">{data.notice}</div>

      {IS_BROWSER_DEMO ? (
        <button
          type="button"
          onClick={() => {
            if (!window.confirm('Delete all demo data on this device and start again with the sample cars?')) return;
            void import('../demo/demoServer').then(({ resetDemoData }) => {
              resetDemoData();
              setToken(null);
              window.location.reload();
            });
          }}
        >
          Reset demo data
        </button>
      ) : (
        <PhoneHttpsHelp />
      )}

      <h3>Staff</h3>
      <p className="muted" style={{ margin: 0 }}>
        Password for every account: <strong className="mono">{data.password}</strong>
      </p>
      <div>
        {data.users.map((u) => (
          <div className="ticket-item" key={u.username}>
            <div>
              <strong className="mono">{u.username}</strong>
              <div className="muted">
                {ROLE_LABEL[u.role] ?? u.role} · {u.name}
              </div>
            </div>
            <button type="button" onClick={() => onUse(u.username, data.password)}>
              Use
            </button>
          </div>
        ))}
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Guest tickets</h3>
        <button type="button" disabled={loading} onClick={() => void load()}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {IS_BROWSER_DEMO
          ? 'Guests don’t sign in: open a ticket link in another tab of this same browser (a private window or another phone has its own separate demo data). The PIN is what the guest tells the attendant at handover.'
          : 'Guests don’t sign in: open a ticket link, ideally in a private window or on your phone. The PIN is what the guest tells the attendant at handover.'}
      </p>
      {data.guestTickets.length === 0 && <p className="muted">No open tickets. Check in a car as an attendant to create one.</p>}
      <div>
        {data.guestTickets.map((t) => (
          <div className="ticket-item" key={t.guestLink}>
            <div className="stack" style={{ gap: 2 }}>
              <div className="row">
                <strong className="mono">{t.ticketNumber}</strong>
                <span className={`badge ${t.status}`}>{STATUS_LABEL[t.status]}</span>
              </div>
              <span className="muted">{t.location}</span>
              <span>
                PIN <strong className="mono">{t.pin ?? '—'}</strong>
              </span>
            </div>
            <a className="button" href={t.guestLink} target="_blank" rel="noreferrer">
              Open guest page
            </a>
          </div>
        ))}
      </div>

      <h3>Recent SMS</h3>
      <p className="muted" style={{ margin: 0 }}>
        SMS: <strong>{PROVIDER_LABEL[data.smsProvider] ?? data.smsProvider}</strong>
      </p>
      {data.sms.length === 0 && <p className="muted">No messages yet. Check in a car with a guest mobile number.</p>}
      <div>
        {data.sms.map((m) => (
          <div className="ticket-item" key={`${m.at}-${m.to}-${m.text.length}`}>
            <div className="stack" style={{ gap: 2 }}>
              <div className="row">
                <span className="mono">{m.to}</span>
                <span className={`badge ${SMS_STATUS[m.status]?.badge ?? ''}`}>
                  {m.status === 'sent' && data.smsProvider === 'log' ? 'Logged' : (SMS_STATUS[m.status]?.label ?? m.status)}
                </span>
                <span className="muted">
                  {m.ticketNumber} · {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <span className="wrap">{m.text}</span>
              {m.error && (
                <span className="muted">
                  {m.attempts} attempts: {m.error}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
