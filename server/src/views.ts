import type { LocationSettings, TicketRow, ValetSheetsRepository } from '@valet/sheets-integration';
import { can, type StaffUser } from './permissions.js';

const ACTIVE_RETRIEVAL = ['retrieval_requested', 'assigned_in_transit'];

/** Minutes until the car should be at the pickup point, for the guest's ETA (FR-OUT-04). */
export function etaMinutes(repo: ValetSheetsRepository, ticket: TicketRow, now: Date): number | null {
  if (!ACTIVE_RETRIEVAL.includes(ticket.status)) return null;
  const s = repo.getSettings(ticket.location_id, ticket.settings_version);
  const task = repo.tasksForTicket(ticket.id).find((t) => t.type === 'retrieve' && (t.status === 'pending' || t.status === 'accepted'));
  const start = task?.accepted_at ?? task?.release_at ?? ticket.requested_at ?? now.toISOString();
  const readyBy = Math.max(Date.parse(start) + s.avgRetrievalMinutes * 60_000, ticket.scheduled_for ? Date.parse(ticket.scheduled_for) : 0);
  return Math.max(0, Math.ceil((readyBy - now.getTime()) / 60_000));
}

/** Ticket as staff see it: no PIN hash or QR token, mobile masked unless allowed (NFR-PRIV-01). */
export function staffTicket(repo: ValetSheetsRepository, ticket: TicketRow, user: StaffUser, photoUrl: (ref: string) => string, now: Date) {
  const details = repo.getTicketDetails(ticket.id, { showFullMobile: can(user, 'guest.view_full_mobile') });
  const { handover_pin_hash: _pin, qr_token: _qr, ...rest } = details.ticket;
  return {
    ...rest,
    plate_number: details.vehicle?.plate_number ?? null,
    make: details.vehicle?.make ?? null,
    model: details.vehicle?.model ?? null,
    colour: details.vehicle?.colour ?? null,
    guest_name: details.customer?.name ?? null,
    guest_mobile: details.customer?.mobile ?? null,
    balance_due: details.balanceDue,
    eta_minutes: etaMinutes(repo, ticket, now),
    confirmation: repo.currentConfirmation(ticket.id) ?? null,
    photos: repo.photosForTicket(ticket.id).map((p) => ({ id: p.id, type: p.type, url: photoUrl(p.file_ref) })),
    payments: repo.paymentsForTicket(ticket.id),
  };
}

function publicPaymentQr(s: LocationSettings) {
  return s.paymentQr?.status === 'approved' ? { imageDataUrl: s.paymentQr.imageDataUrl, payeeName: s.paymentQr.payeeName } : null;
}

/** What the guest ticket page shows (SRS 4.1). The handover PIN is not stored, so it is only sent at check-in. */
export function guestTicket(repo: ValetSheetsRepository, ticket: TicketRow, now: Date) {
  const location = repo.getLocation(ticket.location_id);
  const s = repo.getSettings(ticket.location_id, ticket.settings_version);
  const current = repo.getSettings(ticket.location_id);
  const details = repo.getTicketDetails(ticket.id);
  const pending = repo.paymentsForTicket(ticket.id).filter((p) => p.status === 'pending');
  const rejected = repo.paymentsForTicket(ticket.id).filter((p) => p.status === 'rejected');
  return {
    appName: location.app_name,
    locationName: location.name,
    ticketNumber: ticket.ticket_number,
    status: ticket.status,
    plateNumber: details.vehicle?.plate_number ?? null,
    vehicle: [details.vehicle?.colour, details.vehicle?.make, details.vehicle?.model].filter(Boolean).join(' ') || null,
    checkedInAt: ticket.checked_in_at,
    requestedAt: ticket.requested_at,
    scheduledFor: ticket.scheduled_for,
    readyAt: ticket.ready_at,
    pickupPoint: ticket.pickup_point,
    etaMinutes: etaMinutes(repo, ticket, now),
    fee: ticket.status === 'parked' || ticket.status === 'checked_in' ? repo.calculateFee(ticket, now.toISOString()) : ticket.fee_amount,
    balanceDue: details.balanceDue,
    pendingPayment: pending.length > 0,
    paymentRejected: rejected.length > 0 && pending.length === 0 && details.balanceDue > 0,
    paymentMethods: s.paymentMethods,
    paymentQr: s.paymentMethods.includes('payment_qr') ? publicPaymentQr(current) : null,
    arrivalTimeRequest: s.arrivalTimeRequest,
    arrivalOptionsMinutes: s.arrivalOptionsMinutes,
    pickupPoints: current.pickupPoints,
    handoverConfirmation: s.handoverConfirmation,
    confirmed: repo.currentConfirmation(ticket.id)?.result ?? null,
    isInAndOut: ticket.is_in_and_out,
    rating: ticket.rating,
  };
}
