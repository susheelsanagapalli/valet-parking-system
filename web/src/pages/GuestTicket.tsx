import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useAction, usePolling } from '../hooks';
import { STATUS_LABEL, type GuestTicket } from '../types';

const STEPS = ['parked', 'retrieval_requested', 'assigned_in_transit', 'ready_for_pickup'] as const;

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

  useEffect(() => {
    void QRCode.toDataURL(window.location.href, { margin: 1, width: 400 }).then(setQr);
  }, []);
  useEffect(() => {
    if (t?.appName) document.title = `${t.appName} · Ticket ${t.ticketNumber}`;
  }, [t?.appName, t?.ticketNumber]);

  const post = async (path: string, body: unknown = {}) => {
    const res = await action.run(() => api<GuestTicket>(`/guest/${token}/${path}`, { body, auth: false }));
    if (res) setData(res);
  };

  if (!t) {
    return <div className="guest-shell">{error ? <div className="notice error">{error}</div> : <p className="muted">Loading your ticket…</p>}</div>;
  }

  const stepIndex = STEPS.indexOf(t.status as (typeof STEPS)[number]);
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="guest-shell stack">
      <header className="center">
        <div className="muted">{t.appName}</div>
        <h1 style={{ marginBottom: 4 }}>{t.locationName}</h1>
        <div className="big-number mono">{t.ticketNumber}</div>
        <div>
          {t.plateNumber} · <span className={`badge ${t.status}`}>{STATUS_LABEL[t.status]}</span>
        </div>
      </header>

      {stepIndex >= 0 && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            {STEPS.map((s, i) => (
              <span key={s} className={`badge ${i <= stepIndex ? s : ''}`}>
                {STATUS_LABEL[s]}
              </span>
            ))}
          </div>
          {t.etaMinutes !== null && (
            <p className="center" style={{ fontSize: '1.2rem', marginBottom: 0 }}>
              {t.etaMinutes <= 1 ? 'Your car will be ready in about a minute' : `Your car will be ready in about ${t.etaMinutes} minutes`}
              {t.scheduledFor && ` (for ${time(t.scheduledFor)})`}
            </p>
          )}
          {t.status === 'ready_for_pickup' && (
            <p className="center" style={{ fontSize: '1.2rem', marginBottom: 0 }}>
              Your car is ready at <strong>{t.pickupPoint ?? t.pickupPoints[0]}</strong>
            </p>
          )}
        </div>
      )}

      {action.error && <div className="notice error">{action.error}</div>}

      {t.status === 'parked' && (
        <div className="card stack">
          <h2>Request your car</h2>
          <p className="muted" style={{ margin: 0 }}>
            Request it before you reach the pickup point, so it is ready when you arrive.
          </p>
          {t.pickupPoints.length > 1 && (
            <label>
              Pickup point
              <select value={pickup ?? t.pickupPoints[0]} onChange={(e) => setPickup(e.target.value)}>
                {t.pickupPoints.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
          )}
          {t.arrivalTimeRequest && (
            <div className="stack">
              <strong>I'll arrive in…</strong>
              <div className="segmented">
                {t.arrivalOptionsMinutes.map((m) => (
                  <button key={m} type="button" disabled={action.busy} onClick={() => void post('request', { pickupPoint: pickup, arriveInMinutes: m })}>
                    {m} min
                  </button>
                ))}
              </div>
            </div>
          )}
          <button className="primary big" type="button" disabled={action.busy} onClick={() => void post('request', { pickupPoint: pickup })}>
            {t.arrivalTimeRequest ? "I'm here — bring my car now" : 'Request my car'}
          </button>
        </div>
      )}

      {t.status === 'retrieval_requested' && (
        <div className="card stack">
          {t.scheduledFor && (
            <button className="primary big" type="button" disabled={action.busy} onClick={() => void post('arrival', { arrivedNow: true })}>
              I'm here now
            </button>
          )}
          <button type="button" disabled={action.busy} onClick={() => void post('cancel')}>
            Cancel request
          </button>
        </div>
      )}

      {t.balanceDue > 0 && t.status !== 'closed' && (
        <div className="card stack">
          <h2>Pay ₹{t.balanceDue}</h2>
          {t.pendingPayment ? (
            <div className="notice warn">Payment received for checking. Staff will confirm it shortly.</div>
          ) : t.paymentQr ? (
            <>
              {t.paymentRejected && <div className="notice error">Your last payment could not be found. Please check the reference or pay at the desk.</div>}
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
                I've paid
              </button>
            </>
          ) : (
            <p className="muted">Pay at the valet desk when you collect your car.</p>
          )}
          {t.paymentMethods.includes('cash') && t.paymentQr && <p className="muted" style={{ margin: 0 }}>You can also pay cash at handover.</p>}
        </div>
      )}

      {t.status === 'ready_for_pickup' && t.handoverConfirmation && (
        <div className="card stack">
          <h2>Check your car</h2>
          {t.confirmed ? (
            <div className={`notice ${t.confirmed === 'no_damage' ? 'ok' : 'warn'}`}>
              {t.confirmed === 'no_damage' ? 'Thanks — you confirmed the car is fine.' : 'Thanks — your damage report has been recorded.'}
            </div>
          ) : reportingDamage ? (
            <>
              <label>
                What is damaged?
                <textarea value={damage} onChange={(e) => setDamage(e.target.value)} rows={3} />
              </label>
              <button className="danger" type="button" disabled={damage.length < 3 || action.busy} onClick={() => void post('confirm', { result: 'damage_reported', damageDescription: damage })}>
                Send damage report
              </button>
              <button type="button" onClick={() => setReportingDamage(false)}>
                Back
              </button>
            </>
          ) : (
            <>
              <button className="primary big" type="button" disabled={action.busy} onClick={() => void post('confirm', { result: 'no_damage' })}>
                Car received, no damage
              </button>
              <button type="button" onClick={() => setReportingDamage(true)}>
                Report damage
              </button>
            </>
          )}
        </div>
      )}

      {t.status === 'closed' && (
        <div className="card stack center">
          <h2>Thank you!</h2>
          {t.rating ? (
            <p>You rated us {'★'.repeat(t.rating)}</p>
          ) : (
            <>
              <p className="muted">How was the service?</p>
              <div className="row stars" style={{ justifyContent: 'center' }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => void post('rating', { rating: n })}>
                    ☆
                  </button>
                ))}
              </div>
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
      <p className="muted center">Checked in at {time(t.checkedInAt)}</p>
    </div>
  );
}
