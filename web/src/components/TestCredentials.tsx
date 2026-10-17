import { useEffect, useState } from 'react';
import { api } from '../api';
import { STATUS_LABEL, type TicketStatus } from '../types';

interface DemoCredentials {
  notice: string;
  password: string;
  users: Array<{ username: string; name: string; role: string }>;
  guestTickets: Array<{ ticketNumber: string; location: string; status: TicketStatus; guestLink: string; pin: string | null }>;
}

const ROLE_LABEL: Record<string, string> = {
  platform_admin: 'Platform admin',
  operator_admin: 'Operator admin',
  location_manager: 'Location manager',
  supervisor: 'Supervisor',
  attendant: 'Attendant',
  merchant_validator: 'Merchant validator',
};

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
        Guests don't sign in: open a ticket link, ideally in a private window or on your phone. The PIN is what the guest tells the attendant at handover.
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
    </section>
  );
}
