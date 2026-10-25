import QRCode from 'qrcode';
import { AlertTriangle, Car, CheckCircle2, Clock, CreditCard, Hash, MapPin, Navigation, QrCode, Undo2, Zap, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { Modal } from '../components/Modal';
import { StarInput, StarsShown } from '../components/StarRating';
import { StatusBadge } from '../components/TicketSummary';
import { formatDuration, formatRupees, formatTime, minutesSince } from '../format';
import { useAction, usePolling } from '../hooks';
import { STATUS_LABEL, type GuestTicket } from '../types';

const STEPS: ReadonlyArray<{ status: 'parked' | 'retrieval_requested' | 'assigned_in_transit' | 'ready_for_pickup'; icon: LucideIcon }> = [
  { status: 'parked', icon: Car },
  { status: 'retrieval_requested', icon: Zap },
  { status: 'assigned_in_transit', icon: Navigation },
  { status: 'ready_for_pickup', icon: CheckCircle2 },
];

/** The guest's ticket page, opened from the SMS link without signing in (SRS 4.1). */
export function GuestTicketPage() {
  const token = useParams().token ?? '';
  const { data: t, error, setData } = usePolling(() => api<GuestTicket>(`/guest/${token}`, { auth: false }), [token]);
  const action = useAction();
  const [qr, setQr] = useState<string | null>(null);
  const [pickup, setPickup] = useState<string | undefined>();
  const [txnRef, setTxnRef] = useState('');
  const [damage, setDamage] = useState('');
  const [reportingDamage, setReportingDamage] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');

  useEffect(() => {
    void QRCode.toDataURL(window.location.href, { margin: 1, width: 400 }).then(setQr);
  }, []);
  useEffect(() => {
    if (t?.appName) document.title = `${t.appName} · Ticket ${t.ticketNumber}`;
  }, [t?.appName, t?.ticketNumber]);

  const post = async (path: string, body: unknown = {}) => {
    const res = await action.run(() => api<GuestTicket>(`/guest/${token}/${path}`, { body, auth: false }));
    if (res) setData(res);
    return Boolean(res);
  };

  if (!t) {
    return <div className="guest-shell">{error ? <div className="notice error">{error}</div> : <p className="muted">Loading your ticket…</p>}</div>;
  }

  const stepIndex = STEPS.findIndex((s) => s.status === t.status);
  const isOpen = t.status !== 'closed' && t.status !== 'cancelled' && t.status !== 'abandoned';
  const shownFee = t.balanceDue > 0 ? t.balanceDue : t.fee;
  const paymentTag = t.pendingPayment ? { cls: 'pill', text: 'Checking payment' } : t.balanceDue > 0 ? { cls: 'pill', text: 'Due' } : { cls: 'pill ok', text: 'Paid' };

  return (
    <div className="guest-page">
      <header className="guest-hero">
        <div className="app">
          <span className="brand-mark" aria-hidden>
            <Car size={18} />
          </span>
          {t.appName}
          <span className="where">{t.locationName}</span>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="kicker">Ticket</div>
            <div className="ticket-no mono">{t.ticketNumber}</div>
          </div>
          <span className="brand-mark" style={{ width: 56, height: 56, borderRadius: 16 }} aria-hidden>
            <QrCode size={30} />
          </span>
        </div>
        <div className="vehicle">
          <span className="plate">{t.plateNumber}</span>
          {t.vehicle && <span className="desc">· {t.vehicle}</span>}
        </div>
        <div className="badge-row">
          <StatusBadge status={t.status} />
        </div>
      </header>

      <div className="guest-body">
        {stepIndex >= 0 && (
          <div className="card raised">
            <div className="steps" aria-label="Progress">
              {STEPS.map(({ status, icon: Icon }, i) => (
                <div key={status} className={`step${i < stepIndex ? ' done' : i === stepIndex ? ' current' : ''}`} aria-current={i === stepIndex ? 'step' : undefined}>
                  <span className="icon">
                    <Icon size={18} aria-hidden />
                  </span>
                  {STATUS_LABEL[status]}
                </div>
              ))}
            </div>
            {t.etaMinutes !== null && (
              <p className="status-line">
                <Clock size={22} aria-hidden style={{ color: 'var(--warn)' }} />
                <span>
                  {t.etaMinutes <= 1 ? 'Your car will be ready in about a minute' : `Your car will be ready in about ${t.etaMinutes} minutes`}
                  {t.scheduledFor && ` (for ${formatTime(t.scheduledFor)})`}
                </span>
              </p>
            )}
            {t.status === 'ready_for_pickup' && (
              <p className="status-line">
                <CheckCircle2 size={22} aria-hidden style={{ color: 'var(--ok)' }} />
                <span>
                  Your car is ready at <strong>{t.pickupPoint ?? t.pickupPoints[0]}</strong>
                </span>
              </p>
            )}
            {t.status === 'parked' && (
              <p className="status-line muted">
                <Car size={22} aria-hidden />
                <span>Your car is parked safely.</span>
              </p>
            )}
          </div>
        )}

        {t.status === 'checked_in' && (
          <div className="card raised">
            <p className="status-line">
              <Car size={22} aria-hidden />
              <span>An attendant is parking your car.</span>
            </p>
          </div>
        )}
        {t.status === 'out' && (
          <div className="card raised">
            <p className="status-line">
              <Undo2 size={22} aria-hidden style={{ color: 'var(--purple)' }} />
              <span>Your car is out. Show this ticket when you bring it back.</span>
            </p>
          </div>
        )}

        {action.error && <div className="notice error">{action.error}</div>}

        {t.status === 'parked' && (
          <div className="card stack">
            <div>
              <h2 style={{ marginBottom: 4 }}>Request your car</h2>
              <p className="muted" style={{ margin: 0 }}>
                Request it before you reach the pickup point, so it is ready when you arrive.
              </p>
            </div>
            {t.pickupPoints.length > 1 && (
              <label>
                <span className="label-text">
                  <MapPin size={16} aria-hidden /> Pickup point
                </span>
                <select value={pickup ?? t.pickupPoints[0]} onChange={(e) => setPickup(e.target.value)}>
                  {t.pickupPoints.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
            )}
            <button className="primary big" type="button" disabled={action.busy} onClick={() => void post('request', { pickupPoint: pickup })}>
              <Zap size={22} aria-hidden />
              {t.arrivalTimeRequest ? "I'm here — bring my car now" : 'Request my car'}
            </button>
            {t.arrivalTimeRequest && (
              <>
                <div className="divider-text">or tell us when you'll arrive</div>
                <div className="segmented">
                  {t.arrivalOptionsMinutes.map((m) => (
                    <button key={m} type="button" disabled={action.busy} onClick={() => void post('request', { pickupPoint: pickup, arriveInMinutes: m })}>
                      {m} min
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {t.status === 'retrieval_requested' && (
          <div className="card stack">
            {t.scheduledFor && (
              <button className="primary big" type="button" disabled={action.busy} onClick={() => void post('arrival', { arrivedNow: true })}>
                <Zap size={22} aria-hidden />
                I'm here now
              </button>
            )}
            <button type="button" disabled={action.busy} onClick={() => void post('cancel')}>
              Cancel request
            </button>
          </div>
        )}

        {isOpen && shownFee > 0 && (
          <div className="card stack fee-card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="section-label" style={{ margin: 0 }}>
                Parking fee
              </span>
              <span className={paymentTag.cls}>{paymentTag.text}</span>
            </div>
            <div>
              <div className="amount">{formatRupees(shownFee)}</div>
              <div className="meta label-text">
                <Clock size={14} aria-hidden /> Parked {formatDuration(minutesSince(t.checkedInAt))}
              </div>
            </div>
            {t.balanceDue > 0 &&
              (t.pendingPayment ? (
                <div className="notice warn">Payment received for checking. Staff will confirm it shortly.</div>
              ) : t.paymentQr ? (
                <>
                  {t.paymentRejected && <div className="notice error">Your last payment could not be found. Please check the reference or pay at the desk.</div>}
                  <div className="section-label label-text">
                    <CreditCard size={16} aria-hidden /> Pay by UPI
                  </div>
                  <div className="center">
                    <img className="qr" src={t.paymentQr.imageDataUrl} alt={`Payment QR for ${t.paymentQr.payeeName}`} style={{ width: 240, height: 240, objectFit: 'contain' }} />
                    <div>Pay to {t.paymentQr.payeeName}</div>
                  </div>
                  <label>
                    Transaction reference (UTR)
                    <span className="hint">From your UPI app after paying</span>
                    <input value={txnRef} onChange={(e) => setTxnRef(e.target.value.trim())} inputMode="numeric" />
                  </label>
                  <button className="primary" type="button" disabled={txnRef.length < 4 || action.busy} onClick={() => void post('payment', { transactionReference: txnRef })}>
                    <CheckCircle2 size={20} aria-hidden />
                    I've paid
                  </button>
                </>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  Pay at the valet desk when you collect your car.
                </p>
              ))}
            {t.balanceDue > 0 && t.paymentMethods.includes('cash') && t.paymentQr && !t.pendingPayment && (
              <p className="muted" style={{ margin: 0 }}>
                You can also pay cash at handover.
              </p>
            )}
          </div>
        )}

        {t.status === 'ready_for_pickup' && t.handoverConfirmation && (
          <div className="card stack">
            <div>
              <h2 style={{ marginBottom: 4 }}>Check your car</h2>
              {!t.confirmed && (
                <p className="muted" style={{ margin: 0 }}>
                  Please look over your car and confirm its condition.
                </p>
              )}
            </div>
            {t.confirmed ? (
              <div className={`notice ${t.confirmed === 'no_damage' ? 'ok' : 'warn'} label-text`}>
                {t.confirmed === 'no_damage' ? <CheckCircle2 size={18} aria-hidden /> : <AlertTriangle size={18} aria-hidden />}
                {t.confirmed === 'no_damage' ? 'Thanks — you confirmed the car is fine.' : 'Thanks — your damage report has been recorded.'}
              </div>
            ) : (
              <>
                <button className="primary big" type="button" disabled={action.busy} onClick={() => void post('confirm', { result: 'no_damage' })}>
                  <CheckCircle2 size={22} aria-hidden />
                  Car received, no damage
                </button>
                <button className="danger" type="button" onClick={() => setReportingDamage(true)}>
                  <AlertTriangle size={20} aria-hidden />
                  Report damage
                </button>
              </>
            )}
          </div>
        )}

        {t.status === 'closed' && (
          <div className="card stack center">
            <CheckCircle2 size={44} aria-hidden style={{ color: 'var(--ok)', margin: '0 auto' }} />
            <h2 style={{ margin: 0 }}>Thank you!</h2>
            {t.rating ? (
              <div className="stack" style={{ gap: 4, alignItems: 'center' }}>
                <span className="muted">Your rating</span>
                <StarsShown value={t.rating} />
              </div>
            ) : (
              <>
                <p className="muted" style={{ margin: 0 }}>
                  How was the valet service?
                </p>
                <StarInput value={stars} onChange={setStars} />
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={500} placeholder="Leave a comment (optional)" aria-label="Comment" />
                <button className="primary" type="button" disabled={stars === 0 || action.busy} onClick={() => void post('rating', { rating: stars, comment: comment.trim() || undefined })}>
                  Submit rating
                </button>
              </>
            )}
          </div>
        )}

        {['parked', 'retrieval_requested', 'assigned_in_transit', 'ready_for_pickup', 'out'].includes(t.status) && qr && (
          <div className="card center">
            <img className="qr" src={qr} alt="Your ticket QR code" />
            <p style={{ marginBottom: 0 }}>
              <strong>Show this QR to the attendant</strong> when you collect your car, or tell them the 4-digit PIN (OTP) from your SMS.
            </p>
          </div>
        )}

        <div className="card">
          <div className="section-label" style={{ marginBottom: 4 }}>
            Details
          </div>
          <div className="detail-list">
            <DetailRow icon={Hash} label="Ticket" value={t.ticketNumber} mono />
            <DetailRow icon={Car} label="Vehicle" value={[t.plateNumber, t.vehicle].filter(Boolean).join(' · ') || '—'} />
            <DetailRow icon={Clock} label="Checked in" value={formatTime(t.checkedInAt)} />
            {t.pickupPoint && <DetailRow icon={Navigation} label="Pickup point" value={t.pickupPoint} />}
            <DetailRow icon={MapPin} label="Location" value={t.locationName} />
          </div>
        </div>

        <p className="muted center" style={{ fontSize: '0.85rem', margin: 0 }}>
          {t.appName} · {t.locationName}
        </p>
      </div>

      <Modal open={reportingDamage} onClose={() => setReportingDamage(false)} title="Report damage" narrow>
        <div className="stack">
          <label>
            What is damaged?
            <span className="hint">For example: scratch on the rear bumper</span>
            <textarea value={damage} onChange={(e) => setDamage(e.target.value)} rows={4} autoFocus />
          </label>
          {action.error && <div className="notice error">{action.error}</div>}
          <button
            className="danger big"
            type="button"
            disabled={damage.trim().length < 3 || action.busy}
            onClick={() => void post('confirm', { result: 'damage_reported', damageDescription: damage.trim() }).then((ok) => ok && setReportingDamage(false))}
          >
            <AlertTriangle size={20} aria-hidden />
            Send damage report
          </button>
        </div>
      </Modal>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value, mono }: { icon: LucideIcon; label: string; value: string; mono?: boolean }) {
  return (
    <div className="detail-row">
      <Icon size={18} aria-hidden />
      <span className="k">{label}</span>
      <span className={`v${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  );
}
