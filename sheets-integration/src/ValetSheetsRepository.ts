import { ValetError } from './errors.js';
import { chargeableMinutes, feeForMinutes } from './fees.js';
import { KeyedMutex } from './KeyedMutex.js';
import { validateRow, type Row } from './rows.js';
import { TABS, tab, type TabDef } from './schema.js';
import { hashPin, maskMobile, newHandoverPin, newId, newQrToken, normalizePlate, safeEqual, verifyPin } from './security.js';
import { resolveSettings, validateSettings, type LocationSettings } from './settings.js';
import type { SheetStore } from './store/SheetStore.js';
import type {
  AuditLogRow,
  CustomerRow,
  HandoverConfirmationRow,
  HandoverMethod,
  HandoverResult,
  IncidentRow,
  IncidentType,
  LocationRow,
  LocationSettingsRow,
  PaymentMethod,
  PaymentRow,
  PhotoRow,
  PhotoStorage,
  PhotoType,
  ServiceProfile,
  TaskRow,
  TicketMovementRow,
  TicketRow,
  TicketStatus,
  VehicleRow,
} from './types.js';
import { WriteQueue } from './WriteQueue.js';

export interface RepositoryOptions {
  store: SheetStore;
  /** Secret for handover PIN hashing; keep it out of the spreadsheets (NFR-SEC-01). */
  pinSecret: string;
  flushIntervalMs?: number;
  persistPath?: string;
  onWriteError?: (err: unknown) => void;
  now?: () => Date;
}

/** Allowed ticket status changes (SRS 6.2). */
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  checked_in: ['parked', 'cancelled'],
  parked: ['retrieval_requested', 'abandoned'],
  retrieval_requested: ['parked', 'assigned_in_transit'],
  assigned_in_transit: ['ready_for_pickup'],
  ready_for_pickup: ['closed', 'out', 'parked'],
  out: ['checked_in', 'closed'],
  closed: [],
  cancelled: [],
  abandoned: [],
};

/** Statuses in which the car physically occupies its slot. */
const IN_SLOT: TicketStatus[] = ['parked', 'retrieval_requested', 'assigned_in_transit'];

export interface CheckInInput {
  locationId: string;
  attendantId: string;
  plateNumber: string;
  keyTag: string;
  guestMobile?: string;
  guestName?: string;
  language?: string;
  make?: string;
  model?: string;
  colour?: string;
  customFields?: Record<string, unknown>;
  vehiclePhotoRefs?: string[];
  photoStorage?: PhotoStorage;
  stayEndDate?: string;
}

export interface ParkingSpotInput {
  attendantId: string;
  text?: string;
  gps?: { lat: number; lng: number; accuracyM: number };
  spotPhotoRef?: string;
  zoneCode?: string;
  slotNumber?: string;
  photoStorage?: PhotoStorage;
}

export interface RetrievalInput {
  requestedBy: string;
  pickupPoint?: string;
  /** "I'll arrive in N minutes" (FR-OUT-15). */
  arriveInMinutes?: number;
  /** Arrival or scheduled pickup time, ISO 8601 (FR-OUT-02, FR-OUT-15). */
  arriveAt?: string;
}

export interface HandoverInput {
  attendantId: string;
  confirmation?: { result: HandoverResult; method: HandoverMethod; signatureRef?: string; damageDescription?: string };
  /** Supervisor who approved releasing the car with a balance due (FR-PAY-14). */
  supervisorApprovalBy?: string;
  /** For in-and-out tickets: true closes the ticket instead of moving it to Out (FR-OUT-17). */
  endOfStay?: boolean;
}

export interface TicketDetails {
  ticket: TicketRow;
  vehicle: VehicleRow | undefined;
  customer: (CustomerRow & { mobile: string | null }) | undefined;
  balanceDue: number;
}

export class ValetSheetsRepository {
  private readonly store: SheetStore;
  private readonly cache = new Map<string, Map<string, Row>>();
  private readonly mutex = new KeyedMutex();
  private readonly now: () => Date;
  readonly queue: WriteQueue;

  constructor(private readonly options: RepositoryOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.queue = new WriteQueue({
      store: options.store,
      flushIntervalMs: options.flushIntervalMs,
      persistPath: options.persistPath,
      onError: options.onWriteError,
    });
    for (const t of TABS) this.cache.set(t.name, new Map());
  }

  /** Creates missing tabs and loads every row into the cache. Call once at start-up. */
  async load(): Promise<void> {
    for (const t of TABS) {
      await this.store.ensureTab(t);
      const rows = new Map<string, Row>();
      for (const r of await this.store.readRows(t)) rows.set(String(r.id), r);
      this.cache.set(t.name, rows);
    }
  }

  /** Sends all queued writes to the store. */
  flush(): Promise<void> {
    return this.queue.flush();
  }

  close(): Promise<void> {
    return this.queue.close();
  }

  // ---------------------------------------------------------------- cache helpers

  private table<T extends Row>(name: string): Map<string, T> {
    return this.cache.get(name) as Map<string, T>;
  }

  private all<T extends Row>(name: string): T[] {
    return [...this.table<T>(name).values()];
  }

  private find<T extends Row>(name: string, id: string): T {
    const row = this.table<T>(name).get(id);
    if (!row) throw new ValetError('NOT_FOUND', `${name} ${id} not found`);
    return row;
  }

  private iso(): string {
    return this.now().toISOString();
  }

  private assertValid(def: TabDef, row: Row): void {
    const errors = validateRow(def, row);
    if (errors.length > 0) throw new ValetError('INVALID_INPUT', `${def.name}: ${errors.join('; ')}`);
  }

