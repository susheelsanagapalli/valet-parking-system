import { STATUS_LABEL, type StaffTicket } from '../types';

export function StatusBadge({ status }: { status: StaffTicket['status'] }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status]}</span>;
}

export function spotDescription(t: StaffTicket): string {
  const parts: string[] = [];
  if (t.zone_code || t.slot_number) parts.push(`Slot ${t.zone_code ?? ''}-${t.slot_number ?? ''}`);
  if (t.spot_text) parts.push(t.spot_text);
  if (t.spot_gps_lat !== null) parts.push(`GPS ±${t.spot_gps_accuracy ?? '?'} m`);
  return parts.join(' · ') || 'Spot not recorded';
}

/** Walking directions to the parked car (FR-PARK-09). */
export function mapsLink(t: StaffTicket): string | null {
  if (t.spot_gps_lat === null || t.spot_gps_lng === null) return null;
  return `https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${t.spot_gps_lat},${t.spot_gps_lng}`;
}

export function TicketSummary({ ticket, children }: { ticket: StaffTicket; children?: React.ReactNode }) {
  const map = mapsLink(ticket);
  return (
    <div className="ticket-item">
      <div className="stack" style={{ gap: 4 }}>
        <div className="row">
          <strong className="mono">{ticket.ticket_number}</strong>
          <StatusBadge status={ticket.status} />
          {ticket.is_in_and_out && <span className="badge">In-and-out</span>}
        </div>
        <div>
          <strong>{ticket.plate_number}</strong> <span className="muted">{[ticket.colour, ticket.make, ticket.model].filter(Boolean).join(' ')}</span>
        </div>
        <div className="muted">
          Key {ticket.key_tag} · {spotDescription(ticket)}
          {map && (
            <>
              {' · '}
              <a href={map} target="_blank" rel="noreferrer">
                Map
              </a>
            </>
          )}
        </div>
        {ticket.scheduled_for && ticket.status === 'retrieval_requested' && (
          <div className="muted">Guest arrives {new Date(ticket.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        )}
        {ticket.photos.length > 0 && (
          <div className="thumbs">
            {ticket.photos.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                <img src={p.url} alt={`${p.type} photo`} loading="lazy" />
              </a>
            ))}
          </div>
        )}
      </div>
      {children && <div className="stack" style={{ minWidth: 140 }}>{children}</div>}
    </div>
  );
}
