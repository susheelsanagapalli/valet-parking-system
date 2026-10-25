import { Check, Crosshair } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAction } from '../hooks';
import { useOnline } from '../online';
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

/** The same page on the test HTTPS port (8443), where phones allow GPS and the camera. */
export function secureUrl(): string {
  return `https://${window.location.hostname}:8443${window.location.pathname}`;
}

/**
 * How long to wait for a good fix. Without mobile data the phone cannot download satellite
 * assistance, so a first fix often needs 20–30 s even in the open.
 */
const GPS_WAIT_MS = 30_000;
/**
 * Readings this coarse come from Wi-Fi or cell towers, not satellites. On iPhone it usually means
 * "Precise Location" is off for Safari; on Android, "Google Location Accuracy" is off.
 */
const COARSE_M = 500;

function gpsErrorText(err: GeolocationPositionError | null): string {
  if (err?.code === 1) {
    return 'Location permission is off. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites → "While Using the App" and Precise Location on, then reload. On Android: allow location for this site in the browser. Or describe the spot below.';
  }
  if (err?.code === 3 || err?.code === 2 || !err) {
    return `No GPS fix within ${GPS_WAIT_MS / 1000} seconds. Satellites cannot be seen indoors or underground; try again in the open, or describe the spot below.`;
  }
  return 'Could not get the location. Describe the spot below.';
}

/** Records the parking spot with the text, GPS, photo and zone/slot items switched on for the location (FR-PARK-02, FR-PARK-11). */
export function SpotForm({ ticket, settings, onDone, submitLabel = 'Save parking spot' }: Props) {
  const [text, setText] = useState('');
  const [gps, setGps] = useState<Gps | null>(null);
  const [gpsState, setGpsState] = useState<'idle' | 'locating' | 'failed'>('idle');
  const [gpsProblem, setGpsProblem] = useState<string | null>(null);
  const stopWatch = useRef<() => void>(() => undefined);
  useEffect(() => () => stopWatch.current(), []);
  const [photo, setPhoto] = useState<string | undefined>();
  const [zone, setZone] = useState('');
  const [slot, setSlot] = useState('');
  const { busy, error, run } = useAction();
  const online = useOnline();

  const gpsWeak = gps !== null && gps.accuracyM > settings.gpsMinAccuracyM;
  const gpsMissing = settings.spotGps !== 'off' && (gps === null || gpsWeak);
  // FR-PARK-08: a GPS attempt that failed or came back weak makes the text field required, even when
  // it is switched off. It only appears once GPS has been tried, so a switched-off field stays hidden
  // whenever GPS works.
  const gpsFallback = gpsMissing && gpsState !== 'locating' && (gps !== null || gpsState === 'failed');
  const textRequired = settings.spotText === 'required' || gpsFallback;
  const showText = settings.spotText !== 'off' || gpsFallback;
  // Required GPS must at least be tried before saving; if it fails, the text field takes over.
  const mustTryGps = settings.spotGps === 'required' && gps === null && gpsState !== 'failed';

  /**
   * Watches the position for up to GPS_WAIT_MS and keeps the most accurate reading, stopping early
   * once it is good enough. A single quick reading often times out indoors, which made capture
   * unreliable. Cached positions are never used (maximumAge 0): the attendant has just driven the
   * car, so an older fix would point to where they were on the way, not to the spot.
   */
  function locate() {
    stopWatch.current();
    setGpsProblem(null);
    if (!window.isSecureContext) {
      setGpsState('failed');
      setGpsProblem(
        `Phones only share GPS with secure (https) pages, and this page is http. Open the staff app at ${secureUrl()} instead (see "GPS and camera on phones" on the sign-in page), or describe the spot below.`,
      );
      return;
    }
    if (!navigator.geolocation) {
      setGpsState('failed');
      setGpsProblem('This browser cannot read GPS. Describe the spot below.');
      return;
    }
    setGpsState('locating');
    let best: Gps | null = null;
    let lastError: GeolocationPositionError | null = null;
    const finish = () => {
      stopWatch.current();
      if (best) {
        setGpsState('idle');
      } else {
        setGpsState('failed');
        setGpsProblem(gpsErrorText(lastError));
      }
    };
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const reading = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: Math.round(pos.coords.accuracy) };
        if (!best || reading.accuracyM < best.accuracyM) {
          best = reading;
          setGps(reading);
        }
        if (reading.accuracyM <= settings.gpsMinAccuracyM) finish();
      },
      (err) => {
        lastError = err;
        if (err.code === err.PERMISSION_DENIED) finish();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: GPS_WAIT_MS },
    );
    const timer = setTimeout(finish, GPS_WAIT_MS);
    stopWatch.current = () => {
      clearTimeout(timer);
      navigator.geolocation.clearWatch(watchId);
      stopWatch.current = () => undefined;
    };
  }

  /** Stops waiting and keeps the best reading so far. */
  function keepReading() {
    stopWatch.current();
    setGpsState('idle');
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
            <Crosshair size={20} aria-hidden />
            {gpsState === 'locating' ? (gps ? `Improving accuracy… ±${gps.accuracyM} m` : 'Getting location…') : gps ? 'Update location' : 'Capture location'}
          </button>
          {gpsState === 'locating' && gps && (
            <button type="button" onClick={keepReading}>
              <Check size={18} aria-hidden />
              Use this reading (±{gps.accuracyM} m)
            </button>
          )}
          {gps && (
            <div className={`notice ${gpsWeak ? 'warn' : 'ok'}`}>
              {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)} · accuracy {gps.accuracyM} m
              {gpsWeak && gpsState !== 'locating' && ` — worse than ${settings.gpsMinAccuracyM} m, add a ${settings.spotTextLabel.toLowerCase()}.`}
            </div>
          )}
          {gps && gps.accuracyM >= COARSE_M && gpsState !== 'locating' && (
            <div className="notice warn">
              This position comes from Wi-Fi or mobile towers, not GPS. On iPhone switch on Precise Location (Settings → Privacy & Security → Location Services → Safari
              Websites). On Android switch on Google Location Accuracy (Settings → Location → Location services).
            </div>
          )}
          {!online && (
            <p className="muted" style={{ margin: 0 }}>
              No internet here. GPS still works without it, but the first fix can take up to {GPS_WAIT_MS / 1000} seconds. Tap save once the signal is back; nothing you entered is lost.
            </p>
          )}
          {gpsState === 'failed' && <div className="notice warn">{gpsProblem ?? 'No GPS position. Describe the spot below.'}</div>}
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
      {mustTryGps && gpsState !== 'locating' && <p className="muted" style={{ margin: 0 }}>Capture the GPS location first.</p>}
      <button className="primary big" type="submit" disabled={busy || mustTryGps}>
        <Check size={22} aria-hidden />
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
