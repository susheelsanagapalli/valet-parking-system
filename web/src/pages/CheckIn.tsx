import QRCode from 'qrcode';
import { CalendarDays, Car, CheckCircle2, ExternalLink, Hash, KeyRound, MapPin, Palette, Phone, Plus, Printer, Ticket, User } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { PhotoPicker } from '../components/PhotoPicker';
import { SendSmsButton, type SmsDraft } from '../components/SendSmsButton';
import { SpotForm } from '../components/SpotForm';
import { spotDescription } from '../components/TicketSummary';
import { useAction, usePolling } from '../hooks';
import { useSession } from '../session';
import type { LocationSettings, StaffTicket } from '../types';

interface CheckInResult {
  ticket: StaffTicket;
  handoverPin: string;
  guestLink: string;
  sms: 'sending' | 'tap_to_send' | 'not_configured' | 'invalid_mobile' | 'no_mobile';
  smsDraft: SmsDraft | null;
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
        <div className="card center stack fade-in" style={{ alignItems: 'center' }}>
          <CheckCircle2 size={40} aria-hidden style={{ color: 'var(--ok)' }} />
          <div>
            <div className="section-label">Ticket</div>
            <div className="big-number mono">{result.ticket.ticket_number}</div>
            <div className="muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {result.ticket.plate_number}
            </div>
          </div>
          <div>
            <div className="section-label label-text" style={{ marginBottom: 6 }}>
              <KeyRound size={14} aria-hidden /> Handover PIN
            </div>
            <span className="pin-display">{result.handoverPin}</span>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            The PIN is shown only now. Give it to the guest with the ticket.
          </p>
          {qr && <img className="qr" src={qr} alt="Guest ticket QR code" />}
          <a href={result.guestLink} target="_blank" rel="noreferrer" className="label-text">
            <ExternalLink size={16} aria-hidden /> Guest ticket link
          </a>
          {result.sms === 'sending' && <div className="notice ok">Ticket link and PIN sent to the guest by SMS.</div>}
          {result.smsDraft && <SendSmsButton draft={result.smsDraft} label="Send ticket SMS" />}
          {result.sms === 'not_configured' && <div className="notice warn">SMS is switched off. Let the guest scan the QR or print the ticket.</div>}
          {result.sms === 'invalid_mobile' && <div className="notice warn">The mobile number looks wrong, so no SMS was sent. Let the guest scan the QR.</div>}
          {result.sms === 'no_mobile' && <div className="notice warn">No mobile number: print the ticket for the guest.</div>}
          <div className="row no-print" style={{ justifyContent: 'center' }}>
            <button type="button" onClick={() => window.print()}>
              <Printer size={20} aria-hidden />
              Print ticket
            </button>
          </div>
        </div>
        <div className="card no-print">
          {parked ? (
            <div className="stack">
              <div className="notice ok label-text">
                <CheckCircle2 size={18} aria-hidden /> Parked: {spotDescription(parked.ticket)}
              </div>
              {parked.warnings.map((w) => (
                <div key={w} className="notice warn">
                  {w}
                </div>
              ))}
              <button className="primary big" type="button" onClick={reset}>
                <Plus size={22} aria-hidden />
                Next car
              </button>
            </div>
          ) : (
            <>
              <div className="page-title">
                <span className="icon-tile tone-ok" aria-hidden>
                  <MapPin size={22} />
                </span>
                <h2>Where is it parked?</h2>
              </div>
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
      <div className="page-title" style={{ marginBottom: 0 }}>
        <span className="icon-tile tone-info" aria-hidden>
          <Car size={22} />
        </span>
        <div>
          <h1>Check in a car</h1>
          <p className="muted">Drop-off at {location?.name}</p>
        </div>
      </div>
      <div className="grid">
        <label>
          <span className="label-text">
            <Hash size={16} aria-hidden /> Plate number <span className="req">*</span>
          </span>
          <input
            value={form.plateNumber}
            onChange={(e) => setForm({ ...form, plateNumber: e.target.value.toUpperCase() })}
            autoCapitalize="characters"
            placeholder="KA01AB1234"
            className="mono"
            style={{ letterSpacing: '0.06em' }}
            required
            autoFocus
          />
        </label>
        <label>
          <span className="label-text">
            <KeyRound size={16} aria-hidden /> Key tag <span className="req">*</span>
          </span>
          <input value={form.keyTag} onChange={set('keyTag')} placeholder="K-17" required />
        </label>
        {settings.inAndOut && (
          <label>
            <span className="label-text">
              <CalendarDays size={16} aria-hidden /> Stay end date {settings.stayEndDateRequired && <span className="req">*</span>}
            </span>
            <input type="date" value={form.stayEndDate} onChange={set('stayEndDate')} required={settings.stayEndDateRequired} />
          </label>
        )}
      </div>

      <p className="section-label">Optional details</p>
      <div className="grid">
        <label>
          <span className="label-text">
            <Phone size={16} aria-hidden /> Guest mobile
          </span>
          <span className="hint">For the ticket link. Leave empty for a printed ticket.</span>
          <input value={form.guestMobile} onChange={set('guestMobile')} inputMode="tel" placeholder="+91 98765 43210" />
        </label>
        <label>
          <span className="label-text">
            <User size={16} aria-hidden /> Guest name
          </span>
          <input value={form.guestName} onChange={set('guestName')} />
        </label>
        <label>
          <span className="label-text">
            <Car size={16} aria-hidden /> Make
          </span>
          <input value={form.make} onChange={set('make')} list="makes" />
          <datalist id="makes">
            {MAKES.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label>
          Model
          <input value={form.model} onChange={set('model')} placeholder="e.g. Swift, Creta" />
        </label>
        <label>
          <span className="label-text">
            <Palette size={16} aria-hidden /> Colour
          </span>
          <select value={form.colour} onChange={set('colour')}>
            <option value="">—</option>
            {COLOURS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
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
        <Ticket size={22} aria-hidden />
        {busy ? 'Creating ticket…' : 'Create ticket'}
      </button>
    </form>
  );
}