  private insert<T extends Row>(name: string, row: T, userId: string, action: string): T {
    const def = tab(name);
    this.assertValid(def, row);
    this.table<T>(name).set(String(row.id), row);
    this.queue.enqueue({ kind: 'append', tab: def, rows: [row] });
    if (name !== 'AuditLog') this.audit(userId, action, name, String(row.id), null, row);
    return row;
  }

  private patch<T extends Row>(name: string, id: string, changes: Partial<T>, userId: string, action: string): T {
    const def = tab(name);
    const before = this.find<T>(name, id);
    const after = { ...before, ...changes } as T;
    if ('updated_at' in after) (after as Row).updated_at = this.iso();
    this.assertValid(def, after);
    this.table<T>(name).set(id, after);
    this.queue.enqueue({ kind: 'update', tab: def, rows: [after] });
    this.audit(userId, action, name, id, before, after);
    return after;
  }

  private audit(userId: string, action: string, entity: string, entityId: string, before: unknown, after: unknown): void {
    const row: AuditLogRow = { id: newId(), user_id: userId, action, entity, entity_id: entityId, before, after, occurred_at: this.iso() };
    this.insert('AuditLog', row, userId, action);
  }

  private setStatus(ticket: TicketRow, to: TicketStatus, userId: string, action: string, extra: Partial<TicketRow> = {}): TicketRow {
    if (!TRANSITIONS[ticket.status].includes(to)) {
      throw new ValetError('INVALID_STATE', `Ticket ${ticket.ticket_number} cannot move from ${ticket.status} to ${to}`);
    }
    return this.patch<TicketRow>('Tickets', ticket.id, { ...extra, status: to }, userId, action);
  }

  // ---------------------------------------------------------------- locations and settings

  createLocation(input: {
    name: string;
    address?: string;
    serviceProfile: ServiceProfile;
    appName: string;
    timezone?: string;
    ticketPrefix?: string;
    settingsOverrides?: Partial<LocationSettings>;
    createdBy: string;
  }): LocationRow {
    const settings = resolveSettings(input.serviceProfile, input.settingsOverrides);
    const problems = validateSettings(settings);
    if (problems.length > 0) throw new ValetError('INVALID_SETTINGS', problems.join(' '));
    const location: LocationRow = {
      id: newId(),
      name: input.name,
      address: input.address ?? null,
      service_profile: input.serviceProfile,
      app_name: input.appName,
      timezone: input.timezone ?? 'Asia/Kolkata',
      settings_version: 1,
      ticket_prefix: input.ticketPrefix ?? 'T',
      is_active: true,
      created_at: this.iso(),
    };
    this.insert('Locations', location, input.createdBy, 'location.create');
    this.insert<LocationSettingsRow>(
      'LocationSettings',
      { id: newId(), location_id: location.id, version: 1, settings, changed_by: input.createdBy, valid_from: this.iso() },
      input.createdBy,
      'settings.create',
    );
    return location;
  }

  listLocations(): LocationRow[] {
    return this.all<LocationRow>('Locations');
  }

  getLocation(locationId: string): LocationRow {
    return this.find<LocationRow>('Locations', locationId);
  }

  /** Tickets at a location, newest first, optionally filtered by status. */
  listTickets(locationId: string, statuses?: TicketStatus[]): TicketRow[] {
    return this.all<TicketRow>('Tickets')
      .filter((t) => t.location_id === locationId && (!statuses || statuses.includes(t.status)))
      .sort((a, b) => Date.parse(b.checked_in_at) - Date.parse(a.checked_in_at));
  }

  getTask(taskId: string): TaskRow {
    return this.find<TaskRow>('Tasks', taskId);
  }

  tasksForTicket(ticketId: string): TaskRow[] {
    return this.all<TaskRow>('Tasks').filter((t) => t.ticket_id === ticketId);
  }

  paymentsForTicket(ticketId: string): PaymentRow[] {
    return this.all<PaymentRow>('Payments').filter((p) => p.ticket_id === ticketId);
  }

  photosForTicket(ticketId: string): PhotoRow[] {
    return this.all<PhotoRow>('Photos').filter((p) => p.ticket_id === ticketId && !p.deleted_at);
  }

  getSettings(locationId: string, version?: number): LocationSettings {
    const location = this.find<LocationRow>('Locations', locationId);
    const wanted = version ?? location.settings_version;
    const row = this.all<LocationSettingsRow>('LocationSettings').find((s) => s.location_id === locationId && s.version === wanted);
    if (!row) throw new ValetError('NOT_FOUND', `Settings version ${wanted} for location ${locationId} not found`);
    return structuredClone(row.settings);
  }

  /** Saves a new settings version; open tickets keep the version they were checked in with (FR-CFG-06). */
  updateLocationSettings(locationId: string, changes: Partial<LocationSettings>, changedBy: string): LocationSettings {
    const location = this.find<LocationRow>('Locations', locationId);
    const settings = { ...this.getSettings(locationId), ...changes };
    const problems = validateSettings(settings);
    if (problems.length > 0) throw new ValetError('INVALID_SETTINGS', problems.join(' '));
    const version = location.settings_version + 1;
    this.insert<LocationSettingsRow>(
      'LocationSettings',
      { id: newId(), location_id: locationId, version, settings, changed_by: changedBy, valid_from: this.iso() },
      changedBy,
      'settings.update',
    );
    this.patch<LocationRow>('Locations', locationId, { settings_version: version }, changedBy, 'location.settings_version');
    return settings;
  }

  // ---------------------------------------------------------------- check-in and parking

