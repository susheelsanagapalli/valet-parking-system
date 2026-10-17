/**
 * Spreadsheet schema for the Valet Parking System.
 *
 * Derived from the Supabase schema (locations, tickets, tasks, incidents) and corrected to match
 * SRS v1.6 section 6:
 * - Guest name, mobile and vehicle details live in the Guest data book (Customers, Vehicles), not on
 *   the ticket, so they can be deleted whole at the end of retention (NFR-PRIV-02).
 * - The handover PIN is stored only as a keyed hash (NFR-SEC-01), never as plain digits.
 * - Payments, handover confirmations, in-and-out movements, photos, settings versions and the
 *   audit log get their own tabs (FR-PAY-16, FR-OUT-13, FR-OUT-16, FR-DATA-08, FR-CFG-06, FR-ADM-05).
 * - Tasks carry a release time for arrival-time requests (FR-OUT-15).
 */

export type ColumnType = 'string' | 'number' | 'boolean' | 'datetime' | 'date' | 'json';

export interface ColumnDef {
  key: string;
  type: ColumnType;
  required?: boolean;
  enum?: readonly string[];
  description: string;
  example?: string | number | boolean;
}

/** Which spreadsheet ("book") a tab lives in, per SRS section 6.4. */
export type BookKind = 'config' | 'transactions' | 'guest' | 'audit';

export interface TabDef {
  name: string;
  book: BookKind;
  description: string;
  columns: ColumnDef[];
}

export const SCHEMA_VERSION = 1;

export const SERVICE_PROFILES = ['paid_parking', 'restaurant', 'hotel', 'event_venue', 'custom'] as const;
export const TICKET_STATUSES = [
  'checked_in',
  'parked',
  'retrieval_requested',
  'assigned_in_transit',
  'ready_for_pickup',
  'closed',
  'cancelled',
  'abandoned',
  'out',
] as const;
export const TASK_TYPES = ['park', 'retrieve', 'move'] as const;
export const TASK_STATUSES = ['pending', 'accepted', 'completed', 'cancelled'] as const;
export const PAYMENT_METHODS = ['payment_qr', 'cash', 'card_terminal', 'none'] as const;
export const PAYMENT_STATUSES = ['pending', 'verified', 'rejected'] as const;
export const HANDOVER_RESULTS = ['no_damage', 'damage_reported'] as const;
export const HANDOVER_METHODS = ['ticket_page', 'signature'] as const;
export const MOVEMENT_TYPES = ['out', 'return'] as const;
export const PHOTO_TYPES = ['check_in', 'return', 'parking_spot', 'incident', 'override'] as const;
export const PHOTO_STORAGES = ['google_drive', 'object_storage'] as const;
export const INCIDENT_TYPES = ['damage', 'lost_item', 'delay', 'other'] as const;
export const INCIDENT_STATUSES = ['open', 'under_review', 'resolved', 'rejected'] as const;

const id = (description: string, example: string): ColumnDef => ({ key: 'id', type: 'string', required: true, description, example });
const createdAt: ColumnDef = { key: 'created_at', type: 'datetime', required: true, description: 'When the row was created (UTC, ISO 8601).', example: '2026-10-17T12:30:00.000Z' };

