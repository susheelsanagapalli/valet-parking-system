import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { PhotoPicker } from '../components/PhotoPicker';
import { SpotForm } from '../components/SpotForm';
import { spotDescription } from '../components/TicketSummary';
import { useAction, usePolling } from '../hooks';
import { useSession } from '../session';
import type { LocationSettings, StaffTicket } from '../types';

interface CheckInResult {
  ticket: StaffTicket;
  handoverPin: string;
  guestLink: string;
  sms: 'sending' | 'not_configured' | 'invalid_mobile' | 'no_mobile';
}

const EMPTY = { plateNumber: '', keyTag: '', guestMobile: '', guestName: '', make: '', model: '', colour: '', stayEndDate: '' };
const COLOURS = ['White', 'Black', 'Silver', 'Grey', 'Red', 'Blue', 'Brown', 'Green'];
const MAKES = ['Maruti Suzuki', 'Hyundai', 'Tata', 'Mahindra', 'Toyota', 'Honda', 'Kia', 'MG', 'Skoda', 'Volkswagen', 'BMW', 'Mercedes-Benz'];

export function CheckInPage() {
  const { location } = useSession();
  const locationId = location?.id ?? '';
  const settings = usePolling(() => api<LocationSettings>(`/locations/${locationId}/settings`), [locationId], 0).data;
  const [form, setForm] = useState(EMPTY);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoKey, setPhotoKey] = useState(0);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [parked, setParked] = useState<{ ticket: StaffTicket; warnings: string[] } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (result) void QRCode.toDataURL(result.guestLink, { margin: 1, width: 400 }).then(setQr);
  }, [result]);

  if (!settings) return <div className="muted">Loading…</div>;
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()]));
    const res = await run(() => api<CheckInResult>(`/locations/${locationId}/tickets`, { body: { ...body, vehiclePhotoRefs: photos } }));
    if (res) {
      setResult(res);
      setParked(null);
    }
  }

  function reset() {
    setForm(EMPTY);
    setPhotos([]);
    setPhotoKey((k) => k + 1);
    setResult(null);
    setParked(null);
    setQr(null);
  }

  if (result) {
    return (
      <div className="stack">
        <div className="card center">
          <div className="muted">Ticket</div>
          <div className="big-number mono">{result.ticket.ticket_number}</div>
          <div>
            Handover PIN: <strong className="mono" style={{ fontSize: '1.4rem' }}>{result.handoverPin}</strong>
          </div>
          <p className="muted">The PIN is shown only now. Give it to the guest with the ticket.</p>
          {qr && <img className="qr" src={qr} alt="Guest ticket QR code" />}
          <p>
            <a href={result.guestLink} target="_blank" rel="noreferrer">
              Guest ticket link
            </a>
          </p>
          {result.sms === 'sending' && <div className="notice ok">Ticket link and PIN sent to the guest by SMS.</div>}
          {result.sms === 'not_configured' && <div className="notice warn">SMS is switched off. Let the guest scan the QR or print the ticket.</div>}
          {result.sms === 'invalid_mobile' && <div className="notice warn">The mobile number looks wrong, so no SMS was sent. Let the guest scan the QR.</div>}
          {result.sms === 'no_mobile' && <div className="notice warn">No mobile number: print the ticket for the guest.</div>}
          <div className="row" style={{ justifyContent: 'center' }}>
            <button type="button" onClick={() => window.print()}>
              Print ticket
            </button>
          </div>
        </div>
        <div className="card">
          {parked ? (
            <div className="stack">
              <div className="notice ok">Parked: {spotDescription(parked.ticket)}</div>
              {parked.warnings.map((w) => (
                <div key={w} className="notice warn">
                  {w}
                </div>
              ))}
              <button className="primary big" type="button" onClick={reset}>
                Next car
              </button>
            </div>
          ) : (
            <>
              <h2>Where is it parked?</h2>
              <SpotForm ticket={result.ticket} settings={settings} onDone={(ticket, warnings) => setParked({ ticket, warnings })} />
            </>
          )}
        </div>
      </div>
    );
  }

  const photosRequired = settings.vehiclePhotos === 'required';
  return (
    <form className="card stack" onSubmit={(e) => void submit(e)}>
      <h1>Check in a car</h1>
      <div className="grid">
        <label>
          Plate number *
          <input value={form.plateNumber} onChange={set('plateNumber')} autoCapitalize="characters" placeholder="KA01AB1234" required />
        </label>
        <label>
          Key tag *
          <input value={form.keyTag} onChange={set('keyTag')} placeholder="K-17" required />
        </label>
        <label>
          Guest mobile
          <span className="hint">For the ticket link. Leave empty for a printed ticket.</span>
          <input value={form.guestMobile} onChange={set('guestMobile')} inputMode="tel" placeholder="+91 98765 43210" />
        </label>
        <label>
          Guest name
          <input value={form.guestName} onChange={set('guestName')} />
        </label>
        <label>
          Make
          <input value={form.make} onChange={set('make')} list="makes" />
          <datalist id="makes">
            {MAKES.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label>
          Model
          <input value={form.model} onChange={set('model')} />
        </label>
        <label>
          Colour
          <select value={form.colour} onChange={set('colour')}>
            <option value="">—</option>
            {COLOURS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {settings.inAndOut && (
          <label>
            Stay end date{settings.stayEndDateRequired ? ' *' : ''}
            <input type="date" value={form.stayEndDate} onChange={set('stayEndDate')} required={settings.stayEndDateRequired} />
          </label>
        )}
      </div>
      {settings.vehiclePhotos !== 'off' && (
        <PhotoPicker
          key={photoKey}
          label={`Vehicle photos${photosRequired ? ` * (${settings.vehiclePhotoCount} required)` : ' (optional)'}`}
          hint="Front, rear, left and right"
          max={Math.max(settings.vehiclePhotoCount, 4)}
          onChange={setPhotos}
        />
      )}
      {error && <div className="notice error">{error}</div>}
      <button className="primary big" type="submit" disabled={busy || (photosRequired && photos.length < settings.vehiclePhotoCount)}>
        {busy ? 'Creating ticket…' : 'Create ticket'}
      </button>
    </form>
  );
}