  /** Creates a ticket (FR-IN-01, FR-IN-02). The returned PIN is shown or sent once and never stored. */
  async checkIn(input: CheckInInput): Promise<{ ticket: TicketRow; handoverPin: string; parkTask: TaskRow }> {
    const location = this.find<LocationRow>('Locations', input.locationId);
    if (!location.is_active) throw new ValetError('INVALID_STATE', `Location ${location.name} is not active`);
    const settings = this.getSettings(location.id);
    const plate = normalizePlate(input.plateNumber ?? '');
    if (!plate) throw new ValetError('INVALID_INPUT', 'Plate number is required');
    if (!input.keyTag?.trim()) throw new ValetError('INVALID_INPUT', 'Key tag is required (FR-IN-05)');
    const photos = input.vehiclePhotoRefs ?? [];
    if (settings.vehiclePhotos === 'off' && photos.length > 0) throw new ValetError('INVALID_INPUT', 'Vehicle photos are switched off for this location');
    if (settings.vehiclePhotos === 'required' && photos.length < settings.vehiclePhotoCount) {
      throw new ValetError('INVALID_INPUT', `${settings.vehiclePhotoCount} vehicle photos are required (FR-IN-03)`);
    }
    if (settings.inAndOut && settings.stayEndDateRequired && !input.stayEndDate) {
      throw new ValetError('INVALID_INPUT', 'Stay end date is required for in-and-out tickets');
    }

    return this.mutex.run(`ticket-number:${location.id}`, () => {
      const by = input.attendantId;
      const customer = this.upsertCustomer(input, by);
      const vehicle = this.upsertVehicle(plate, customer?.id ?? null, input, by);
      const id = newId();
      const pin = newHandoverPin();
      const now = this.iso();
      const ticket: TicketRow = {
        id,
        location_id: location.id,
        ticket_number: this.nextTicketNumber(location),
        qr_token: newQrToken(),
        handover_pin_hash: hashPin(this.options.pinSecret, id, pin),
        status: 'checked_in',
        customer_id: customer?.id ?? null,
        vehicle_id: vehicle.id,
        key_tag: input.keyTag.trim(),
        spot_text: null,
        spot_gps_lat: null,
        spot_gps_lng: null,
        spot_gps_accuracy: null,
        zone_code: null,
        slot_number: null,
        custom_fields: input.customFields ?? null,
        settings_version: location.settings_version,
        checked_in_at: now,
        parked_at: null,
        requested_at: null,
        scheduled_for: null,
        ready_at: null,
        closed_at: null,
        fee_amount: 0,
        pickup_point: null,
        is_in_and_out: settings.inAndOut,
        stay_end_date: input.stayEndDate ?? null,
        rating: null,
        rating_comment: null,
        created_at: now,
        updated_at: now,
      };
      this.insert('Tickets', ticket, by, 'ticket.check_in');
      for (const ref of photos) this.addPhoto(ticket.id, { type: 'check_in', fileRef: ref, takenBy: by, storage: input.photoStorage });
      const parkTask = this.createTask(ticket, 'park', by, { status: 'accepted', assigned_to: by, accepted_at: now });
      return { ticket, handoverPin: pin, parkTask };
    });
  }

  private upsertCustomer(input: CheckInInput, by: string): CustomerRow | undefined {
    const mobile = input.guestMobile?.trim() || null;
    const name = input.guestName?.trim() || null;
    if (!mobile && !name) return undefined;
    const existing = mobile ? this.all<CustomerRow>('Customers').find((c) => c.mobile === mobile) : undefined;
    if (existing) {
      if (name && existing.name !== name) return this.patch<CustomerRow>('Customers', existing.id, { name }, by, 'customer.update');
      return existing;
    }
    return this.insert<CustomerRow>(
      'Customers',
      { id: newId(), mobile, name, language: input.language ?? null, created_at: this.iso() },
      by,
      'customer.create',
    );
  }

  /** Reuses a known vehicle by plate within this operator's data (FR-IN-07). */
  private upsertVehicle(plate: string, customerId: string | null, input: CheckInInput, by: string): VehicleRow {
    const existing = this.all<VehicleRow>('Vehicles').find((v) => v.plate_number === plate);
    const details = { make: input.make ?? null, model: input.model ?? null, colour: input.colour ?? null };
    if (existing) {
      const changes: Partial<VehicleRow> = {};
      if (customerId && existing.customer_id !== customerId) changes.customer_id = customerId;
      for (const k of ['make', 'model', 'colour'] as const) if (details[k] && details[k] !== existing[k]) changes[k] = details[k];
      return Object.keys(changes).length > 0 ? this.patch<VehicleRow>('Vehicles', existing.id, changes, by, 'vehicle.update') : existing;
    }
    return this.insert<VehicleRow>(
      'Vehicles',
      { id: newId(), customer_id: customerId, plate_number: plate, ...details, created_at: this.iso() },
      by,
      'vehicle.create',
    );
  }

  private nextTicketNumber(location: LocationRow): string {
    const prefix = location.ticket_prefix;
    let max = 0;
    for (const t of this.all<TicketRow>('Tickets')) {
      if (t.location_id !== location.id || !t.ticket_number.startsWith(prefix)) continue;
      const n = Number(t.ticket_number.slice(prefix.length));
      if (Number.isFinite(n) && n > max) max = n;
    }
    return `${prefix}${String(max + 1).padStart(4, '0')}`;
  }