export const TABS: TabDef[] = [
  {
    name: 'Locations',
    book: 'config',
    description: 'A valet site. Settings are versioned in LocationSettings.',
    columns: [
      id('Unique location id.', 'example-loc-1'),
      { key: 'name', type: 'string', required: true, description: 'Location name.', example: 'Spice Garden Restaurant' },
      { key: 'address', type: 'string', description: 'Street address.', example: '12 MG Road, Bengaluru' },
      { key: 'service_profile', type: 'string', required: true, enum: SERVICE_PROFILES, description: 'Service profile used for default settings (SRS 2.7.2).', example: 'restaurant' },
      { key: 'app_name', type: 'string', required: true, description: "Operator's app name shown to guests (SRS 2.8).", example: 'ValetPay' },
      { key: 'timezone', type: 'string', required: true, description: 'IANA time zone for display.', example: 'Asia/Kolkata' },
      { key: 'settings_version', type: 'number', required: true, description: 'Current version in LocationSettings.', example: 1 },
      { key: 'ticket_prefix', type: 'string', required: true, description: 'Prefix for ticket numbers at this location.', example: 'SG' },
      { key: 'is_active', type: 'boolean', required: true, description: 'Whether the location accepts check-ins.', example: true },
      createdAt,
    ],
  },
  {
    name: 'LocationSettings',
    book: 'config',
    description: 'Versioned location settings (FR-CFG-06). Each ticket keeps the version in force at check-in.',
    columns: [
      id('Unique settings row id.', 'example-set-1'),
      { key: 'location_id', type: 'string', required: true, description: 'Location the settings belong to.', example: 'example-loc-1' },
      { key: 'version', type: 'number', required: true, description: 'Settings version, starting at 1.', example: 1 },
      { key: 'settings', type: 'json', required: true, description: 'Full resolved settings as JSON (see settings.ts).', example: '{"spotText":"required","spotGps":"required"}' },
      { key: 'changed_by', type: 'string', required: true, description: 'User who saved this version.', example: 'admin-1' },
      { key: 'valid_from', type: 'datetime', required: true, description: 'When this version took effect.', example: '2026-10-17T12:00:00.000Z' },
    ],
  },
  {
    name: 'Customers',
    book: 'guest',
    description: 'Guest contact data. Deleted with the whole Guest data book at the end of retention (NFR-PRIV-02).',
    columns: [
      id('Unique customer id.', 'example-cus-1'),
      { key: 'mobile', type: 'string', description: 'Guest mobile number (optional).', example: '+919876543210' },
      { key: 'name', type: 'string', description: 'Guest name (optional).', example: 'Asha Rao' },
      { key: 'language', type: 'string', description: 'Preferred language code.', example: 'en' },
      createdAt,
    ],
  },
  {
    name: 'Vehicles',
    book: 'guest',
    description: 'Vehicle details. Plate numbers are personal data and live only in the Guest data book.',
    columns: [
      id('Unique vehicle id.', 'example-veh-1'),
      { key: 'customer_id', type: 'string', description: 'Owner, if known.', example: 'example-cus-1' },
      { key: 'plate_number', type: 'string', required: true, description: 'Plate number, upper case without spaces.', example: 'KA01AB1234' },
      { key: 'make', type: 'string', description: 'Vehicle make.', example: 'Hyundai' },
      { key: 'model', type: 'string', description: 'Vehicle model.', example: 'Creta' },
      { key: 'colour', type: 'string', description: 'Vehicle colour.', example: 'White' },
      createdAt,
    ],
  },
  {
    name: 'Tickets',
    book: 'transactions',
    description: 'One row per vehicle visit; the central record (SRS 6.1).',
    columns: [
      id('Unique ticket id.', 'example-tkt-1'),
      { key: 'location_id', type: 'string', required: true, description: 'Location of the visit.', example: 'example-loc-1' },
      { key: 'ticket_number', type: 'string', required: true, description: 'Human-readable number, unique per location.', example: 'SG0001' },
      { key: 'qr_token', type: 'string', required: true, description: 'Unguessable token encoded in the ticket QR.', example: 'q8Zr2nV7cJ0yKp4sXw9tLm1aBd6e' },
      { key: 'handover_pin_hash', type: 'string', required: true, description: 'HMAC of the 4-digit handover PIN. The PIN itself is never stored.', example: '3f1c…' },
      { key: 'status', type: 'string', required: true, enum: TICKET_STATUSES, description: 'Lifecycle state (SRS 6.2).', example: 'parked' },
      { key: 'customer_id', type: 'string', description: 'Guest, if a mobile number or name was given.', example: 'example-cus-1' },
      { key: 'vehicle_id', type: 'string', required: true, description: 'Vehicle checked in.', example: 'example-veh-1' },
      { key: 'key_tag', type: 'string', required: true, description: 'Key tag or hook number (FR-IN-05).', example: 'K-17' },
      { key: 'spot_text', type: 'string', description: 'Parking spot or landmark text.', example: 'Basement 2, near lift' },
      { key: 'spot_gps_lat', type: 'number', description: 'Parking spot latitude.', example: 12.9758 },
      { key: 'spot_gps_lng', type: 'number', description: 'Parking spot longitude.', example: 77.6045 },
      { key: 'spot_gps_accuracy', type: 'number', description: 'GPS accuracy in metres.', example: 8 },
      { key: 'zone_code', type: 'string', description: 'Zone, in zone/slot mode.', example: '' },
      { key: 'slot_number', type: 'string', description: 'Slot, in zone/slot mode.', example: '' },
      { key: 'custom_fields', type: 'json', description: 'Values of custom check-in fields (FR-CFG-03).', example: '{"reservation_name":"Rao"}' },
      { key: 'settings_version', type: 'number', required: true, description: 'Location settings version in force at check-in.', example: 1 },
      { key: 'checked_in_at', type: 'datetime', required: true, description: 'Check-in time.', example: '2026-10-17T12:30:00.000Z' },
      { key: 'parked_at', type: 'datetime', description: 'When the parking spot was recorded.', example: '2026-10-17T12:34:00.000Z' },
      { key: 'requested_at', type: 'datetime', description: 'Latest non-cancelled retrieval request.', example: '' },
      { key: 'scheduled_for', type: 'datetime', description: 'Arrival or scheduled pickup time chosen by the guest.', example: '' },
      { key: 'ready_at', type: 'datetime', description: 'When the car reached the pickup point.', example: '' },
      { key: 'closed_at', type: 'datetime', description: 'When the ticket closed.', example: '' },
      { key: 'fee_amount', type: 'number', required: true, description: 'Fee calculated by the location tariff (FR-PAY-02).', example: 0 },
      { key: 'pickup_point', type: 'string', description: 'Chosen pickup point.', example: 'Main entrance' },
      { key: 'is_in_and_out', type: 'boolean', required: true, description: 'In-and-out ticket (FR-OUT-16).', example: false },
      { key: 'stay_end_date', type: 'date', description: 'End of stay for in-and-out tickets.', example: '' },
      { key: 'rating', type: 'number', description: 'Guest rating 1–5.', example: '' },
      { key: 'rating_comment', type: 'string', description: 'Guest comment.', example: '' },
      createdAt,
      { key: 'updated_at', type: 'datetime', required: true, description: 'Last change.', example: '2026-10-17T12:34:00.000Z' },
    ],
  },
  {
    name: 'Tasks',
    book: 'transactions',
    description: 'Park, retrieve and move tasks for attendants.',
    columns: [
      id('Unique task id.', 'example-tsk-1'),
      { key: 'ticket_id', type: 'string', required: true, description: 'Ticket the task belongs to.', example: 'example-tkt-1' },
      { key: 'location_id', type: 'string', required: true, description: 'Location queue.', example: 'example-loc-1' },
      { key: 'type', type: 'string', required: true, enum: TASK_TYPES, description: 'Task type.', example: 'park' },
      { key: 'status', type: 'string', required: true, enum: TASK_STATUSES, description: 'Task status.', example: 'completed' },
      { key: 'assigned_to', type: 'string', description: 'Attendant user id.', example: 'att-1' },
      { key: 'priority', type: 'number', required: true, description: 'Higher runs first (e.g. VIP).', example: 0 },
      { key: 'release_at', type: 'datetime', required: true, description: 'When the task enters the queue (arrival-time requests, FR-OUT-15).', example: '2026-10-17T12:30:00.000Z' },
      createdAt,
      { key: 'accepted_at', type: 'datetime', description: 'When an attendant accepted it.', example: '2026-10-17T12:30:00.000Z' },
      { key: 'completed_at', type: 'datetime', description: 'When it was completed or cancelled.', example: '2026-10-17T12:34:00.000Z' },
    ],
  },
  {
    name: 'Payments',
    book: 'transactions',
    description: 'Payments by payment QR, cash or card terminal (FR-PAY-03, FR-PAY-04, FR-PAY-16).',
    columns: [
      id('Unique payment id.', 'example-pay-1'),
      { key: 'ticket_id', type: 'string', required: true, description: 'Ticket paid for.', example: 'example-tkt-1' },
      { key: 'amount', type: 'number', required: true, description: 'Amount paid (0 for nothing due).', example: 100 },
      { key: 'tip', type: 'number', description: 'Tip included.', example: 0 },
      { key: 'method', type: 'string', required: true, enum: PAYMENT_METHODS, description: 'Payment method.', example: 'payment_qr' },
      { key: 'transaction_reference', type: 'string', description: 'UPI/QR transaction reference entered by the guest.', example: '425931234567' },
      { key: 'status', type: 'string', required: true, enum: PAYMENT_STATUSES, description: 'QR payments stay pending until verified manually.', example: 'pending' },
      { key: 'zero_fee_reason', type: 'string', description: 'Why nothing was due (complimentary, validation, pass).', example: '' },
      { key: 'recorded_by', type: 'string', description: 'Staff user or "guest".', example: 'guest' },
      { key: 'verified_by', type: 'string', description: 'User who verified or rejected it.', example: '' },
      createdAt,
      { key: 'verified_at', type: 'datetime', description: 'When it was verified or rejected.', example: '' },
    ],
  },
  {
    name: 'HandoverConfirmations',
    book: 'transactions',
    description: "Guest's no-damage confirmation or damage report at handover (FR-OUT-13).",
    columns: [
      id('Unique confirmation id.', 'example-hc-1'),
      { key: 'ticket_id', type: 'string', required: true, description: 'Ticket handed over.', example: 'example-tkt-1' },
      { key: 'result', type: 'string', required: true, enum: HANDOVER_RESULTS, description: 'Outcome.', example: 'no_damage' },
      { key: 'method', type: 'string', required: true, enum: HANDOVER_METHODS, description: 'How the guest confirmed.', example: 'ticket_page' },
      { key: 'signature_ref', type: 'string', description: 'Signature file reference, if signed.', example: '' },
      { key: 'confirmed_at', type: 'datetime', required: true, description: 'Confirmation time.', example: '2026-10-17T14:05:00.000Z' },
    ],
  },
  {
    name: 'TicketMovements',
    book: 'transactions',
    description: 'Exits and returns of in-and-out tickets (FR-OUT-17).',
    columns: [
      id('Unique movement id.', 'example-mov-1'),
      { key: 'ticket_id', type: 'string', required: true, description: 'In-and-out ticket.', example: 'example-tkt-1' },
      { key: 'type', type: 'string', required: true, enum: MOVEMENT_TYPES, description: 'Out or return.', example: 'out' },
      { key: 'attendant_id', type: 'string', required: true, description: 'Attendant who handled it.', example: 'att-1' },
      { key: 'spot_text', type: 'string', description: 'Parking spot before the exit.', example: 'Basement 2, near lift' },
      { key: 'occurred_at', type: 'datetime', required: true, description: 'When it happened.', example: '2026-10-17T14:05:00.000Z' },
    ],
  },
  {
    name: 'Photos',
    book: 'transactions',
    description: 'References to photos held in the photo storage; files are deleted per FR-DATA-08.',
    columns: [
      id('Unique photo id.', 'example-pho-1'),
      { key: 'ticket_id', type: 'string', required: true, description: 'Ticket the photo belongs to.', example: 'example-tkt-1' },
      { key: 'type', type: 'string', required: true, enum: PHOTO_TYPES, description: 'Photo type.', example: 'parking_spot' },
      { key: 'storage', type: 'string', required: true, enum: PHOTO_STORAGES, description: 'Where the file is stored.', example: 'google_drive' },
      { key: 'file_ref', type: 'string', required: true, description: 'Drive file id or object key.', example: '1AbCdEfGhIjKlMnOp' },
      { key: 'taken_by', type: 'string', required: true, description: 'User who took it.', example: 'att-1' },
      { key: 'taken_at', type: 'datetime', required: true, description: 'When it was taken.', example: '2026-10-17T12:34:00.000Z' },
      { key: 'deleted_at', type: 'datetime', description: 'When the file was deleted.', example: '' },
    ],
  },
  {
    name: 'Incidents',
    book: 'transactions',
    description: 'Damage, lost item and delay reports (FR-INC-01, FR-INC-02).',
    columns: [
      id('Unique incident id.', 'example-inc-1'),
      { key: 'ticket_id', type: 'string', required: true, description: 'Ticket the incident is about.', example: 'example-tkt-1' },
      { key: 'type', type: 'string', required: true, enum: INCIDENT_TYPES, description: 'Incident type.', example: 'damage' },
      { key: 'description', type: 'string', description: 'What happened.', example: 'Scratch on rear bumper' },
      { key: 'status', type: 'string', required: true, enum: INCIDENT_STATUSES, description: 'Incident status.', example: 'open' },
      { key: 'reported_by', type: 'string', required: true, description: 'Staff user or "guest".', example: 'guest' },
      createdAt,
      { key: 'resolved_at', type: 'datetime', description: 'When it was resolved or rejected.', example: '' },
    ],
  },
  {
    name: 'AuditLog',
    book: 'audit',
    description: 'Every create, update and payment action (FR-ADM-05).',
    columns: [
      id('Unique audit entry id.', 'example-aud-1'),
      { key: 'user_id', type: 'string', required: true, description: 'Who did it.', example: 'att-1' },
      { key: 'action', type: 'string', required: true, description: 'Action name.', example: 'ticket.check_in' },
      { key: 'entity', type: 'string', required: true, description: 'Tab name.', example: 'Tickets' },
      { key: 'entity_id', type: 'string', required: true, description: 'Row id.', example: 'example-tkt-1' },
      { key: 'before', type: 'json', description: 'Row before the change.', example: '' },
      { key: 'after', type: 'json', description: 'Row after the change.', example: '{"status":"checked_in"}' },
      { key: 'occurred_at', type: 'datetime', required: true, description: 'When it happened.', example: '2026-10-17T12:30:00.000Z' },
    ],
  },
];

export const TAB_BY_NAME: ReadonlyMap<string, TabDef> = new Map(TABS.map((t) => [t.name, t]));

export function tab(name: string): TabDef {
  const def = TAB_BY_NAME.get(name);
  if (!def) throw new Error(`Unknown tab: ${name}`);
  return def;
}
