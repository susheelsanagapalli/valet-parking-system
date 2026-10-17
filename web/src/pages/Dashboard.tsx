import { api } from '../api';
import { usePolling } from '../hooks';
import { useSession } from '../session';
import { STATUS_LABEL, type TicketStatus } from '../types';

interface Dashboard {
  byStatus: Partial<Record<TicketStatus, number>>;
  carsParked: number;
  openRequests: number;
  pendingPayments: number;
}

export function DashboardPage() {
  const { location } = useSession();
  const locationId = location?.id ?? '';
  const { data, error } = usePolling(() => api<Dashboard>(`/locations/${locationId}/dashboard`), [locationId]);
  if (!data) return <div className="muted">{error ?? 'Loading…'}</div>;

  return (
    <div className="stack">
      <div className="grid">
        {[
          ['Cars parked', data.carsParked],
          ['Open requests', data.openRequests],
          ['Ready for pickup', data.byStatus.ready_for_pickup ?? 0],
          ['QR payments to verify', data.pendingPayments],
        ].map(([label, value]) => (
          <div className="card stat" key={String(label)}>
            <div className="value">{value}</div>
            <div className="muted">{label}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <h2>Tickets by status</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => (
              <tr key={s} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 0' }}>{STATUS_LABEL[s]}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{data.byStatus[s] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