  private createTask(ticket: TicketRow, type: TaskRow['type'], by: string, extra: Partial<TaskRow> = {}): TaskRow {
    const now = this.iso();
    return this.insert<TaskRow>(
      'Tasks',
      {
        id: newId(),
        ticket_id: ticket.id,
        location_id: ticket.location_id,
        type,
        status: 'pending',
        assigned_to: null,
        priority: 0,
        release_at: now,
        created_at: now,
        accepted_at: null,
        completed_at: null,
        ...extra,
      },
      by,
      `task.create_${type}`,
    );
  }

  /**
   * Records where the car is parked (FR-PARK-02, FR-PARK-08, FR-PARK-10, FR-PARK-11). Parks a
   * checked-in car, or moves a parked one (FR-PARK-05). Returns warnings such as weak GPS.
   */
  async recordParkingSpot(ticketId: string, input: ParkingSpotInput): Promise<{ ticket: TicketRow; warnings: string[] }> {
    const ticket = this.find<TicketRow>('Tickets', ticketId);
    return this.mutex.run(`slots:${ticket.location_id}`, () => {
      const current = this.find<TicketRow>('Tickets', ticketId);
      if (current.status !== 'checked_in' && current.status !== 'parked') {
        throw new ValetError('INVALID_STATE', `Cannot record a parking spot while the ticket is ${current.status}`);
      }
      const s = this.getSettings(current.location_id, current.settings_version);
      const warnings: string[] = [];
      const text = input.text?.trim() || null;

      if (s.spotGps === 'off' && input.gps) throw new ValetError('INVALID_INPUT', 'GPS is switched off for this location');
      if (s.spotPhoto === 'off' && input.spotPhotoRef) throw new ValetError('INVALID_INPUT', 'Spot photo is switched off for this location');
      const gpsUsable = input.gps !== undefined && input.gps.accuracyM <= s.gpsMinAccuracyM;
      let textRequired = s.spotText === 'required';
      if (s.spotGps !== 'off' && !gpsUsable) {
        if (s.spotGps === 'required' || input.gps) {
          // FR-PARK-08: weak or missing GPS makes the text field required, even when it is switched off.
          textRequired = true;
          warnings.push(
            input.gps
              ? `GPS accuracy ${input.gps.accuracyM} m is worse than ${s.gpsMinAccuracyM} m; ${s.spotTextLabel} is required`
              : `No GPS position; ${s.spotTextLabel} is required`,
          );
        }
      }
      if (s.spotText === 'off' && text && !textRequired) throw new ValetError('INVALID_INPUT', 'The parking spot text field is switched off');
      if (textRequired && !text) throw new ValetError('INVALID_INPUT', `${s.spotTextLabel} is required`);
      if (s.spotPhoto === 'required' && !input.spotPhotoRef) throw new ValetError('INVALID_INPUT', 'A spot photo is required');
      if (s.zoneSlotList && (!input.zoneCode || !input.slotNumber)) throw new ValetError('INVALID_INPUT', 'Zone and slot are required');
      if (!s.zoneSlotList && (input.zoneCode || input.slotNumber)) throw new ValetError('INVALID_INPUT', 'Zone/slot list is switched off');
      if (!text && !input.gps && !input.spotPhotoRef && !input.slotNumber) {
        throw new ValetError('INVALID_INPUT', 'Record at least one of text, GPS, photo or slot (FR-PARK-11)');
      }

      if (s.zoneSlotList) {
        const taken = this.all<TicketRow>('Tickets').some(
          (t) =>
            t.id !== current.id &&
            t.location_id === current.location_id &&
            IN_SLOT.includes(t.status) &&
            t.zone_code === input.zoneCode &&
            t.slot_number === input.slotNumber,
        );
        if (taken) throw new ValetError('SLOT_OCCUPIED', `Slot ${input.zoneCode}-${input.slotNumber} is already occupied (FR-PARK-04)`);
      }

      const by = input.attendantId;
      const spot: Partial<TicketRow> = {
        spot_text: text,
        spot_gps_lat: input.gps?.lat ?? null,
        spot_gps_lng: input.gps?.lng ?? null,
        spot_gps_accuracy: input.gps?.accuracyM ?? null,
        zone_code: input.zoneCode ?? null,
        slot_number: input.slotNumber ?? null,
      };
      if (input.spotPhotoRef) this.addPhoto(current.id, { type: 'parking_spot', fileRef: input.spotPhotoRef, takenBy: by, storage: input.photoStorage });

      if (current.status === 'checked_in') {
        const parkTask = this.all<TaskRow>('Tasks').find((t) => t.ticket_id === current.id && t.type === 'park' && t.status !== 'completed' && t.status !== 'cancelled');
        if (parkTask) this.patch<TaskRow>('Tasks', parkTask.id, { status: 'completed', completed_at: this.iso() }, by, 'task.complete_park');
        return { ticket: this.setStatus(current, 'parked', by, 'ticket.park', { ...spot, parked_at: this.iso() }), warnings };
      }
      this.createTask(current, 'move', by, { status: 'completed', assigned_to: by, accepted_at: this.iso(), completed_at: this.iso() });
      return { ticket: this.patch<TicketRow>('Tickets', current.id, spot, by, 'ticket.move'), warnings };
    });
  }

  addPhoto(ticketId: string, input: { type: PhotoType; fileRef: string; takenBy: string; storage?: PhotoStorage }): PhotoRow {
    this.find<TicketRow>('Tickets', ticketId);
    return this.insert<PhotoRow>(
      'Photos',
      {
        id: newId(),
        ticket_id: ticketId,
        type: input.type,
        storage: input.storage ?? 'google_drive',
        file_ref: input.fileRef,
        taken_by: input.takenBy,
        taken_at: this.iso(),
        deleted_at: null,
      },
      input.takenBy,
      'photo.add',
    );
  }

  // ---------------------------------------------------------------- retrieval and dispatch

