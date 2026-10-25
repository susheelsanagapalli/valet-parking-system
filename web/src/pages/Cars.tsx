import { Car, CornerDownLeft, DoorOpen, LogOut, MapPin, Move, Phone, ScanLine, Search, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { QrScanner } from '../components/QrScanner';
import { SpotForm } from '../components/SpotForm';
import { TicketSummary } from '../components/TicketSummary';
import { isDiallable, maskMobile } from '../format';
import { useAction, usePolling } from '../hooks';
import { useSession } from '../session';
import type { LocationSettings, StaffTicket } from '../types';

const FILTERS = [
  { label: 'On site', statuses: 'checked_in,parked,retrieval_requested,assigned_in_transit,ready_for_pickup' },
  { label: 'Out (in-and-out)', statuses: 'out' },
  { label: 'Closed', statuses: 'closed,cancelled,abandoned' },
];

export function CarsPage() {
  const { location, can } = useSession();
  const locationId = location?.id ?? '';
  const [params] = useSearchParams();
  const [filter, setFilter] = useState(0);
  const [query, setQuery] = useState(() => params.get('q') ?? '');
  const [moving, setMoving] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const { setLocationId } = useSession();
  const onScan = useCallback(
    async (code: string) => {
      setScanning(false);
      const ticket = await action.run(() => api<StaffTicket>(`/tickets/by-qr?code=${encodeURIComponent(code)}`));
      if (ticket) {
        if (ticket.location_id !== locationId) setLocationId(ticket.location_id);
        setQuery(ticket.ticket_number);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locationId],
  );
  const statuses = FILTERS[filter]?.statuses ?? '';
  const { data, error, refresh } = usePolling(
    () => api<StaffTicket[]>(`/locations/${locationId}/tickets?${query ? `q=${encodeURIComponent(query)}` : `status=${statuses}`}`),
    [locationId, statuses, query],
  );
  const settings = usePolling(() => api<LocationSettings>(`/locations/${locationId}/settings`), [locationId], 0).data;
  const action = useAction();
  const act = async (fn: () => Promise<unknown>) => {
    if (await action.run(fn)) await refresh();
  };

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="search">
          <Search size={18} aria-hidden />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search plate, ticket or mobile" aria-label="Search cars" />
        </div>
        <button type="button" onClick={() => setScanning(!scanning)}>
          {scanning ? <X size={20} aria-hidden /> : <ScanLine size={20} aria-hidden />}
          Scan ticket QR
        </button>
      </div>
      {scanning && (
        <div className="card">
          <QrScanner onResult={(code) => void onScan(code)} onClose={() => setScanning(false)} />
        </div>
      )}
      {!query && (
        <div className="segmented" style={{ marginBottom: 12 }}>
          {FILTERS.map((f, i) => (
            <button key={f.label} type="button" className={i === filter ? 'selected' : ''} onClick={() => setFilter(i)}>
              {f.label}
            </button>
          ))}
        </div>
      )}
      {action.error && <div className="notice error">{action.error}</div>}
      {error && <div className="notice error">{error}</div>}
      {data?.length === 0 && (
        <EmptyState icon={Car} title={query ? 'No matching cars' : 'No cars here'} hint={query ? 'Check the plate, ticket number or mobile.' : filter === 0 ? 'Check in a car to begin.' : undefined} />
      )}
      {data?.map((t) => (
        <div key={t.id}>
          <TicketSummary ticket={t}>
            {t.guest_mobile &&
              (isDiallable(t.guest_mobile) ? (
                <a className="button" href={`tel:${t.guest_mobile.replace(/\s/g, '')}`} aria-label={`Call guest ${maskMobile(t.guest_mobile)}`}>
                  <Phone size={18} aria-hidden />
                  {maskMobile(t.guest_mobile)}
                </a>
              ) : (
                <span className="muted label-text">
                  <Phone size={16} aria-hidden />
                  {maskMobile(t.guest_mobile)}
                </span>
              ))}
            {t.status === 'parked' && can('tickets.request_car') && (
              <button type="button" disabled={action.busy} onClick={() => void act(() => api(`/tickets/${t.id}/request`, { body: {} }))}>
                <LogOut size={18} aria-hidden />
                Request car
              </button>
            )}
            {t.status === 'retrieval_requested' && can('tickets.request_car') && (
              <button type="button" disabled={action.busy} onClick={() => void act(() => api(`/tickets/${t.id}/cancel-request`, { body: {} }))}>
                <X size={18} aria-hidden />
                Cancel request
              </button>
            )}
            {t.status === 'parked' && can('parking.record_spot') && (
              <button type="button" onClick={() => setMoving(moving === t.id ? null : t.id)}>
                <Move size={18} aria-hidden />
                Move
              </button>
            )}
            {t.status === 'checked_in' && can('parking.record_spot') && (
              <button type="button" className="primary" onClick={() => setMoving(moving === t.id ? null : t.id)}>
                <MapPin size={18} aria-hidden />
                Record spot
              </button>
            )}
            {t.status === 'out' && can('parking.record_spot') && (
              <button type="button" className="primary" disabled={action.busy} onClick={() => void act(() => api(`/tickets/${t.id}/return`, { body: {} }))}>
                <CornerDownLeft size={18} aria-hidden />
                Guest returned
              </button>
            )}
            {t.status === 'out' && can('handover.hand_over') && (
              <button type="button" disabled={action.busy} onClick={() => void act(() => api(`/tickets/${t.id}/end-stay`, { body: {} }))}>
                <DoorOpen size={18} aria-hidden />
                End stay
              </button>
            )}
          </TicketSummary>
          {moving === t.id && settings && (
            <div className="card fade-in">
              <SpotForm
                ticket={t}
                settings={settings}
                submitLabel={t.status === 'parked' ? 'Save new spot' : 'Save parking spot'}
                onDone={() => {
                  setMoving(null);
                  void refresh();
                }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
