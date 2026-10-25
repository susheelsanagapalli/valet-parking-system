import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { SmsSettingsCard } from '../components/SmsSettingsCard';
import { useAction, usePolling } from '../hooks';
import { readAsDataUrl } from '../image';
import { useSession } from '../session';
import type { LocationRow, LocationSettings } from '../types';

type Req = 'off' | 'optional' | 'required';
const REQ: Req[] = ['off', 'optional', 'required'];
const PROFILES = [
  ['restaurant', 'Restaurant'],
  ['paid_parking', 'Paid parking'],
  ['hotel', 'Hotel'],
  ['event_venue', 'Event venue'],
  ['custom', 'Custom'],
] as const;

function Segmented({ value, onChange, label }: { value: Req; onChange: (v: Req) => void; label: string }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <strong>{label}</strong>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {REQ.map((r) => (
          <button key={r} type="button" role="radio" aria-checked={value === r} className={value === r ? 'selected' : ''} onClick={() => onChange(r)}>
            {r[0]?.toUpperCase() + r.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Location settings from the SRS settings catalogue (2.7.1), editable without code changes (FR-CFG-02). */
export function SettingsPage() {
  const { location, can, reloadLocations, setLocationId } = useSession();
  const locationId = location?.id ?? '';
  const loaded = usePolling(() => api<LocationSettings>(`/locations/${locationId}/settings`), [locationId], 0);
  const [s, setS] = useState<LocationSettings | null>(null);
  const save = useAction();
  const [saved, setSaved] = useState(false);

  useEffect(() => setS(loaded.data), [loaded.data]);
  if (!s) return <div className="muted">Loading…</div>;
  const patch = (p: Partial<LocationSettings>) => {
    setSaved(false);
    setS({ ...s, ...p });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!s) return;
    const { paymentQr: _qr, ...changes } = s;
    const res = await save.run(() => api<LocationSettings>(`/locations/${locationId}/settings`, { method: 'PUT', body: changes }));
    if (res) {
      loaded.setData(res);
      setSaved(true);
    }
  }

  const togglePayment = (m: 'payment_qr' | 'cash' | 'card_terminal') =>
    patch({ paymentMethods: s.paymentMethods.includes(m) ? s.paymentMethods.filter((x) => x !== m) : [...s.paymentMethods, m] });

  return (
    <div className="stack">
      <form className="card stack" onSubmit={(e) => void submit(e)}>
        <h1>Settings · {location?.name}</h1>
        <p className="muted" style={{ margin: 0 }}>
          Changes apply to new tickets. Cars already checked in keep the rules they arrived with.
        </p>
        <p className="muted" style={{ margin: 0 }}>
          Location ID (to limit staff accounts to this location): <code className="mono wrap">{location?.id}</code>
        </p>

        <h2>Parking spot</h2>
        <div className="grid">
          <Segmented label="Text field" value={s.spotText} onChange={(v) => patch({ spotText: v })} />
          <Segmented label="GPS location" value={s.spotGps} onChange={(v) => patch({ spotGps: v })} />
          <Segmented label="Spot photo" value={s.spotPhoto} onChange={(v) => patch({ spotPhoto: v })} />
        </div>
        <div className="grid">
          <label>
            Text field label
            <input value={s.spotTextLabel} onChange={(e) => patch({ spotTextLabel: e.target.value })} />
          </label>
          <label>
            GPS minimum accuracy (metres)
            <input type="number" min={1} value={s.gpsMinAccuracyM} onChange={(e) => patch({ gpsMinAccuracyM: Number(e.target.value) })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={s.zoneSlotList} onChange={(e) => patch({ zoneSlotList: e.target.checked })} />
            Zone / slot list
          </label>
        </div>

        <h2>Check-in and handover</h2>
        <div className="grid">
          <Segmented label="Vehicle photos" value={s.vehiclePhotos} onChange={(v) => patch({ vehiclePhotos: v })} />
          <label>
            Number of vehicle photos
            <input type="number" min={1} max={8} value={s.vehiclePhotoCount} onChange={(e) => patch({ vehiclePhotoCount: Number(e.target.value) })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={s.handoverConfirmation} onChange={(e) => patch({ handoverConfirmation: e.target.checked })} />
            Guest confirms “no damage” at handover
          </label>
        </div>

        <h2>Requests</h2>
        <div className="grid">
          <label className="check">
            <input type="checkbox" checked={s.arrivalTimeRequest} onChange={(e) => patch({ arrivalTimeRequest: e.target.checked })} />
            “I'll arrive in…” requests
          </label>
          <label>
            Arrival options (minutes, comma-separated)
            <input
              value={s.arrivalOptionsMinutes.join(', ')}
              onChange={(e) => patch({ arrivalOptionsMinutes: e.target.value.split(',').map((x) => Number(x.trim())).filter((n) => n > 0) })}
            />
          </label>
          <label>
            Average retrieval time (minutes)
            <input type="number" min={0} value={s.avgRetrievalMinutes} onChange={(e) => patch({ avgRetrievalMinutes: Number(e.target.value) })} />
          </label>
          <label>
            Pickup points (comma-separated)
            <input value={s.pickupPoints.join(', ')} onChange={(e) => patch({ pickupPoints: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={s.inAndOut} onChange={(e) => patch({ inAndOut: e.target.checked })} />
            In-and-out privileges
          </label>
          {s.inAndOut && (
            <label className="check">
              <input type="checkbox" checked={s.stayEndDateRequired} onChange={(e) => patch({ stayEndDateRequired: e.target.checked })} />
              Stay end date required
            </label>
          )}
          <label>
            Guest link works for (days after closing)
            <input type="number" min={1} max={90} value={s.guestLinkExpiryDays} onChange={(e) => patch({ guestLinkExpiryDays: Number(e.target.value) })} />
          </label>
        </div>

        <h2>Charges and payment</h2>
        <div className="grid">
          <label>
            Tariff
            <select value={s.tariff.type} onChange={(e) => patch({ tariff: { ...s.tariff, type: e.target.value as LocationSettings['tariff']['type'] } })}>
              <option value="complimentary">Complimentary</option>
              <option value="flat">Flat fee</option>
              <option value="hourly">Hourly</option>
            </select>
          </label>
          {s.tariff.type !== 'complimentary' && (
            <label>
              {s.tariff.type === 'flat' ? 'Flat fee (₹)' : 'Rate per hour (₹)'}
              <input type="number" min={0} value={s.tariff.rate} onChange={(e) => patch({ tariff: { ...s.tariff, rate: Number(e.target.value) } })} />
            </label>
          )}
          {s.tariff.type === 'hourly' && (
            <>
              <label>
                Free minutes
                <input type="number" min={0} value={s.tariff.freeMinutes} onChange={(e) => patch({ tariff: { ...s.tariff, freeMinutes: Number(e.target.value) } })} />
              </label>
              <label>
                Daily cap (₹, empty for none)
                <input
                  type="number"
                  min={1}
                  value={s.tariff.dailyCap ?? ''}
                  onChange={(e) => patch({ tariff: { ...s.tariff, dailyCap: e.target.value ? Number(e.target.value) : undefined } })}
                />
              </label>
            </>
          )}
        </div>
        <div className="row">
          {(
            [
              ['payment_qr', 'Payment QR'],
              ['cash', 'Cash'],
              ['card_terminal', 'Card terminal'],
            ] as const
          ).map(([m, label]) => (
            <label className="check" key={m}>
              <input type="checkbox" checked={s.paymentMethods.includes(m)} onChange={() => togglePayment(m)} />
              {label}
            </label>
          ))}
          <label className="check">
            <input type="checkbox" checked={s.paymentRequiredBeforeHandover} onChange={(e) => patch({ paymentRequiredBeforeHandover: e.target.checked })} />
            Payment required before handover
          </label>
        </div>

        {save.error && <div className="notice error">{save.error}</div>}
        {saved && <div className="notice ok">Saved as a new settings version.</div>}
        <button className="primary big" type="submit" disabled={save.busy}>
          {save.busy ? 'Saving…' : 'Save settings'}
        </button>
      </form>

      {can('sms.configure') && <SmsSettingsCard />}
      {can('payment_qr.upload') && <PaymentQrCard locationId={locationId} current={loaded.data?.paymentQr} onSaved={(next) => loaded.setData(next)} />}
      {can('locations.manage') && (
        <NewLocationCard
          onCreated={async (l) => {
            await reloadLocations();
            setLocationId(l.id);
          }}
        />
      )}
    </div>
  );
}

function PaymentQrCard({ locationId, current, onSaved }: { locationId: string; current?: LocationSettings['paymentQr']; onSaved: (s: LocationSettings) => void }) {
  const [payee, setPayee] = useState(current?.payeeName ?? '');
  const [image, setImage] = useState<string | null>(null);
  const { busy, error, setError, run } = useAction();

  async function pick(file?: File) {
    if (!file) return;
    if (file.size > 30_000) {
      setError('Use a QR image under 30 KB (crop it to just the QR code).');
      return;
    }
    setImage(await readAsDataUrl(file));
  }

  async function upload() {
    const res = await run(() => api<LocationSettings>(`/locations/${locationId}/payment-qr`, { method: 'PUT', body: { imageDataUrl: image, payeeName: payee } }));
    if (res) {
      onSaved(res);
      setImage(null);
    }
  }

  return (
    <div className="card stack">
      <h2>Payment QR</h2>
      <p className="muted" style={{ margin: 0 }}>
        Guests pay to your own UPI QR. A platform admin checks the payee before it is shown to guests.
      </p>
      {current && (
        <div className="row">
          <img src={current.imageDataUrl} alt="Current payment QR" style={{ width: 120, height: 120, objectFit: 'contain', background: '#fff', borderRadius: 8 }} />
          <div>
            <div>{current.payeeName}</div>
            <span className={`badge ${current.status === 'approved' ? 'ready_for_pickup' : current.status === 'rejected' ? 'cancelled' : 'retrieval_requested'}`}>
              {current.status === 'pending_approval' ? 'Waiting for approval' : current.status === 'approved' ? 'Approved' : 'Rejected'}
            </span>
          </div>
        </div>
      )}
      <label>
        Payee name (as shown in UPI apps)
        <input value={payee} onChange={(e) => setPayee(e.target.value)} />
      </label>
      <label>
        QR image (PNG or JPEG)
        <input type="file" accept="image/png,image/jpeg" onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {error && <div className="notice error">{error}</div>}
      <button type="button" className="primary" disabled={!image || payee.length < 2 || busy} onClick={() => void upload()}>
        Submit for approval
      </button>
    </div>
  );
}

export function NewLocationCard({ onCreated }: { onCreated: (l: LocationRow) => Promise<void> }) {
  const [form, setForm] = useState({ name: '', address: '', serviceProfile: 'restaurant', appName: 'ValetPay', ticketPrefix: '' });
  const { busy, error, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const res = await run(() => api<LocationRow>('/locations', { body: { ...form, ticketPrefix: form.ticketPrefix || undefined, address: form.address || undefined } }));
    if (res) {
      await onCreated(res);
      setForm({ ...form, name: '', address: '', ticketPrefix: '' });
    }
  }

  return (
    <form className="card stack" onSubmit={(e) => void submit(e)}>
      <h2>New location</h2>
      <div className="grid">
        <label>
          Name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label>
          Address
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </label>
        <label>
          Service profile
          <span className="hint">Fills in the default settings (SRS 2.7.2)</span>
          <select value={form.serviceProfile} onChange={(e) => setForm({ ...form, serviceProfile: e.target.value })}>
            {PROFILES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          App name
          <input value={form.appName} onChange={(e) => setForm({ ...form, appName: e.target.value })} required />
        </label>
        <label>
          Ticket prefix
          <input value={form.ticketPrefix} onChange={(e) => setForm({ ...form, ticketPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) })} placeholder="SG" />
        </label>
      </div>
      {error && <div className="notice error">{error}</div>}
      <button className="primary" type="submit" disabled={busy}>
        Create location
      </button>
    </form>
  );
}