  /** Guest or staff request (FR-OUT-01, FR-OUT-03), optionally timed to the guest's arrival (FR-OUT-02, FR-OUT-15). */
  requestRetrieval(ticketId: string, input: RetrievalInput): { ticket: TicketRow; task: TaskRow } {
    const ticket = this.find<TicketRow>('Tickets', ticketId);
    const s = this.getSettings(ticket.location_id, ticket.settings_version);
    const now = this.now();
    const arriveAt = this.arrivalTime(s, now, input);
    const releaseAt = arriveAt ? new Date(Math.max(now.getTime(), arriveAt.getTime() - s.avgRetrievalMinutes * 60_000)) : now;
    const feeEnd = (arriveAt ?? now).toISOString();
    const updated = this.setStatus(ticket, 'retrieval_requested', input.requestedBy, 'ticket.request_retrieval', {
      requested_at: now.toISOString(),
      scheduled_for: arriveAt?.toISOString() ?? null,
      pickup_point: input.pickupPoint ?? ticket.pickup_point,
      fee_amount: this.calculateFee(ticket, feeEnd),
    });
    const task = this.createTask(updated, 'retrieve', input.requestedBy, { release_at: releaseAt.toISOString() });
    return { ticket: updated, task };
  }

  private arrivalTime(s: LocationSettings, now: Date, input: { arriveInMinutes?: number; arriveAt?: string }): Date | undefined {
    if (input.arriveInMinutes === undefined && input.arriveAt === undefined) return undefined;
    if (!s.arrivalTimeRequest) throw new ValetError('INVALID_INPUT', 'Arrival-time requests are switched off for this location');
    const at = input.arriveAt !== undefined ? new Date(input.arriveAt) : new Date(now.getTime() + (input.arriveInMinutes ?? 0) * 60_000);
    if (Number.isNaN(at.getTime()) || at.getTime() < now.getTime()) throw new ValetError('INVALID_INPUT', 'Arrival time must be in the future');
    if (at.getTime() - now.getTime() > s.maxScheduleHoursAhead * 3_600_000) {
      throw new ValetError('INVALID_INPUT', `Arrival time can be at most ${s.maxScheduleHoursAhead} hours ahead`);
    }
    return at;
  }

  /** Guest changes the arrival time, or taps "I'm here" (arrivedNow). */
  updateArrival(ticketId: string, input: { arriveInMinutes?: number; arrivedNow?: boolean; by: string }): TaskRow {
    const ticket = this.find<TicketRow>('Tickets', ticketId);
    const task = this.pendingRetrieveTask(ticketId);
    if (!task) throw new ValetError('INVALID_STATE', 'There is no pending retrieval request to change');
    const s = this.getSettings(ticket.location_id, ticket.settings_version);
    const now = this.now();
    const arriveAt = input.arrivedNow ? now : this.arrivalTime(s, now, { arriveInMinutes: input.arriveInMinutes ?? 0 }) ?? now;
    const releaseAt = new Date(Math.max(now.getTime(), arriveAt.getTime() - s.avgRetrievalMinutes * 60_000));
    this.patch<TicketRow>('Tickets', ticketId, { scheduled_for: arriveAt.toISOString(), fee_amount: this.calculateFee(ticket, arriveAt.toISOString()) }, input.by, 'ticket.update_arrival');
    return this.patch<TaskRow>('Tasks', task.id, { release_at: releaseAt.toISOString() }, input.by, 'task.update_release');
  }

  private pendingRetrieveTask(ticketId: string): TaskRow | undefined {
    return this.all<TaskRow>('Tasks').find((t) => t.ticket_id === ticketId && t.type === 'retrieve' && t.status === 'pending');
  }

  /** Guest cancels before an attendant accepts (FR-OUT-08). The fee clock keeps running. */
  cancelRetrieval(ticketId: string, by: string): TicketRow {
    const ticket = this.find<TicketRow>('Tickets', ticketId);
    const task = this.pendingRetrieveTask(ticketId);
    if (ticket.status !== 'retrieval_requested' || !task) {
      throw new ValetError('INVALID_STATE', 'The request can only be cancelled before an attendant accepts it');
    }
    this.patch<TaskRow>('Tasks', task.id, { status: 'cancelled', completed_at: this.iso() }, by, 'task.cancel');
    return this.setStatus(ticket, 'parked', by, 'ticket.cancel_retrieval', { requested_at: null, scheduled_for: null });
  }

  /** Retrieval tasks released to the queue, highest priority then earliest first (FR-TASK-01). */
  listQueue(locationId: string): TaskRow[] {
    const now = this.now().getTime();
    return this.all<TaskRow>('Tasks')
      .filter((t) => t.location_id === locationId && t.type === 'retrieve' && t.status === 'pending' && Date.parse(t.release_at) <= now)
      .sort((a, b) => b.priority - a.priority || Date.parse(a.release_at) - Date.parse(b.release_at));
  }

  setTaskPriority(taskId: string, priority: number, supervisorId: string): TaskRow {
    return this.patch<TaskRow>('Tasks', taskId, { priority }, supervisorId, 'task.prioritise');
  }

  /** One task is held by only one attendant (FR-TASK-02). */
  async acceptTask(taskId: string, attendantId: string): Promise<TaskRow> {
    return this.mutex.run(`task:${taskId}`, () => {
      const task = this.find<TaskRow>('Tasks', taskId);
      if (task.status !== 'pending') throw new ValetError('TASK_TAKEN', 'This task has already been taken');
      if (Date.parse(task.release_at) > this.now().getTime()) throw new ValetError('INVALID_STATE', 'This task is not released yet');
      const accepted = this.patch<TaskRow>('Tasks', taskId, { status: 'accepted', assigned_to: attendantId, accepted_at: this.iso() }, attendantId, 'task.accept');
      if (task.type === 'retrieve') {
        this.setStatus(this.find<TicketRow>('Tickets', task.ticket_id), 'assigned_in_transit', attendantId, 'ticket.assign');
      }
      return accepted;
    });
  }

