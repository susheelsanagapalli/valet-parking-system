import { useState } from 'react';
import { api } from '../api';
import { SendSmsButton, type SmsDraft } from '../components/SendSmsButton';
import { useAction, usePolling } from '../hooks';
import { useSession } from '../session';
import type { PaymentRow, StaffTicket } from '../types';

/** Supervisors check each QR payment in the operator's own account and mark it (FR-PAY-16). */
export function PaymentsPage() {
  const { location } = useSession();
  const locationId = location?.id ?? '';
  const { data, error, refresh } = usePolling(() => api<Array<{ payment: PaymentRow; ticket: StaffTicket }>>(`/locations/${locationId}/payments/pending`), [locationId]);
  const action = useAction();
  const [draft, setDraft] = useState<SmsDraft | null>(null);
  const decide = async (id: string, decision: 'verified' | 'rejected') => {
    const res = await action.run(() => api<{ smsDraft?: SmsDraft | null }>(`/payments/${id}/verify`, { body: { decision } }));
    if (res) {
      setDraft(res.smsDraft ?? null);
      await refresh();
    }
  };

  return (
    <div className="card">
      <h1>QR payments to verify</h1>
      {draft && (
        <div className="card stack">
          <strong>Tell the guest the payment was not found</strong>
          <SendSmsButton draft={draft} />
          <button type="button" onClick={() => setDraft(null)}>
            Done
          </button>
        </div>
      )}
      <p className="muted">Check each payment in your bank or UPI app: the amount and transaction reference must match.</p>
      {(error || action.error) && <div className="notice error">{error ?? action.error}</div>}
      {data?.length === 0 && <p className="muted">Nothing waiting.</p>}
      {data?.map(({ payment, ticket }) => (
        <div className="ticket-item" key={payment.id}>
          <div className="stack" style={{ gap: 4 }}>
            <strong>
              ₹{payment.amount}
              {payment.tip ? ` + ₹${payment.tip} tip` : ''}
            </strong>
            <span>
              Ref <span className="mono">{payment.transaction_reference ?? '—'}</span>
            </span>
            <span className="muted">
              Ticket {ticket.ticket_number} · {ticket.plate_number} · {new Date(payment.created_at).toLocaleTimeString()}
            </span>
          </div>
          <div className="stack" style={{ minWidth: 140 }}>
            <button className="primary" type="button" disabled={action.busy} onClick={() => void decide(payment.id, 'verified')}>
              Received
            </button>
            <button className="danger" type="button" disabled={action.busy} onClick={() => void decide(payment.id, 'rejected')}>
              Not found
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
