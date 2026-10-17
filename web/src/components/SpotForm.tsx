import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAction } from '../hooks';
import type { LocationSettings, StaffTicket } from '../types';
import { PhotoPicker } from './PhotoPicker';

interface Gps {
  lat: number;
  lng: number;
  accuracyM: number;
}

interface Props {
  ticket: StaffTicket;
  settings: LocationSettings;
  onDone: (ticket: StaffTicket, warnings: string[]) => void;
  submitLabel?: string;
}

const mark = (r: string) => (r === 'required' ? ' *' : ' (optional)');

/** Records the parking spot with the text, GPS, photo and zone/slot items switched on for the location (FR-PARK-02, FR-PARK-11). */
export function SpotForm({ ticket, settings, onDone, submitLabel = 'Save parking spot' }: Props) {
  const [text, setText] = useState('');
  const [gps, setGps] = useState<Gps | null>(null);
  const [gpsState, setGpsState] = useState<'idle' | 'locating' | 'failed'>('idle');
  const [photo, setPhoto] = useState<string | undefined>();
  const [zone, setZone] = useState('');
  const [slot, setSlot] = useState('');
  const { busy, error, run } = useAction();

  const gpsWeak = gps !== null && gps.accuracyM > settings.gpsMinAccuracyM;
  const gpsMissing = settings.spotGps !== 'off' && (gps === null || gpsWeak);
  // FR-PARK-08: weak or missing GPS makes the text field required, even when it is switched off.
  const gpsFallback = gpsMissing && (settings.spotGps === 'required' || gps !== null || gpsState === 'failed');
  const textRequired = settings.spotText === 'required' || gpsFallback;
  const showText = settings.spotText !== 'off' || gpsFallback;

  function locate() {
    if (!navigator.geolocation) {
      setGpsState('failed');
      return;
    }
    setGpsState('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: Math.round(pos.coords.accuracy) });
        setGpsState('idle');
      },
      () => setGpsState('failed'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const res = await run(() =>
      api<{ ticket: StaffTicket; warnings: string[] }>(`/tickets/${ticket.id}/spot`, {
        body: {
          text: text.trim() || undefined,
          gps: gps ?? undefined,
          spotPhotoRef: photo,
          zoneCode: settings.zoneSlotList ? zone.trim() || undefined : undefined,
          slotNumber: settings.zoneSlotList ? slot.trim() || undefined : undefined,
        },
      }),
    );
    if (res) onDone(res.ticket, res.warnings);
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      {settings.zoneSlotList && (
        <div className="row">
          <label style={{ flex: 1 }}>
            Zone *
            <input value={zone} onChange={(e) => setZone(e.target.value.toUpperCase())} placeholder="B2" required />
          </label>
          <label style={{ flex: 1 }}>
            Slot *
            <input value={slot} onChange={(e) => setSlot(e.target.value)} placeholder="14" inputMode="numeric" required />
          </label>
        </div>
      )}

      {settings.spotGps !== 'off' && (
        <div className="stack">
          <strong>GPS location{mark(settings.spotGps)}</strong>
          <button type="button" onClick={locate} disabled={gpsState === 'locating'}>
            {gpsState === 'locating' ? 'Getting location…' : gps ? 'Update location' : 'Capture location'}
          </button>
          {gps && (
            <div className={`notice ${gpsWeak ? 'warn' : 'ok'}`}>
              {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)} · accuracy {gps.accuracyM} m
              {gpsWeak && ` — worse than ${settings.gpsMinAccuracyM} m, add a ${settings.spotTextLabel.toLowerCase()}.`}
            </div>
          )}
          {gpsState === 'failed' && <div className="notice warn">No GPS position (e.g. basement). Describe the spot instead.</div>}
        </div>
      )}

      {showText && (
        <label>
          {settings.spotTextLabel}
          {textRequired ? ' *' : ' (optional)'}
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Basement 2, near lift" maxLength={120} required={textRequired} />
        </label>
      )}

      {settings.spotPhoto !== 'off' && <PhotoPicker label={`Spot photo${mark(settings.spotPhoto)}`} max={1} onChange={(refs) => setPhoto(refs[0])} />}

      {error && <div className="notice error">{error}</div>}
      <button className="primary big" type="submit" disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
