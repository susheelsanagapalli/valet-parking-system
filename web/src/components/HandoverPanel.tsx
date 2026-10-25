import { AlertTriangle, Banknote, Check, CheckCircle2, CreditCard, Handshake, KeyRound, PenLine, ScanLine, ShieldCheck } from 'lucide-react';
import { useCallback, useState } from 'react';
import { api } from '../api';
import { useAction } from '../hooks';
import { useSession } from '../session';
import type { LocationSettings, StaffTicket } from '../types';
import { QrScanner, canScanQr } from './QrScanner';
import type { SmsDraft } from './SendSmsButton';
import { SignaturePad } from './SignaturePad';

interface Props {
  ticket: StaffTicket;
  settings: LocationSettings;
  /** Called after each change; after handover it receives the server response (with any SMS draft). */
  onChanged: (handoverResult?: { smsDraft?: SmsDraft | null }) => void;
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
      else if (res) {
        setError(
          proof.qrToken
            ? 'This QR belongs to a different ticket. Check the ticket number, or use the PIN.'
            : 'Wrong PIN. Check it again, or ask a supervisor to approve an override.',
        );
      }
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
    const res = await run(() =>
      api<{ smsDraft?: SmsDraft | null }>(`/tickets/${ticket.id}/handover`, { body: { approveBalance: approveBalance || undefined, endOfStay: endOfStay || undefined } }),
    );
    if (res) onChanged(res);
  }

  const paid = due <= 0;
  const confirmed = Boolean(ticket.confirmation);

  return (
    <div className="stack">
      <StepHead n={1} done={verified} title="Verify guest" />
      {verified ? (
        <div className="notice ok label-text">
          <ShieldCheck size={18} aria-hidden /> Guest verified
        </div>
      ) : scanning ? (
        <QrScanner onResult={onScan} onClose={() => setScanning(false)} />
      ) : (
        <div className="stack">
          {canScanQr() && (
            <button type="button" className="primary" onClick={() => setScanning(true)}>
              <ScanLine size={20} aria-hidden />
              Scan guest's QR
            </button>
          )}
          <div className="divider-text">or ask for the 4-digit PIN (OTP) from the ticket SMS</div>
          <div className="row" style={{ justifyContent: 'center' }}>
            <input
              className="pin-input"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                setError(null);
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••"
              aria-label="Handover PIN"
            />
            <button type="button" disabled={pin.length !== 4 || busy} onClick={() => void verify({ pin })}>
              <KeyRound size={18} aria-hidden />
              Check PIN
            </button>
          </div>
        </div>
      )}

      <StepHead n={2} done={paid} title="Payment" />
      {paid ? (
        <div className="notice ok label-text">
          <CheckCircle2 size={18} aria-hidden /> Nothing due{ticket.fee_amount > 0 ? ` (paid ₹${ticket.fee_amount})` : ''}
        </div>
      ) : (
        <div className="stack">
          <div className="card fee-card dark" style={{ marginBottom: 0 }}>
            <div className="meta">Balance due</div>
            <div className="amount">₹{due}</div>
            {pendingQr && <div className="meta">A QR payment is waiting for verification by a supervisor.</div>}
          </div>
          <div className="row">
            {settings.paymentMethods.includes('cash') && (
              <button type="button" disabled={busy} onClick={() => void recordCash('cash')}>
                <Banknote size={18} aria-hidden />
                Cash received
              </button>
            )}
            {settings.paymentMethods.includes('card_terminal') && (
              <button type="button" disabled={busy} onClick={() => void recordCash('card_terminal')}>
                <CreditCard size={18} aria-hidden />
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
          <StepHead n={3} done={confirmed} title="Guest confirmation" />
          {ticket.confirmation ? (
            <div className={`notice label-text ${ticket.confirmation.result === 'no_damage' ? 'ok' : 'warn'}`}>
              {ticket.confirmation.result === 'no_damage' ? <CheckCircle2 size={18} aria-hidden /> : <AlertTriangle size={18} aria-hidden />}
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
                  <PenLine size={18} aria-hidden />
                  Signed: no damage
                </button>
              </div>
              <label>
                Damage noted by guest
                <input value={damage} onChange={(e) => setDamage(e.target.value)} placeholder="e.g. scratch on rear bumper" />
              </label>
              <button type="button" className="danger" disabled={!damage || busy} onClick={() => void confirmOnDevice('damage_reported')}>
                <AlertTriangle size={18} aria-hidden />
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
        <Handshake size={22} aria-hidden />
        {goingOut ? 'Hand over (guest will return)' : 'Hand over and close ticket'}
      </button>
    </div>
  );
}

function StepHead({ n, done, title }: { n: number; done: boolean; title: string }) {
  return (
    <h3 className="step-head">
      <span className={`step-num${done ? ' done' : ''}`} aria-hidden>
        {done ? <Check size={16} /> : n}
      </span>
      {title}
      {done && <span className="sr-only"> (done)</span>}
    </h3>
  );
}
