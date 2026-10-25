import { Check, CheckCircle2, Handshake, Inbox, MapPin, MessageSquare, RotateCcw, Star, StarOff } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { HandoverPanel } from '../components/HandoverPanel';
import { Modal } from '../components/Modal';
import { SendSmsButton, type SmsDraft } from '../components/SendSmsButton';
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
  const [outbox, setOutbox] = useState<Array<{ label: string; draft: SmsDraft }>>([]);
  const [handoverId, setHandoverId] = useState<string | null>(null);
  const queueSms = (label: string, draft?: SmsDraft | null) => {
    if (draft) setOutbox((o) => [{ label, draft }, ...o.filter((x) => x.draft.id !== draft.id)]);
  };

  const act = async (fn: () => Promise<unknown>) => {
    if (await action.run(fn)) await refresh();
  };
  const actWithSms = async (label: string, fn: () => Promise<{ smsDraft?: SmsDraft | null; ticket_number?: string }>) => {
    const res = await action.run(fn);
    if (res) {
      queueSms(`${label}${res.ticket_number ? ` · ${res.ticket_number}` : ''}`, res.smsDraft);
      await refresh();
    }
  };

  if (!data || !settings) return <div className="muted">{error ?? 'Loading…'}</div>;
  // The ticket in the handover dialog, kept fresh by polling; the dialog closes once it leaves "mine".
  const handoverTicket = data.mine.find((t) => t.id === handoverId) ?? null;

  return (
    <div className="stack">
      {action.error && <div className="notice error">{action.error}</div>}
      {outbox.length > 0 && (
        <div className="card stack fade-in">
          <div className="card-title" style={{ marginBottom: 0 }}>
            <MessageSquare size={20} aria-hidden />
            <h2>Messages to send</h2>
          </div>
          {outbox.map(({ label, draft }) => (
            <div key={draft.id} className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{label}</strong>
                <button type="button" onClick={() => setOutbox((o) => o.filter((x) => x.draft.id !== draft.id))}>
                  <Check size={18} aria-hidden />
                  Done
                </button>
              </div>
              <SendSmsButton draft={draft} />
            </div>
          ))}
        </div>
      )}
      {data.mine.map((t) => (
        <div className="card stack fade-in" key={t.id} style={{ marginBottom: 0 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            <span className={`icon-tile sm ${t.status === 'ready_for_pickup' ? 'tone-ok' : 'tone-indigo'}`} aria-hidden>
              {t.status === 'ready_for_pickup' ? <Handshake size={18} /> : <MapPin size={18} />}
            </span>
            <h2>{t.status === 'ready_for_pickup' ? 'Hand over' : 'Bring this car'}</h2>
          </div>
          <TicketSummary ticket={t} />
          <p className="muted label-text" style={{ margin: 0 }}>
            <MapPin size={16} aria-hidden /> Pickup point: {t.pickup_point ?? settings.pickupPoints[0]}
          </p>
          {t.status === 'assigned_in_transit' ? (
            <button className="primary big" type="button" disabled={action.busy} onClick={() => void actWithSms('Car ready', () => api(`/tickets/${t.id}/ready`, { body: {} }))}>
              <CheckCircle2 size={22} aria-hidden />
              Car is at the pickup point
            </button>
          ) : (
            <>
              <button className="primary big" type="button" onClick={() => setHandoverId(t.id)}>
                <Handshake size={22} aria-hidden />
                Verify guest and hand over
              </button>
              {can('tasks.assign') && (
                <button type="button" onClick={() => void actWithSms('Parked again', () => api(`/tickets/${t.id}/repark`, { body: {} }))}>
                  <RotateCcw size={18} aria-hidden />
                  Guest did not come — park again
                </button>
              )}
            </>
          )}
        </div>
      ))}

      <div className="card">
        <div className="card-title">
          <h2>Queue</h2>
          <span className="muted tabular">{data.queue.length}</span>
        </div>
        {data.queue.length === 0 && <EmptyState icon={Inbox} title="No cars requested right now" hint="New requests appear here automatically." />}
        {data.queue.map(({ task, ticket }) => (
          <TicketSummary key={task.id} ticket={ticket}>
            {task.priority > 0 && (
              <span className="badge warn with-dot">
                <Star size={12} aria-hidden /> VIP
              </span>
            )}
            <button className="primary" type="button" disabled={action.busy} onClick={() => void act(() => api(`/tasks/${task.id}/accept`, { body: {} }))}>
              <Check size={18} aria-hidden />
              Accept
            </button>
            {can('tasks.assign') && (
              <button type="button" onClick={() => void act(() => api(`/tasks/${task.id}/priority`, { body: { priority: task.priority > 0 ? 0 : 5 } }))}>
                {task.priority > 0 ? <StarOff size={18} aria-hidden /> : <Star size={18} aria-hidden />}
                {task.priority > 0 ? 'Normal' : 'VIP'}
              </button>
            )}
          </TicketSummary>
        ))}
      </div>

      <Modal open={handoverTicket !== null} onClose={() => setHandoverId(null)} title={handoverTicket ? `Hand over · ${handoverTicket.ticket_number}` : 'Hand over'}>
        {handoverTicket && (
          <HandoverPanel
            key={handoverTicket.id}
            ticket={handoverTicket}
            settings={settings}
            onChanged={(res) => {
              if (res) {
                queueSms(`Receipt · ${handoverTicket.ticket_number}`, res.smsDraft);
                setHandoverId(null);
              }
              void refresh();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
