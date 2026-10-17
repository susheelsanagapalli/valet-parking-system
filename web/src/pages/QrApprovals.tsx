import { api } from '../api';
import { useAction, usePolling } from '../hooks';
import type { LocationRow, LocationSettings } from '../types';

/** Platform admins check that a payment QR's payee matches the operator before guests see it (FR-PAY-15). */
export function QrApprovalsPage() {
  const { data, error, refresh } = usePolling(() => api<Array<{ location: LocationRow; paymentQr: NonNullable<LocationSettings['paymentQr']> }>>('/payment-qr/pending'), [], 15000);
  const action = useAction();
  const review = async (locationId: string, decision: 'approved' | 'rejected') => {
    if (await action.run(() => api(`/locations/${locationId}/payment-qr/review`, { body: { decision } }))) await refresh();
  };

  return (
    <div className="card">
      <h1>Payment QR approvals</h1>
      {(error || action.error) && <div className="notice error">{error ?? action.error}</div>}
      {data?.length === 0 && <p className="muted">No QR codes waiting.</p>}
      {data?.map(({ location, paymentQr }) => (
        <div className="ticket-item" key={location.id}>
          <div className="row">
            <img src={paymentQr.imageDataUrl} alt={`Payment QR for ${location.name}`} style={{ width: 140, height: 140, objectFit: 'contain', background: '#fff', borderRadius: 8 }} />
            <div className="stack" style={{ gap: 4 }}>
              <strong>{location.name}</strong>
              <span>Payee: {paymentQr.payeeName}</span>
              <span className="muted">Scan it with a UPI app and check the payee name before approving.</span>
            </div>
          </div>
          <div className="stack" style={{ minWidth: 140 }}>
            <button className="primary" type="button" disabled={action.busy} onClick={() => void review(location.id, 'approved')}>
              Approve
            </button>
            <button className="danger" type="button" disabled={action.busy} onClick={() => void review(location.id, 'rejected')}>
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