  markReady(ticketId: string, attendantId: string): TicketRow {
    const ticket = this.find<TicketRow>('Tickets', ticketId);
    return this.setStatus(ticket, 'ready_for_pickup', attendantId, 'ticket.ready', { ready_at: this.iso() });
  }

  /** Guest did not arrive; supervisor sends the car back to a slot (FR-OUT-09). */
  reparkNoShow(ticketId: string, supervisorId: string): TicketRow {
    const ticket = this.find<TicketRow>('Tickets', ticketId);
    const task = this.all<TaskRow>('Tasks').find((t) => t.ticket_id === ticketId && t.type === 'retrieve' && t.status === 'accepted');
    if (task) this.patch<TaskRow>('Tasks', task.id, { status: 'cancelled', completed_at: this.iso() }, supervisorId, 'task.cancel_no_show');
    return this.setStatus(ticket, 'parked', supervisorId, 'ticket.repark_no_show', { ready_at: null, requested_at: null, scheduled_for: null });
  }

  /** Checks the ticket QR or, failing that, the handover PIN (FR-OUT-06). */
  verifyGuest(ticketId: string, proof: { qrToken?: string; pin?: string }): boolean {
    const ticket = this.find<TicketRow>('Tickets', ticketId);
    if (proof.qrToken !== undefined) return safeEqual(proof.qrToken, ticket.qr_token);
    if (proof.pin !== undefined) return verifyPin(this.options.pinSecret, ticket.id, proof.pin, ticket.handover_pin_hash);
    return false;
  }

  // ---------------------------------------------------------------- payments

  /** Fee from check-in to the given end time using the ticket's tariff (FR-PAY-02). */
  calculateFee(ticket: TicketRow, endIso: string): number {
    const s = this.getSettings(ticket.location_id, ticket.settings_version);
    const excluded = ticket.is_in_and_out && s.pauseFeeWhileOut ? this.outPeriods(ticket.id, endIso) : [];
    return feeForMinutes(s.tariff, chargeableMinutes(ticket.checked_in_at, endIso, excluded));
  }

  private outPeriods(ticketId: string, endIso: string): Array<{ from: string; to: string }> {
    const moves = this.all<TicketMovementRow>('TicketMovements')
      .filter((m) => m.ticket_id === ticketId)
      .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
    const periods: Array<{ from: string; to: string }> = [];
    let outAt: string | undefined;
    for (const m of moves) {
      if (m.type === 'out') outAt = m.occurred_at;
      else if (outAt) {
        periods.push({ from: outAt, to: m.occurred_at });
        outAt = undefined;
      }
    }
    if (outAt) periods.push({ from: outAt, to: endIso });
    return periods;
  }

  /** Fee minus verified payments; pending QR payments do not count (FR-PAY-16). */
  balanceDue(ticketId: string): number {
    const ticket = this.find<TicketRow>('Tickets', ticketId);
    const paid = this.all<PaymentRow>('Payments')
      .filter((p) => p.ticket_id === ticketId && p.status === 'verified')
      .reduce((sum, p) => sum + p.amount, 0);
    return Math.max(0, ticket.fee_amount - paid);
  }

  /** Records a QR, cash, card-terminal or zero payment (FR-PAY-03, FR-PAY-04, FR-PAY-12). */
  recordPayment(
    ticketId: string,
    input: { method: PaymentMethod; amount: number; tip?: number; transactionReference?: string; zeroFeeReason?: string; recordedBy: string },
  ): PaymentRow {
    const ticket = this.find<TicketRow>('Tickets', ticketId);
    const s = this.getSettings(ticket.location_id, ticket.settings_version);
    if (input.amount < 0) throw new ValetError('INVALID_INPUT', 'Amount cannot be negative');
    if (input.method === 'none') {
      if (input.amount !== 0 || !input.zeroFeeReason) throw new ValetError('INVALID_INPUT', 'A zero payment needs amount 0 and a reason (FR-PAY-12)');
    } else if (!s.paymentMethods.includes(input.method)) {
      throw new ValetError('INVALID_INPUT', `${input.method} is not accepted at this location`);
    }
    const isQr = input.method === 'payment_qr';
    return this.insert<PaymentRow>(
      'Payments',
      {
        id: newId(),
        ticket_id: ticketId,
        amount: input.amount,
        tip: input.tip ?? null,
        method: input.method,
        transaction_reference: input.transactionReference ?? null,
        status: isQr ? 'pending' : 'verified',
        zero_fee_reason: input.zeroFeeReason ?? null,
        recorded_by: input.recordedBy,
        verified_by: isQr ? null : input.recordedBy,
        created_at: this.iso(),
        verified_at: isQr ? null : this.iso(),
      },
      input.recordedBy,
      'payment.record',
    );
  }

  /** Staff confirm a QR payment against the operator's own account (FR-PAY-16). */
  verifyPayment(paymentId: string, decision: 'verified' | 'rejected', userId: string): PaymentRow {
    const payment = this.find<PaymentRow>('Payments', paymentId);
    if (payment.status !== 'pending') throw new ValetError('INVALID_STATE', 'Only pending payments can be verified');
    return this.patch<PaymentRow>('Payments', paymentId, { status: decision, verified_by: userId, verified_at: this.iso() }, userId, `payment.${decision}`);
  }

