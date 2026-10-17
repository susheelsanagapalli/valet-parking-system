/**
 * The Valet API as plain route definitions, independent of Express and Node.js. The server mounts
 * them on Express (app.ts); the GitHub Pages demo runs the same routes inside the browser.
 */
import { z } from 'zod';
import {
  SERVICE_PROFILES,
  TICKET_STATUSES,
  ValetError,
  type LocationSettings,
  type PhotoStorage,
  type TicketRow,
  type TicketStatus,
  type ValetSheetsRepository,
} from '@valet/sheets-integration';
import { can, canAccessLocation, toPublicUser, type Permission, type StaffUser, type UserAuth } from './permissions.js';
import { SMS_TEXT, normalizeMobile, type Notifier, type SmsDraft, type SmsKind } from './sms.js';
import {
  ANDROID_GATEWAY_DOCS,
  ANDROID_GATEWAY_DOWNLOAD,
  ANDROID_GATEWAY_RELEASES,
  SMSGATE_CLOUD_URL,
  senderFor,
  toPublic,
  type SmsSettingsMemory,
} from './smsOptions.js';
import { guestTicket, staffTicket } from './views.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A handler result with a status other than 200. */
export class ApiResponse {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}

export interface ApiContext {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  /** Signed-in staff member; always set for staff routes. */
  user?: StaffUser;
}

export interface ApiRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Path after /api, with :params. */
  path: string;
  access: 'public' | 'staff';
  permission?: Permission;
  handler: (ctx: ApiContext) => unknown;
}

export interface ApiDeps {
  repo: ValetSheetsRepository;
  users: UserAuth;
  publicBaseUrl: string;
  now?: () => Date;
  commit?: string;
  /** Link for showing a stored photo in an <img>. */
  photoUrl: (ref: string) => string;
  /** Stores an uploaded photo (data URL) and returns its reference. */
  saveUpload: (dataUrl: string) => Promise<{ fileRef: string; storage: PhotoStorage }>;
  photoStorage: () => PhotoStorage;
  /** Demo mode only: shared demo password and the PIN of each ticket checked in since start-up. */
  demo?: { password: string; pins: Map<string, string>; notice?: string };
  notifier?: Notifier;
  smsSettings?: SmsSettingsMemory;
}

const HTTP_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  INVALID_SETTINGS: 400,
  INVALID_STATE: 409,
  SLOT_OCCUPIED: 409,
  TASK_TAKEN: 409,
  BALANCE_DUE: 409,
  CONFIRMATION_REQUIRED: 409,
  VERIFICATION_FAILED: 403,
  SCHEMA_MISMATCH: 500,
};

/** Status and body for an error thrown by a handler. */
export function errorResponse(err: unknown): { status: number; body: { error: string; code?: string } } {
  if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
  if (err instanceof ValetError) return { status: HTTP_STATUS[err.code] ?? 400, body: { error: err.message, code: err.code } };
  return { status: 500, body: { error: 'Something went wrong' } };
}

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw new HttpError(400, result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  return result.data;
}

const requirement = z.enum(['off', 'optional', 'required']);
const settingsPatch = z
  .object({
    pickupPoints: z.array(z.string().min(1)).min(1),
    spotText: requirement,
    spotTextLabel: z.string().min(1).max(40),
    spotGps: requirement,
    gpsMinAccuracyM: z.number().positive(),
    spotPhoto: requirement,
    zoneSlotList: z.boolean(),
    vehiclePhotos: requirement,
    vehiclePhotoCount: z.number().int().min(1).max(8),
    handoverConfirmation: z.boolean(),
    paymentMethods: z.array(z.enum(['payment_qr', 'cash', 'card_terminal'])),
    paymentRequiredBeforeHandover: z.boolean(),
    arrivalTimeRequest: z.boolean(),
    arrivalOptionsMinutes: z.array(z.number().int().positive()).max(6),
    maxScheduleHoursAhead: z.number().positive().max(72),
    avgRetrievalMinutes: z.number().min(0).max(120),
    inAndOut: z.boolean(),
    pauseFeeWhileOut: z.boolean(),
    stayEndDateRequired: z.boolean(),
    guestLinkExpiryDays: z.number().int().min(1).max(90),
    tariff: z.object({
      type: z.enum(['complimentary', 'flat', 'hourly']),
      rate: z.number().min(0),
      freeMinutes: z.number().min(0),
      dailyCap: z.number().positive().optional(),
    }),
  })
  .partial()
  .strict();

