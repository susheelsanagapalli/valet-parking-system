import { useCallback, useState } from 'react';
import { api } from '../api';
import { useAction } from '../hooks';
import { useSession } from '../session';
import type { LocationSettings, StaffTicket } from '../types';
import { QrScanner, canScanQr } from './QrScanner';
import { SignaturePad } from './SignaturePad';

interface Props {
  ticket: StaffTicket;
  settings: LocationSettings;
  onChanged: () => void;
}

/** Verify the guest, settle payment, record the guest's confirmation and hand over (FR-OUT-06, FR-OUT-13, FR-PAY-04, FR-PAY-14). */
export function HandoverPanel({ ticket, settings, onChanged }: Props) {
  const { can } = useSession();
  const [verified, setVerified] = useState(false);
  const [pin, setPin] = useState('');
  const [scanning, setScanning] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [damage, setDamage] = useState('');
  const [approveBalance, setApproveBalance] = useState(false);
  const [endOfStay, setEndOfStay] = useState(false);
  const { busy, error, setError, run } = useAction();

  const verify = useCallback(
    async (proof: { pin?: string; qrToken?: string }) => {
      const res = await run(() => api<{ verified: boolean }>(`/tickets/${ticket.id}/verify`, { body: proof }));
      if (res?.verified) setVerified(true);
      else if (res) setError('Verification failed. Check the PIN, or ask a supervisor to approve an override.');
    },
    [run, setError, ticket.id],
  );

  const onScan = useCallback(
    (value: string) => {
      setScanning(false);
      void verify({ qrToken: value });
    },
    [verify],
  );

  const pendingQr = ticket.payments.some((p) => p.status === 'pending');
  const due = ticket.balance_due;
  const goingOut = ticket.is_in_and_out && !endOfStay;
  const blockedByBalance = !goingOut && due > 0 && settings.paymentRequiredBeforeHandover && !approveBalance;
  const needsConfirmation = settings.handoverConfirmation && !ticket.confirmation;

  async function recordCash(method: 'cash' | 'card_terminal') {
    if (await run(() => api(`/tickets/${ticket.id}/payments`, { body: { method, amount: due } }))) onChanged();
  }

  async function confirmOnDevice(result: 'no_damage' | 'damage_reported') {
    const ok = await run(async () => {
      let signatureRef: string | undefined;
      if (signature) signatureRef = (await api<{ fileRef: string }>('/uploads', { body: { dataUrl: signature } })).fileRef;
      return api(`/tickets/${ticket.id}/confirm`, {
        body: { result, method: 'signature', signatureRef, damageDescription: result === 'damage_reported' ? damage || undefined : undefined },
      });
    });
    if (ok) onChanged();
  }

  async function handover() {
    if (await run(() => api(`/tickets/${ticket.id}/handover`, { body: { approveBalance: approveBalance || undefined, endOfStay: endOfStay || undefined } }))) onChanged();
  }

  return (
    <div className="stack">
      <h3>1. Verify guest</h3>
      {verified ? (
        <div className="notice ok">Guest verified</div>
      ) : scanning ? (
        <QrScanner onResult={onScan} onClose={() => setScanning(false)} />
      ) : (
        <div className="stack">
          {canScanQr() && (
            <button type="button" onClick={() => setScanning(true)}>
              Scan ticket QR
            </button>
          )}
          <div className="row">
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="4-digit handover PIN" style={{ flex: 1 }} aria-label="Handover PIN" />
            <button type="button" disabled={pin.length !== 4 || busy} onClick={() => void verify({ pin })}>
              Check PIN
            </button>
          </div>
        </div>
      )}

      <h3>2. Payment</h3>
      {due <= 0 ? (
        <div className="notice ok">Nothing due{ticket.fee_amount > 0 ? ` (paid ₹${ticket.fee_amount})` : ''}</div>
      ) : (
        <div className="stack">
          <div className="notice warn">
            Balance due: <strong>₹{due}</strong>
            {pendingQr && ' — a QR payment is waiting for verification by a supervisor.'}
          </div>
          <div className="row">
            {settings.paymentMethods.includes('cash') && (
              <button type="button" disabled={busy} onClick={() => void recordCash('cash')}>
                Cash received
              </button>
            )}
            {settings.paymentMethods.includes('card_terminal') && (
              <button type="button" disabled={busy} onClick={() => void recordCash('card_terminal')}>
                Card terminal paid
              </button>
            )}
          </div>
          {can('handover.approve_balance') && settings.paymentRequiredBeforeHandover && (
            <label className="check">
              <input type="checkbox" checked={approveBalance} onChange={(e) => setApproveBalance(e.target.checked)} />
              Supervisor: release with balance due
            </label>
          )}
        </div>
      )}

      {settings.handoverConfirmation && (
        <>
          <h3>3. Guest confirmation</h3>
          {ticket.confirmation ? (
            <div className={`notice ${ticket.confirmation.result === 'no_damage' ? 'ok' : 'warn'}`}>
              {ticket.confirmation.result === 'no_damage' ? 'Guest confirmed: car received, no damage' : 'Guest reported damage — an incident was opened'}
            </div>
          ) : (
            <div className="stack">
              <p className="muted" style={{ margin: 0 }}>
                The guest can tap “Car received, no damage” on their ticket page. Without the ticket page, the guest signs here.
              </p>
              <SignaturePad onChange={setSignature} />
              <div className="row">
                <button type="button" className="primary" disabled={!signature || busy} onClick={() => void confirmOnDevice('no_damage')}>
                  Signed: no damage
                </button>
              </div>
              <label>
                Damage noted by guest
                <input value={damage} onChange={(e) => setDamage(e.target.value)} placeholder="e.g. scratch on rear bumper" />
              </label>
              <button type="button" className="danger" disabled={!damage || busy} onClick={() => void confirmOnDevice('damage_reported')}>
                Record damage report
              </button>
            </div>
          )}
        </>
      )}

      {ticket.is_in_and_out && (
        <label className="check">
          <input type="checkbox" checked={endOfStay} onChange={(e) => setEndOfStay(e.target.checked)} />
          End of stay (close the ticket instead of keeping it open for a return)
        </label>
      )}
      {error && <div className="notice error">{error}</div>}
      <button className="primary big" type="button" disabled={busy || !verified || blockedByBalance || needsConfirmation} onClick={() => void handover()}>
        {goingOut ? 'Hand over (guest will return)' : 'Hand over and close ticket'}
      </button>
    </div>
  );
}
