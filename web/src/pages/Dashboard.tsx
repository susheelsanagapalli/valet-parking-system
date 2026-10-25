import { Car, CheckCircle2, Clock, LogIn, LogOut, MapPin, Search, Wallet, Zap, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge, spotDescription } from '../components/TicketSummary';
import { formatDuration, formatRupees, maskMobile, minutesSince, timeAgo } from '../format';
import { usePolling } from '../hooks';
import { useSession } from '../session';
import { STATUS_LABEL, type StaffTicket, type TicketStatus } from '../types';

interface Dashboard {
  byStatus: Partial<Record<TicketStatus, number>>;
  carsParked: number;
  openRequests: number;
  pendingPayments: number;
}

const ON_SITE = 'checked_in,parked,retrieval_requested,assigned_in_transit,ready_for_pickup,out';

/** Work waiting on an attendant, derived from the ticket status. */
interface PendingWork {
  ticket: StaffTicket;
  kind: 'park' | 'retrieve' | 'bring';
  since: string;
}

function pendingWork(tickets: StaffTicket[]): PendingWork[] {
  const work: PendingWork[] = [];
  for (const t of tickets) {
    if (t.status === 'checked_in') work.push({ ticket: t, kind: 'park', since: t.checked_in_at });
    if (t.status === 'retrieval_requested') work.push({ ticket: t, kind: 'retrieve', since: t.requested_at ?? t.checked_in_at });
    if (t.status === 'assigned_in_transit') work.push({ ticket: t, kind: 'bring', since: t.requested_at ?? t.checked_in_at });
  }
  return work.sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
}

const WORK: Record<PendingWork['kind'], { label: string; icon: LucideIcon; tone: string; state: string }> = {
  park: { label: 'Park', icon: LogIn, tone: 'tone-info', state: 'Waiting' },
  retrieve: { label: 'Retrieve', icon: LogOut, tone: 'tone-warn', state: 'Waiting' },
  bring: { label: 'Bring', icon: Zap, tone: 'tone-indigo', state: 'On the way' },
};

export function DashboardPage() {
  const { location } = useSession();
  const navigate = useNavigate();
  const locationId = location?.id ?? '';
  const [search, setSearch] = useState('');
  const { data, error } = usePolling(() => api<Dashboard>(`/locations/${locationId}/dashboard`), [locationId]);
  const tickets = usePolling(() => api<StaffTicket[]>(`/locations/${locationId}/tickets?status=${ON_SITE}`), [locationId]);
  if (!data) return <div className="muted">{error ?? 'Loading…'}</div>;

  const stats: Array<{ label: string; value: number; icon: LucideIcon; tone: string }> = [
    { label: 'Cars parked', value: data.carsParked, icon: Car, tone: 'tone-info' },
    { label: 'Open requests', value: data.openRequests, icon: Zap, tone: 'tone-warn' },
    { label: 'Ready for pickup', value: data.byStatus.ready_for_pickup ?? 0, icon: CheckCircle2, tone: 'tone-ok' },
    { label: 'Payments to verify', value: data.pendingPayments, icon: Wallet, tone: 'tone-purple' },
  ];

  const all = tickets.data ?? [];
  const q = search.trim().toLowerCase();
  const shown = q
    ? all.filter((t) => [t.ticket_number, t.plate_number ?? '', t.guest_mobile ?? '', t.key_tag].some((v) => v.toLowerCase().includes(q)))
    : all;
  const work = pendingWork(all);
  const hasWork = new Set(work.map((w) => w.ticket.id));
  const open = (t: StaffTicket) => navigate(`../cars?q=${encodeURIComponent(t.ticket_number)}`);

  return (
    <div className="stack">
      <div className="page-title" style={{ marginBottom: 0 }}>
        <div>
          <h1>{location?.name}</h1>
          {location?.address && (
            <p className="muted label-text">
              <MapPin size={16} aria-hidden /> {location.address}
            </p>
          )}
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 0 }}>
        {stats.map(({ label, value, icon: Icon, tone }) => (
          <div className="stat-tile" key={label}>
            <div className="top">
              <span className="label">{label}</span>
              <span className={`icon-tile sm ${tone}`} aria-hidden>
                <Icon size={18} />
              </span>
            </div>
            <span className="value">{value}</span>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <div className="card-title" style={{ flexWrap: 'wrap' }}>
          <h2>Active vehicles</h2>
          <span className="muted tabular">{all.length}</span>
          <div className="search end" style={{ flex: '0 1 280px' }}>
            <Search size={18} aria-hidden />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search plate, ticket, key…" aria-label="Search active vehicles" />
          </div>
        </div>
        {tickets.error && <div className="notice error">{tickets.error}</div>}
        {!tickets.data && !tickets.error && <p className="muted">Loading…</p>}
        {tickets.data && shown.length === 0 && (
          <EmptyState icon={Car} title={q ? 'No matching vehicles' : 'No active vehicles'} hint={q ? 'Try the plate, ticket number or key tag.' : 'Check in a car to begin.'} />
        )}
        <div className="list">
          {shown.map((t) => (
            <button key={t.id} type="button" className="list-row" onClick={() => open(t)}>
              <span className="icon-tile" aria-hidden>
                <Car size={20} />
              </span>
              <span className="main">
                <span className="line">
                  <strong className="mono">{t.ticket_number}</strong>
                  <strong style={{ textTransform: 'uppercase' }}>{t.plate_number}</strong>
                  {hasWork.has(t.id) && <span className="pill">Task</span>}
                </span>
                <span className="sub">
                  {[maskMobile(t.guest_mobile), [t.colour, t.make].filter(Boolean).join(' ') || null, t.spot_text || (t.zone_code ? spotDescription(t) : null)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="side">
                <StatusBadge status={t.status} />
                <span className="muted tabular label-text">
                  <Clock size={14} aria-hidden />
                  {formatDuration(minutesSince(t.checked_in_at))}
                </span>
                {t.balance_due > 0 ? (
                  <span className="tabular">
                    <strong>{formatRupees(t.balance_due)}</strong> <span className="muted">due</span>
                  </span>
                ) : (
                  t.fee_amount > 0 && <span className="pill ok">Paid</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

      {work.length > 0 && (
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-title">
            <h2>Pending tasks</h2>
            <span className="muted end tabular">{work.length} open</span>
          </div>
          <div className="list">
            {work.slice(0, 6).map(({ ticket, kind, since }) => {
              const w = WORK[kind];
              return (
                <button key={ticket.id} type="button" className="list-row" onClick={() => open(ticket)}>
                  <span className={`icon-tile sm ${w.tone}`} aria-hidden>
                    <w.icon size={18} />
                  </span>
                  <span className="main">
                    <span className="line">
                      <strong>{w.label}</strong>
                      <span className="mono">{ticket.ticket_number}</span>
                      <span>· {ticket.plate_number}</span>
                    </span>
                    <span className="sub">{timeAgo(since)}</span>
                  </span>
                  <span className={`pill${kind === 'bring' ? ' info' : ''}`}>{w.state}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 700, minHeight: 32 }}>All tickets by status</summary>
        <div className="list" style={{ marginTop: 8 }}>
          {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => (
            <div key={s} className="list-row" style={{ minHeight: 48 }}>
              <span className="main">
                <StatusBadge status={s} />
              </span>
              <strong className="tabular">{data.byStatus[s] ?? 0}</strong>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