  pendingPayments(locationId: string): PaymentRow[] {
    const tickets = new Set(this.all<TicketRow>('Tickets').filter((t) => t.location_id === locationId).map((t) => t.id));
    return this.all<PaymentRow>('Payments').filter((p) => p.status === 'pending' && tickets.has(p.ticket_id));
  }

  // ---------------------------------------------------------------- handover, in-and-out, incidents

  /** The guest's confirmation for the current handover (made after the car became ready), if any. */
  currentConfirmation(ticketId: string): HandoverConfirmationRow | undefined {
    const ticket = this.find<TicketRow>('Tickets', ticketId);
    if (!ticket.ready_at) return undefined;
    const since = Date.parse(ticket.ready_at);
    return this.all<HandoverConfirmationRow>('HandoverConfirmations')
      .filter((c) => c.ticket_id === ticketId && Date.parse(c.confirmed_at) >= since)
      .at(-1);
  }

  /**
   * Records the guest's no-damage confirmation or damage report while the car is at the pickup point,
   * from the ticket page or a signature on the attendant's device (FR-OUT-13, FR-OUT-14).
   */
  confirmHandover(
    ticketId: string,
    input: { result: HandoverResult; method: HandoverMethod; signatureRef?: string; damageDescription?: string; by: string },
  ): HandoverConfirmationRow {
    const ticket = this.find<TicketRow>('Tickets', ticketId);
    if (ticket.status !== 'ready_for_pickup') throw new ValetError('INVALID_STATE', 'The car is not at the pickup point');
    if (this.currentConfirmation(ticketId)) throw new ValetError('INVALID_STATE', 'This handover has already been confirmed');
    const row = this.insert<HandoverConfirmationRow>(
      'HandoverConfirmations',
      { id: newId(), ticket_id: ticketId, result: input.result, method: input.method, signature_ref: input.signatureRef ?? null, confirmed_at: this.iso() },
      input.by,
      'handover.confirm',
    );
    if (input.result === 'damage_reported') {
      this.reportIncident(ticketId, { type: 'damage', description: input.damageDescription ?? 'Reported at handover', reportedBy: input.by });
    }
    return row;
  }

  /** Hands the car over (FR-OUT-13, FR-OUT-14, FR-PAY-14, FR-OUT-16). */
  handover(ticketId: string, input: HandoverInput): TicketRow {
    const ticket = this.find<TicketRow>('Tickets', ticketId);
    if (ticket.status !== 'ready_for_pickup') throw new ValetError('INVALID_STATE', 'The car must be ready for pickup before handover');
    const s = this.getSettings(ticket.location_id, ticket.settings_version);
    const by = input.attendantId;
    const goingOut = ticket.is_in_and_out && !input.endOfStay;

    if (s.handoverConfirmation && !input.confirmation && !this.currentConfirmation(ticketId)) {
      throw new ValetError('CONFIRMATION_REQUIRED', 'The guest must confirm the handover or report damage (FR-OUT-13)');
    }
    const due = this.balanceDue(ticketId);
    if (!goingOut && due > 0 && s.paymentRequiredBeforeHandover && !input.supervisorApprovalBy) {
      throw new ValetError('BALANCE_DUE', `A balance of ${due} is due; collect it or get supervisor approval (FR-PAY-14)`);
    }
    if (!goingOut && due > 0 && input.supervisorApprovalBy) {
      this.audit(input.supervisorApprovalBy, 'payment.release_with_balance', 'Tickets', ticketId, null, { balance_due: due });
    }

    if (input.confirmation && !this.currentConfirmation(ticketId)) {
      this.confirmHandover(ticketId, { ...input.confirmation, by: input.confirmation.method === 'ticket_page' ? 'guest' : by });
    }

    const task = this.all<TaskRow>('Tasks').find((t) => t.ticket_id === ticketId && t.type === 'retrieve' && t.status === 'accepted');
    if (task) this.patch<TaskRow>('Tasks', task.id, { status: 'completed', completed_at: this.iso() }, by, 'task.complete_retrieve');

    if (goingOut) {
      this.insert<TicketMovementRow>(
        'TicketMovements',
        { id: newId(), ticket_id: ticketId, type: 'out', attendant_id: by, spot_text: ticket.spot_text, occurred_at: this.iso() },
        by,
        'ticket.out',
      );
      return this.setStatus(ticket, 'out', by, 'ticket.out', { zone_code: null, slot_number: null, requested_at: null, scheduled_for: null, ready_at: null });
    }
    return this.setStatus(ticket, 'closed', by, 'ticket.close', { closed_at: this.iso() });
  }

  /** In-and-out guest brings the car back; record the new spot with recordParkingSpot (FR-OUT-17). */
  returnFromOut(ticketId: string, attendantId: string): { ticket: TicketRow; parkTask: TaskRow } {
    const ticket = this.find<TicketRow>('Tickets', ticketId);
    this.insert<TicketMovementRow>(
      'TicketMovements',
      { id: newId(), ticket_id: ticketId, type: 'return', attendant_id: attendantId, spot_text: null, occurred_at: this.iso() },
      attendantId,
      'ticket.return',
    );
    const updated = this.setStatus(ticket, 'checked_in', attendantId, 'ticket.return', {
      spot_text: null,
      spot_gps_lat: null,
      spot_gps_lng: null,
      spot_gps_accuracy: null,
    });
    const parkTask = this.createTask(updated, 'park', attendantId, { status: 'accepted', assigned_to: attendantId, accepted_at: this.iso() });
    return { ticket: updated, parkTask };
  }

