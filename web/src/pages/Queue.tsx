import { api } from '../api';
import { HandoverPanel } from '../components/HandoverPanel';
import { TicketSummary } from '../components/TicketSummary';
import { useAction, usePolling } from '../hooks';
import { useSession } from '../session';
import type { LocationSettings, StaffTicket, TaskRow } from '../types';

interface QueueResponse {
  queue: Array<{ task: TaskRow; ticket: StaffTicket }>;
  mine: StaffTicket[];
}

export function QueuePage() {
  const { location, can } = useSession();
  const locationId = location?.id ?? '';
  const { data, error, refresh } = usePolling(() => api<QueueResponse>(`/locations/${locationId}/queue`), [locationId]);
  const settings = usePolling(() => api<LocationSettings>(`/locations/${locationId}/settings`), [locationId], 0).data;
  const action = useAction();

  const act = async (fn: () => Promise<unknown>) => {
    if (await action.run(fn)) await refresh();
  };

  if (!data || !settings) return <div className="muted">{error ?? 'Loading…'}</div>;

  return (
    <div className="stack">
      {action.error && <div className="notice error">{action.error}</div>}
      {data.mine.map((t) => (
        <div className="card" key={t.id}>
          <h2>{t.status === 'ready_for_pickup' ? 'Hand over' : 'Bring this car'}</h2>
          <TicketSummary ticket={t} />
          <p className="muted">Pickup point: {t.pickup_point ?? settings.pickupPoints[0]}</p>
          {t.status === 'assigned_in_transit' ? (
            <button className="primary big" type="button" disabled={action.busy} onClick={() => void act(() => api(`/tickets/${t.id}/ready`, { body: {} }))}>
              Car is at the pickup point
            </button>
          ) : (
            <>
              <HandoverPanel ticket={t} settings={settings} onChanged={() => void refresh()} />
              {can('tasks.assign') && (
                <button type="button" onClick={() => void act(() => api(`/tickets/${t.id}/repark`, { body: {} }))}>
                  Guest did not come — park again
                </button>
              )}
            </>
          )}
        </div>
      ))}

      <div className="card">
        <h2>Queue ({data.queue.length})</h2>
        {data.queue.length === 0 && <p className="muted">No cars requested right now.</p>}
        {data.queue.map(({ task, ticket }) => (
          <TicketSummary key={task.id} ticket={ticket}>
            {task.priority > 0 && <span className="badge retrieval_requested">Priority {task.priority}</span>}
            <button className="primary" type="button" disabled={action.busy} onClick={() => void act(() => api(`/tasks/${task.id}/accept`, { body: {} }))}>
              Accept
            </button>
            {can('tasks.assign') && (
              <button type="button" onClick={() => void act(() => api(`/tasks/${task.id}/priority`, { body: { priority: task.priority > 0 ? 0 : 5 } }))}>
                {task.priority > 0 ? 'Normal' : 'VIP'}
              </button>
            )}
          </TicketSummary>
        ))}
      </div>
    </div>
  );
}