const gps = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracyM: z.number().min(0) });
const confirmation = z.object({
  result: z.enum(['no_damage', 'damage_reported']),
  method: z.enum(['ticket_page', 'signature']),
  signatureRef: z.string().optional(),
  damageDescription: z.string().max(500).optional(),
});
const OPEN: TicketStatus[] = ['checked_in', 'parked', 'retrieval_requested', 'assigned_in_transit', 'ready_for_pickup', 'out'];

export function apiRoutes(deps: ApiDeps): ApiRoute[] {
  const { repo, users } = deps;
  const now = deps.now ?? (() => new Date());
  const routes: ApiRoute[] = [];
  const add = (method: ApiRoute['method'], path: string, access: ApiRoute['access'], permission: Permission | undefined, handler: ApiRoute['handler']) =>
    routes.push({ method, path, access, permission, handler });
  const pub = (method: ApiRoute['method'], path: string, handler: ApiRoute['handler']) => add(method, path, 'public', undefined, handler);
  const staff = (method: ApiRoute['method'], path: string, permission: Permission | undefined, handler: ApiRoute['handler']) =>
    add(method, path, 'staff', permission, handler);

  const user = (ctx: ApiContext): StaffUser => {
    if (!ctx.user) throw new HttpError(401, 'Sign in required');
    return ctx.user;
  };
  const locationFor = (ctx: ApiContext, locationId: string): string => {
    repo.getLocation(locationId);
    if (!canAccessLocation(user(ctx), locationId)) throw new HttpError(403, 'You do not work at this location');
    return locationId;
  };
  const ticketFor = (ctx: ApiContext): TicketRow => {
    const ticket = repo.getTicketDetails(String(ctx.params.ticketId)).ticket;
    locationFor(ctx, ticket.location_id);
    return ticket;
  };
  const view = (ctx: ApiContext, ticket: TicketRow) => staffTicket(repo, repo.getTicketDetails(ticket.id).ticket, user(ctx), deps.photoUrl, now());
  const guestLink = (t: TicketRow) => `${deps.publicBaseUrl}/t/${t.qr_token}`;

  /**
   * Sends (or, for tap-to-send, prepares) a guest SMS for a ticket. Returns a draft for the staff
   * member's Messages app in tap-to-send mode, null otherwise; `sent` is false when there is no
   * notifier or no valid mobile.
   */
  const sms = (
    kind: SmsKind,
    ticket: TicketRow,
    text: (p: { app: string; plate: string; ticket: string; link: string; location: string }) => string,
  ): { sent: boolean; draft: SmsDraft | null } => {
    if (!deps.notifier) return { sent: false, draft: null };
    const details = repo.getTicketDetails(ticket.id, { showFullMobile: true });
    const location = repo.getLocation(ticket.location_id);
    const p = { app: location.app_name, plate: details.vehicle?.plate_number ?? '', ticket: ticket.ticket_number, link: guestLink(ticket), location: location.name };
    const entry = deps.notifier.send(kind, ticket.ticket_number, details.customer?.mobile, text(p));
    return { sent: entry !== null, draft: entry && deps.notifier.sender.manual ? { id: entry.id, to: entry.to, text: entry.text } : null };
  };

  // ------------------------------------------------------------------ public

  pub('GET', '/health', () => ({ ok: true, commit: deps.commit ?? null, pendingWrites: repo.queue.pending }));

  pub('POST', '/auth/login', (ctx) => {
    const body = parse(z.object({ username: z.string().min(1), password: z.string().min(1) }), ctx.body);
    const result = users.login(body.username, body.password);
    if ('error' in result) {
      return new ApiResponse(result.error === 'locked' ? 423 : 401, {
        error: result.error === 'locked' ? 'Too many failed attempts. Try again in 15 minutes.' : 'Wrong username or password',
      });
    }
    return { token: result.token, user: toPublicUser(result.user) };
  });

  if (deps.demo) {
    const demo = deps.demo;
    pub('GET', '/demo/credentials', () => {
      const guestTickets = repo
        .listLocations()
        .flatMap((l) => repo.listTickets(l.id, OPEN).map((t) => ({ t, location: l.name })))
        .sort((a, b) => Date.parse(b.t.checked_in_at) - Date.parse(a.t.checked_in_at))
        .slice(0, 20)
        .map(({ t, location }) => ({ ticketNumber: t.ticket_number, location, status: t.status, guestLink: guestLink(t), pin: demo.pins.get(t.id) ?? null }));
      return {
        notice: demo.notice ?? 'Test environment only. These credentials are removed at go-live (NODE_ENV=production).',
        password: demo.password,
        users: users.list().map((u) => ({ username: u.username, name: u.name, role: u.role })),
        guestTickets,
        smsProvider: deps.notifier?.sender.name ?? 'off',
        sms: deps.notifier?.recent().slice(0, 15) ?? [],
      };
    });
  }

  // Guest ticket page, by the unguessable QR token (NFR-SEC-02).
  const guestTicketRow = (ctx: ApiContext): TicketRow => {
    const ticket = repo.findTicketByQr(String(ctx.params.token));
    if (!ticket) throw new HttpError(404, 'Ticket not found');
    if (ticket.closed_at) {
      const days = repo.getSettings(ticket.location_id, ticket.settings_version).guestLinkExpiryDays;
      if (Date.parse(ticket.closed_at) + days * 86_400_000 < now().getTime()) throw new HttpError(410, 'This ticket link has expired');
    }
    return ticket;
  };
  const guestView = (t: TicketRow) => guestTicket(repo, repo.getTicketDetails(t.id).ticket, now());

  pub('GET', '/guest/:token', (ctx) => guestView(guestTicketRow(ctx)));
  pub('POST', '/guest/:token/request', (ctx) => {
    const t = guestTicketRow(ctx);
    const body = parse(z.object({ pickupPoint: z.string().optional(), arriveInMinutes: z.number().int().min(1).max(1440).optional() }), ctx.body);
    repo.requestRetrieval(t.id, { requestedBy: 'guest', ...body });
    return guestView(t);
  });
  pub('POST', '/guest/:token/arrival', (ctx) => {
    const t = guestTicketRow(ctx);
    const body = parse(z.object({ arriveInMinutes: z.number().int().min(1).max(1440).optional(), arrivedNow: z.boolean().optional() }), ctx.body);
    repo.updateArrival(t.id, { ...body, by: 'guest' });
    return guestView(t);
  });
  pub('POST', '/guest/:token/cancel', (ctx) => {
    const t = guestTicketRow(ctx);
    repo.cancelRetrieval(t.id, 'guest');
    return guestView(t);
  });
  pub('POST', '/guest/:token/payment', (ctx) => {
    const t = guestTicketRow(ctx);
    const body = parse(z.object({ transactionReference: z.string().min(4).max(40), tip: z.number().min(0).optional() }), ctx.body);
    const due = repo.balanceDue(t.id);
    if (due <= 0) throw new HttpError(409, 'Nothing is due');
    repo.recordPayment(t.id, { method: 'payment_qr', amount: due, tip: body.tip, transactionReference: body.transactionReference, recordedBy: 'guest' });
    return guestView(t);
  });
  pub('POST', '/guest/:token/confirm', (ctx) => {
    const t = guestTicketRow(ctx);
    const body = parse(z.object({ result: z.enum(['no_damage', 'damage_reported']), damageDescription: z.string().max(500).optional() }), ctx.body);
    repo.confirmHandover(t.id, { ...body, method: 'ticket_page', by: 'guest' });
    return guestView(t);
  });
  pub('POST', '/guest/:token/incident', (ctx) => {
    const t = guestTicketRow(ctx);
    const body = parse(z.object({ type: z.enum(['damage', 'lost_item', 'delay', 'other']), description: z.string().min(3).max(1000) }), ctx.body);
    repo.reportIncident(t.id, { ...body, reportedBy: 'guest' });
    return { ok: true };
  });
  pub('POST', '/guest/:token/rating', (ctx) => {
    const t = guestTicketRow(ctx);
    const body = parse(z.object({ rating: z.number().int().min(1).max(5), comment: z.string().max(500).optional() }), ctx.body);
    repo.rateTicket(t.id, body.rating, body.comment);
    return guestView(t);
  });

  // ------------------------------------------------------------------ staff

  staff('GET', '/me', undefined, (ctx) => toPublicUser(user(ctx)));
  staff('GET', '/locations', undefined, (ctx) => repo.listLocations().filter((l) => canAccessLocation(user(ctx), l.id)));

  staff('POST', '/locations', 'locations.manage', (ctx) => {
    const body = parse(
      z.object({
        name: z.string().min(2).max(80),
        address: z.string().max(200).optional(),
        serviceProfile: z.enum(SERVICE_PROFILES),
        appName: z.string().min(2).max(40),
        ticketPrefix: z.string().regex(/^[A-Z]{1,4}$/).optional(),
        timezone: z.string().optional(),
      }),
      ctx.body,
    );
    return repo.createLocation({ ...body, createdBy: user(ctx).id });
  });

  staff('GET', '/locations/:locationId/settings', undefined, (ctx) => repo.getSettings(locationFor(ctx, ctx.params.locationId ?? '')));

  staff('PUT', '/locations/:locationId/settings', 'locations.settings', (ctx) => {
    const id = locationFor(ctx, ctx.params.locationId ?? '');
    const changes = parse(settingsPatch, ctx.body) as Partial<LocationSettings>;
    return repo.updateLocationSettings(id, changes, user(ctx).id);
  });

  staff('PUT', '/locations/:locationId/payment-qr', 'payment_qr.upload', (ctx) => {
    const id = locationFor(ctx, ctx.params.locationId ?? '');
    const body = parse(z.object({ imageDataUrl: z.string(), payeeName: z.string().min(2).max(80) }), ctx.body);
    return repo.updateLocationSettings(id, { paymentQr: { ...body, status: 'pending_approval', uploadedBy: user(ctx).id } }, user(ctx).id);
  });

  staff('GET', '/payment-qr/pending', 'payment_qr.approve', () =>
    repo
      .listLocations()
      .map((l) => ({ location: l, paymentQr: repo.getSettings(l.id).paymentQr }))
      .filter((x) => x.paymentQr?.status === 'pending_approval'),
  );

  staff('POST', '/locations/:locationId/payment-qr/review', 'payment_qr.approve', (ctx) => {
    const id = locationFor(ctx, ctx.params.locationId ?? '');
    const body = parse(z.object({ decision: z.enum(['approved', 'rejected']) }), ctx.body);
    const qr = repo.getSettings(id).paymentQr;
    if (!qr || qr.status !== 'pending_approval') throw new HttpError(409, 'No payment QR is waiting for review');
    return repo.updateLocationSettings(id, { paymentQr: { ...qr, status: body.decision, reviewedBy: user(ctx).id } }, user(ctx).id);
  });

  staff('GET', '/locations/:locationId/dashboard', 'tickets.view', (ctx) => repo.dashboard(locationFor(ctx, ctx.params.locationId ?? '')));

  staff('GET', '/locations/:locationId/tickets', 'tickets.view', (ctx) => {
    const id = locationFor(ctx, ctx.params.locationId ?? '');
    const q = String(ctx.query.q ?? '').trim();
    const statuses = String(ctx.query.status ?? '')
      .split(',')
      .filter((s): s is TicketStatus => (TICKET_STATUSES as readonly string[]).includes(s));
    const tickets = q ? repo.searchTickets(id, q) : repo.listTickets(id, statuses.length ? statuses : undefined);
    return tickets.slice(0, 200).map((t) => view(ctx, t));
  });

  staff('POST', '/uploads', 'tickets.check_in', async (ctx) => {
    const body = parse(z.object({ dataUrl: z.string() }), ctx.body);
    try {
      return await deps.saveUpload(body.dataUrl);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });

  staff('POST', '/locations/:locationId/tickets', 'tickets.check_in', async (ctx) => {
    const locationId = locationFor(ctx, ctx.params.locationId ?? '');
    const body = parse(
      z.object({
        plateNumber: z.string().min(2).max(15),
        keyTag: z.string().min(1).max(20),
        guestMobile: z.string().regex(/^\+?[0-9 ]{6,16}$/).optional(),
        guestName: z.string().max(80).optional(),
        make: z.string().max(40).optional(),
        model: z.string().max(40).optional(),
        colour: z.string().max(30).optional(),
        vehiclePhotoRefs: z.array(z.string()).max(8).optional(),
        stayEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        customFields: z.record(z.unknown()).optional(),
      }),
      ctx.body,
    );
    const { ticket, handoverPin } = await repo.checkIn({ ...body, locationId, attendantId: user(ctx).id, photoStorage: deps.photoStorage() });
    deps.demo?.pins.set(ticket.id, handoverPin);
    const { sent, draft } = sms('ticket_issued', ticket, (p) => SMS_TEXT.ticketIssued({ ...p, pin: handoverPin }));
    return {
      ticket: view(ctx, ticket),
      handoverPin,
      guestLink: guestLink(ticket),
      sms: !body.guestMobile ? 'no_mobile' : !deps.notifier ? 'not_configured' : !sent ? 'invalid_mobile' : draft ? 'tap_to_send' : 'sending',
      smsDraft: draft,
    };
  });

  staff('GET', '/tickets/by-qr', 'tickets.view', (ctx) => {
    // Accepts the scanned QR content: the guest page URL or just its token.
    const token = String(ctx.query.code ?? '').trim().split('/t/').pop()?.split(/[?#]/)[0] ?? '';
    const ticket = token ? repo.findTicketByQr(token) : undefined;
    if (!ticket) throw new HttpError(404, 'This QR is not a ticket from this system');
    locationFor(ctx, ticket.location_id);
    return view(ctx, ticket);
  });

  staff('GET', '/tickets/:ticketId', 'tickets.view', (ctx) => view(ctx, ticketFor(ctx)));

  staff('POST', '/tickets/:ticketId/spot', 'parking.record_spot', async (ctx) => {
    const t = ticketFor(ctx);
    const body = parse(
      z.object({ text: z.string().max(120).optional(), gps: gps.optional(), spotPhotoRef: z.string().optional(), zoneCode: z.string().max(10).optional(), slotNumber: z.string().max(10).optional() }),
      ctx.body,
    );
    const result = await repo.recordParkingSpot(t.id, { ...body, attendantId: user(ctx).id, photoStorage: deps.photoStorage() });
    return { ticket: view(ctx, result.ticket), warnings: result.warnings };
  });

  staff('POST', '/tickets/:ticketId/request', 'tickets.request_car', (ctx) => {
    const t = ticketFor(ctx);
    const body = parse(z.object({ pickupPoint: z.string().optional(), arriveInMinutes: z.number().int().min(1).max(1440).optional() }), ctx.body);
    repo.requestRetrieval(t.id, { ...body, requestedBy: user(ctx).id });
    return view(ctx, t);
  });

  staff('POST', '/tickets/:ticketId/cancel-request', 'tickets.request_car', (ctx) => view(ctx, repo.cancelRetrieval(ticketFor(ctx).id, user(ctx).id)));

  staff('GET', '/locations/:locationId/queue', 'tasks.accept', (ctx) => {
    const id = locationFor(ctx, ctx.params.locationId ?? '');
    const u = user(ctx);
    const mine = repo
      .listTickets(id, ['assigned_in_transit', 'ready_for_pickup'])
      .filter((t) => repo.tasksForTicket(t.id).some((k) => k.type === 'retrieve' && k.status === 'accepted' && k.assigned_to === u.id));
    return {
      queue: repo.listQueue(id).map((task) => ({ task, ticket: view(ctx, repo.getTicketDetails(task.ticket_id).ticket) })),
      mine: mine.map((t) => view(ctx, t)),
    };
  });

  staff('POST', '/tasks/:taskId/accept', 'tasks.accept', async (ctx) => {
    const task = repo.getTask(ctx.params.taskId ?? '');
    locationFor(ctx, task.location_id);
    return repo.acceptTask(task.id, user(ctx).id);
  });

  staff('POST', '/tasks/:taskId/priority', 'tasks.assign', (ctx) => {
    const body = parse(z.object({ priority: z.number().int().min(0).max(10) }), ctx.body);
    return repo.setTaskPriority(ctx.params.taskId ?? '', body.priority, user(ctx).id);
  });

  staff('POST', '/tickets/:ticketId/ready', 'tasks.accept', (ctx) => {
    const ticket = repo.markReady(ticketFor(ctx).id, user(ctx).id);
    const pickup = ticket.pickup_point ?? repo.getSettings(ticket.location_id).pickupPoints[0] ?? 'the pickup point';
    const { draft } = sms('car_ready', ticket, (p) => SMS_TEXT.carReady({ ...p, pickup }));
    return { ...view(ctx, ticket), smsDraft: draft };
  });

  staff('POST', '/tickets/:ticketId/verify', 'handover.hand_over', (ctx) => {
    const t = ticketFor(ctx);
    const body = parse(z.object({ qrToken: z.string().optional(), pin: z.string().regex(/^\d{4}$/).optional() }), ctx.body);
    const token = body.qrToken?.split('/t/').pop()?.split(/[?#]/)[0];
    return { verified: repo.verifyGuest(t.id, { qrToken: token, pin: body.pin }) };
  });

  staff('POST', '/tickets/:ticketId/payments', 'payments.record', (ctx) => {
    const t = ticketFor(ctx);
    const body = parse(
      z.object({
        method: z.enum(['payment_qr', 'cash', 'card_terminal', 'none']),
        amount: z.number().min(0),
        tip: z.number().min(0).optional(),
        transactionReference: z.string().max(40).optional(),
        zeroFeeReason: z.string().max(80).optional(),
      }),
      ctx.body,
    );
    repo.recordPayment(t.id, { ...body, recordedBy: user(ctx).id });
    return view(ctx, t);
  });

  staff('GET', '/locations/:locationId/payments/pending', 'payments.verify', (ctx) =>
    repo.pendingPayments(locationFor(ctx, ctx.params.locationId ?? '')).map((p) => ({ payment: p, ticket: view(ctx, repo.getTicketDetails(p.ticket_id).ticket) })),
  );

  staff('POST', '/payments/:paymentId/verify', 'payments.verify', (ctx) => {
    const body = parse(z.object({ decision: z.enum(['verified', 'rejected']) }), ctx.body);
    const payment = repo.verifyPayment(ctx.params.paymentId ?? '', body.decision, user(ctx).id);
    const draft = body.decision === 'rejected' ? sms('payment_rejected', repo.getTicketDetails(payment.ticket_id).ticket, SMS_TEXT.paymentRejected).draft : null;
    return { ...payment, smsDraft: draft };
  });

  const smsSetup = () => {
    const saved = deps.smsSettings?.get();
    return {
      settings: saved ? toPublic(saved) : null,
      activeMethod: deps.notifier?.sender.name ?? 'off',
      androidDownload: ANDROID_GATEWAY_DOWNLOAD,
      androidReleases: ANDROID_GATEWAY_RELEASES,
      androidDocs: ANDROID_GATEWAY_DOCS,
      androidCloudUrl: SMSGATE_CLOUD_URL,
    };
  };

  staff('GET', '/sms/config', 'sms.configure', () => smsSetup());

  staff('PUT', '/sms/config', 'sms.configure', (ctx) => {
    if (!deps.smsSettings || !deps.notifier) throw new HttpError(409, 'SMS is not available on this server');
    const body = parse(
      z.object({
        phoneType: z.enum(['iphone', 'android']),
        senderNumber: z.string().min(6).max(20),
        android: z.object({ url: z.string().max(200).optional(), username: z.string().max(100), password: z.string().max(200).optional() }).optional(),
      }),
      ctx.body,
    );
    try {
      const saved = deps.smsSettings.save({ ...body, android: body.android && { url: body.android.url ?? '', username: body.android.username, password: body.android.password ?? '' } });
      deps.notifier.setSender(senderFor(saved));
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    return smsSetup();
  });

  staff('POST', '/sms/test', 'sms.configure', async (ctx) => {
    const settings = deps.smsSettings?.get();
    if (!settings || !deps.notifier) throw new HttpError(409, 'Save the SMS settings first');
    const body = parse(z.object({ to: z.string().max(20).optional() }), ctx.body);
    const to = normalizeMobile(body.to || settings.senderNumber);
    if (!to) throw new HttpError(400, 'Enter a valid mobile number to send the test to');
    const text = `Valet test message: guest SMS from ${settings.senderNumber} is working.`;
    if (settings.phoneType === 'iphone') {
      const entry = deps.notifier.send('ticket_issued', 'TEST', to, text);
      return { ok: true, smsDraft: entry && { id: entry.id, to: entry.to, text: entry.text } };
    }
    try {
      await senderFor(settings).send(to, text);
      return { ok: true, sentTo: to };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  staff('POST', '/sms/:id/opened', undefined, (ctx) => {
    if (!deps.notifier?.markOpened(ctx.params.id ?? '')) throw new HttpError(404, 'Message not found');
    return { ok: true };
  });

  staff('POST', '/tickets/:ticketId/confirm', 'handover.hand_over', (ctx) => {
    const t = ticketFor(ctx);
    const body = parse(confirmation.extend({ method: z.literal('signature') }), ctx.body);
    repo.confirmHandover(t.id, { ...body, by: user(ctx).id });
    return view(ctx, t);
  });

  staff('POST', '/tickets/:ticketId/handover', 'handover.hand_over', (ctx) => {
    const t = ticketFor(ctx);
    const body = parse(z.object({ approveBalance: z.boolean().optional(), endOfStay: z.boolean().optional() }), ctx.body);
    const u = user(ctx);
    if (body.approveBalance && !can(u, 'handover.approve_balance')) throw new HttpError(403, 'Only a supervisor can release a car with a balance due');
    const ticket = repo.handover(t.id, { attendantId: u.id, supervisorApprovalBy: body.approveBalance ? u.id : undefined, endOfStay: body.endOfStay });
    let draft: SmsDraft | null = null;
    if (ticket.status === 'closed') {
      const amount = repo.paymentsForTicket(ticket.id).filter((p) => p.status === 'verified').reduce((s, p) => s + p.amount, 0);
      draft = sms('receipt', ticket, (p) => SMS_TEXT.receipt({ ...p, amount })).draft;
    }
    return { ...view(ctx, ticket), smsDraft: draft };
  });

  staff('POST', '/tickets/:ticketId/repark', 'tasks.assign', (ctx) => {
    const ticket = repo.reparkNoShow(ticketFor(ctx).id, user(ctx).id);
    const { draft } = sms('car_reparked', ticket, SMS_TEXT.carReparked);
    return { ...view(ctx, ticket), smsDraft: draft };
  });
  staff('POST', '/tickets/:ticketId/return', 'parking.record_spot', (ctx) => view(ctx, repo.returnFromOut(ticketFor(ctx).id, user(ctx).id).ticket));
  staff('POST', '/tickets/:ticketId/end-stay', 'handover.hand_over', (ctx) => view(ctx, repo.endStay(ticketFor(ctx).id, user(ctx).id)));

  staff('POST', '/tickets/:ticketId/incidents', 'incidents.report', (ctx) => {
    const t = ticketFor(ctx);
    const body = parse(z.object({ type: z.enum(['damage', 'lost_item', 'delay', 'other']), description: z.string().min(3).max(1000) }), ctx.body);
    return repo.reportIncident(t.id, { ...body, reportedBy: user(ctx).id });
  });

  return routes;
}

/** Finds the route for a method and path (after /api); used by the browser demo. */
export function matchRoute(routes: ApiRoute[], method: string, path: string): { route: ApiRoute; params: Record<string, string> } | undefined {
  const parts = path.split('/').filter(Boolean);
  for (const route of routes) {
    if (route.method !== method) continue;
    const pattern = route.path.split('/').filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    if (pattern.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decodeURIComponent(parts[i] ?? '')), true) : p === parts[i]))) {
      return { route, params };
    }
  }
  return undefined;
}

/**
 * Runs one request through the routes without a web server: authentication, permissions, handler
 * and error mapping. Used by the browser demo; the server does the same through Express.
 */
export async function handleRequest(
  routes: ApiRoute[],
  users: UserAuth,
  request: { method: string; path: string; query?: Record<string, string>; body?: unknown; token?: string | null },
): Promise<{ status: number; body: unknown }> {
  const match = matchRoute(routes, request.method, request.path);
  if (!match) return { status: 404, body: { error: 'Not found' } };
  const { route, params } = match;
  let user: StaffUser | undefined;
  if (route.access === 'staff') {
    user = request.token ? users.verify(request.token) : undefined;
    if (!user) return { status: 401, body: { error: 'Sign in required' } };
    if (route.permission && !can(user, route.permission)) return { status: 403, body: { error: `Missing permission: ${route.permission}` } };
  }
  try {
    const result = await route.handler({ params, query: request.query ?? {}, body: request.body, user });
    return result instanceof ApiResponse ? { status: result.status, body: result.body } : { status: 200, body: result ?? { ok: true } };
  } catch (err) {
    return errorResponse(err);
  }
}
