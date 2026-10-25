import type { LocationRow, LocationSettings, PaymentRow, TaskRow, TicketStatus, HandoverConfirmationRow } from '@valet/sheets-integration';

export type { LocationRow, LocationSettings, PaymentRow, TaskRow, TicketStatus };

export interface User {
  id: string;
  username: string;
  name: string;
  role: string;
  locations: string[] | 'all';
  permissions: string[];
}

export interface StaffTicket {
  id: string;
  location_id: string;
  ticket_number: string;
  status: TicketStatus;
  key_tag: string;
  spot_text: string | null;
  spot_gps_lat: number | null;
  spot_gps_lng: number | null;
  spot_gps_accuracy: number | null;
  zone_code: string | null;
  slot_number: string | null;
  checked_in_at: string;
  requested_at: string | null;
  scheduled_for: string | null;
  ready_at: string | null;
  fee_amount: number;
  pickup_point: string | null;
  is_in_and_out: boolean;
  stay_end_date: string | null;
  plate_number: string | null;
  make: string | null;
  model: string | null;
  colour: string | null;
  guest_name: string | null;
  guest_mobile: string | null;
  balance_due: number;
  eta_minutes: number | null;
  confirmation: HandoverConfirmationRow | null;
  photos: Array<{ id: string; type: string; url: string }>;
  payments: PaymentRow[];
}

export interface GuestTicket {
  appName: string;
  locationName: string;
  ticketNumber: string;
  status: TicketStatus;
  plateNumber: string | null;
  /** Colour, make and model, e.g. "White Hyundai Creta". */
  vehicle: string | null;
  checkedInAt: string;
  requestedAt: string | null;
  scheduledFor: string | null;
  readyAt: string | null;
  pickupPoint: string | null;
  etaMinutes: number | null;
  fee: number;
  balanceDue: number;
  pendingPayment: boolean;
  paymentRejected: boolean;
  paymentMethods: string[];
  paymentQr: { imageDataUrl: string; payeeName: string } | null;
  arrivalTimeRequest: boolean;
  arrivalOptionsMinutes: number[];
  pickupPoints: string[];
  handoverConfirmation: boolean;
  confirmed: 'no_damage' | 'damage_reported' | null;
  isInAndOut: boolean;
  rating: number | null;
}

export const STATUS_LABEL: Record<TicketStatus, string> = {
  checked_in: 'Checked in',
  parked: 'Parked',
  retrieval_requested: 'Requested',
  assigned_in_transit: 'On the way',
  ready_for_pickup: 'Ready',
  closed: 'Closed',
  cancelled: 'Cancelled',
  abandoned: 'Abandoned',
  out: 'Out',
};