  /** Ends an in-and-out stay while the car is out (FR-OUT-17). */
  endStay(ticketId: string, userId: string): TicketRow {
    const ticket = this.find<TicketRow>('Tickets', ticketId);
    if (ticket.status !== 'out') throw new ValetError('INVALID_STATE', 'Only a ticket whose car is out can end its stay here');
    const now = this.iso();
    return this.setStatus(ticket, 'closed', userId, 'ticket.end_stay', { closed_at: now, fee_amount: this.calculateFee(ticket, now) });
  }

  cancelTicket(ticketId: string, userId: string): TicketRow {
    const ticket = this.find<TicketRow>('Tickets', ticketId);
    return this.setStatus(ticket, 'cancelled', userId, 'ticket.cancel', { closed_at: this.iso() });
  }

  markAbandoned(ticketId: string, managerId: string): TicketRow {
    const ticket = this.find<TicketRow>('Tickets', ticketId);
    return this.setStatus(ticket, 'abandoned', managerId, 'ticket.abandon', { closed_at: this.iso(), zone_code: null, slot_number: null });
  }

  reportIncident(ticketId: string, input: { type: IncidentType; description?: string; reportedBy: string }): IncidentRow {
    this.find<TicketRow>('Tickets', ticketId);
    return this.insert<IncidentRow>(
      'Incidents',
      { id: newId(), ticket_id: ticketId, type: input.type, description: input.description ?? null, status: 'open', reported_by: input.reportedBy, created_at: this.iso(), resolved_at: null },
      input.reportedBy,
      'incident.report',
    );
  }

  rateTicket(ticketId: string, rating: number, comment?: string): TicketRow {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ValetError('INVALID_INPUT', 'Rating must be 1 to 5');
    return this.patch<TicketRow>('Tickets', ticketId, { rating, rating_comment: comment ?? null }, 'guest', 'ticket.rate');
  }

  // ---------------------------------------------------------------- reads

  /** Ticket with vehicle and guest; the mobile number is masked unless allowed (NFR-PRIV-01). */
  getTicketDetails(ticketId: string, options: { showFullMobile?: boolean } = {}): TicketDetails {
    const ticket = this.find<TicketRow>('Tickets', ticketId);
    const vehicle = this.table<VehicleRow>('Vehicles').get(ticket.vehicle_id);
    const customer = ticket.customer_id ? this.table<CustomerRow>('Customers').get(ticket.customer_id) : undefined;
    return {
      ticket,
      vehicle,
      customer: customer && { ...customer, mobile: options.showFullMobile ? customer.mobile : maskMobile(customer.mobile) },
      balanceDue: this.balanceDue(ticketId),
    };
  }

  findTicketByQr(qrToken: string): TicketRow | undefined {
    return this.all<TicketRow>('Tickets').find((t) => safeEqual(t.qr_token, qrToken));
  }

  /** Search by ticket number, plate or mobile number (FR-ADM-06). */
  searchTickets(locationId: string, query: string): TicketRow[] {
    const q = query.trim().toUpperCase();
    const plate = normalizePlate(query);
    const digits = query.replace(/\D/g, '');
    const vehicles = new Set(this.all<VehicleRow>('Vehicles').filter((v) => plate && v.plate_number.includes(plate)).map((v) => v.id));
    const customers = new Set(
      this.all<CustomerRow>('Customers')
        .filter((c) => digits.length >= 4 && (c.mobile ?? '').replace(/\D/g, '').includes(digits))
        .map((c) => c.id),
    );
    return this.all<TicketRow>('Tickets').filter(
      (t) =>
        t.location_id === locationId &&
        (t.ticket_number.toUpperCase() === q || vehicles.has(t.vehicle_id) || (t.customer_id !== null && customers.has(t.customer_id))),
    );
  }

  /** Live counts for the dashboard (FR-ADM-02). */
  dashboard(locationId: string): { byStatus: Partial<Record<TicketStatus, number>>; carsParked: number; openRequests: number; pendingPayments: number } {
    const byStatus: Partial<Record<TicketStatus, number>> = {};
    for (const t of this.all<TicketRow>('Tickets')) {
      if (t.location_id === locationId) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    }
    return {
      byStatus,
      carsParked: IN_SLOT.reduce((n, s) => n + (byStatus[s] ?? 0), 0),
      openRequests: (byStatus.retrieval_requested ?? 0) + (byStatus.assigned_in_transit ?? 0),
      pendingPayments: this.pendingPayments(locationId).length,
    };
  }

  // ---------------------------------------------------------------- bulk export / import (Excel)

  /** Every cached row by tab name, e.g. for an Excel export. */
  exportRows(): Record<string, Row[]> {
    const out: Record<string, Row[]> = {};
    for (const t of TABS) out[t.name] = this.all(t.name).map((r) => structuredClone(r));
    return out;
  }

  /** Adds rows from an import; rows whose id already exists are skipped. Returns the number added per tab. */
  importRows(rowsByTab: Record<string, Row[]>, importedBy: string): Record<string, number> {
    const added: Record<string, number> = {};
    for (const t of TABS) {
      const rows = rowsByTab[t.name] ?? [];
      const fresh = rows.filter((r) => !this.table(t.name).has(String(r.id)));
      for (const r of fresh) this.assertValid(t, r);
      for (const r of fresh) this.table(t.name).set(String(r.id), r);
      if (fresh.length > 0) this.queue.enqueue({ kind: 'append', tab: t, rows: fresh });
      added[t.name] = fresh.length;
    }
    this.audit(importedBy, 'data.import', 'All', 'import', null, added);
    return added;
  }
}
