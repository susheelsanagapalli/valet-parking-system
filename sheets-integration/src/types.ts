import type {
  HANDOVER_METHODS,
  HANDOVER_RESULTS,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  MOVEMENT_TYPES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PHOTO_STORAGES,
  PHOTO_TYPES,
  SERVICE_PROFILES,
  TASK_STATUSES,
  TASK_TYPES,
  TICKET_STATUSES,
} from './schema.js';
import type { LocationSettings } from './settings.js';

export type ServiceProfile = (typeof SERVICE_PROFILES)[number];
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TaskType = (typeof TASK_TYPES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type HandoverResult = (typeof HANDOVER_RESULTS)[number];
export type HandoverMethod = (typeof HANDOVER_METHODS)[number];
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export type PhotoType = (typeof PHOTO_TYPES)[number];
export type PhotoStorage = (typeof PHOTO_STORAGES)[number];
export type IncidentType = (typeof INCIDENT_TYPES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export interface LocationRow {
  [key: string]: unknown;
  id: string;
  name: string;
  address: string | null;
  service_profile: ServiceProfile;
  app_name: string;
  timezone: string;
  settings_version: number;
  ticket_prefix: string;
  is_active: boolean;
  created_at: string;
}

export interface LocationSettingsRow {
  [key: string]: unknown;
  id: string;
  location_id: string;
  version: number;
  settings: LocationSettings;
  changed_by: string;
  valid_from: string;
}

export interface CustomerRow {
  [key: string]: unknown;
  id: string;
  mobile: string | null;
  name: string | null;
  language: string | null;
  created_at: string;
}

export interface VehicleRow {
  [key: string]: unknown;
  id: string;
  customer_id: string | null;
  plate_number: string;
  make: string | null;
  model: string | null;
  colour: string | null;
  created_at: string;
}

export interface TicketRow {
  [key: string]: unknown;
  id: string;
  location_id: string;
  ticket_number: string;
  qr_token: string;
  handover_pin_hash: string;
  status: TicketStatus;
  customer_id: string | null;
  vehicle_id: string;
  key_tag: string;
  spot_text: string | null;
  spot_gps_lat: number | null;
  spot_gps_lng: number | null;
  spot_gps_accuracy: number | null;
  zone_code: string | null;
  slot_number: string | null;
  custom_fields: Record<string, unknown> | null;
  settings_version: number;
  checked_in_at: string;
  parked_at: string | null;
  requested_at: string | null;
  scheduled_for: string | null;
  ready_at: string | null;
  closed_at: string | null;
  fee_amount: number;
  pickup_point: string | null;
  is_in_and_out: boolean;
  stay_end_date: string | null;
  rating: number | null;
  rating_comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  [key: string]: unknown;
  id: string;
  ticket_id: string;
  location_id: string;
  type: TaskType;
  status: TaskStatus;
  assigned_to: string | null;
  priority: number;
  release_at: string;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
}

export interface PaymentRow {
  [key: string]: unknown;
  id: string;
  ticket_id: string;
  amount: number;
  tip: number | null;
  method: PaymentMethod;
  transaction_reference: string | null;
  status: PaymentStatus;
  zero_fee_reason: string | null;
  recorded_by: string | null;
  verified_by: string | null;
  created_at: string;
  verified_at: string | null;
}

export interface HandoverConfirmationRow {
  [key: string]: unknown;
  id: string;
  ticket_id: string;
  result: HandoverResult;
  method: HandoverMethod;
  signature_ref: string | null;
  confirmed_at: string;
}

export interface TicketMovementRow {
  [key: string]: unknown;
  id: string;
  ticket_id: string;
  type: MovementType;
  attendant_id: string;
  spot_text: string | null;
  occurred_at: string;
}

export interface PhotoRow {
  [key: string]: unknown;
  id: string;
  ticket_id: string;
  type: PhotoType;
  storage: PhotoStorage;
  file_ref: string;
  taken_by: string;
  taken_at: string;
  deleted_at: string | null;
}

export interface IncidentRow {
  [key: string]: unknown;
  id: string;
  ticket_id: string;
  type: IncidentType;
  description: string | null;
  status: IncidentStatus;
  reported_by: string;
  created_at: string;
  resolved_at: string | null;
}

export interface AuditLogRow {
  [key: string]: unknown;
  id: string;
  user_id: string;
  action: string;
  entity: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  occurred_at: string;
}
