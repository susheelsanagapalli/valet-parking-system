import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  SERVICE_PROFILES,
  TICKET_STATUSES,
  ValetError,
  type LocationSettings,
  type TicketRow,
  type TicketStatus,
  type ValetSheetsRepository,
} from '@valet/sheets-integration';
import { authenticate, can, canAccessLocation, requirePermission, toPublicUser, type StaffUser, type UserDirectory } from './auth.js';
import { checkFileSignature, decodeImage, type PhotoStore } from './photos.js';
import { guestTicket, staffTicket } from './views.js';

export interface AppDeps {
  repo: ValetSheetsRepository;
  users: UserDirectory;
  photos: PhotoStore;
  authSecret: string;
  publicBaseUrl: string;
  webDist?: string;
  now?: () => Date;
  /**
   * Demo mode only: the shared demo password and the handover PIN of each ticket checked in since
   * start-up, so testers find every credential on the sign-in page. Never set in production.
   */
  demo?: { password: string; pins: Map<string, string> };
}

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;

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

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const wrap =
  (fn: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res))
      .then((body) => {
        if (!res.headersSent) res.json(body ?? { ok: true });
      })
      .catch(next);
  };

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
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

export function createApp(deps: AppDeps): express.Express {
  const { repo, users, photos } = deps;
  const now = deps.now ?? (() => new Date());
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const user = (req: Request): StaffUser => {
    if (!req.user) throw new HttpError(401, 'Sign in required');
    return req.user;
  };
  const locationFor = (req: Request, locationId: string): string => {
    repo.getLocation(locationId);
    if (!canAccessLocation(user(req), locationId)) throw new HttpError(403, 'You do not work at this location');
    return locationId;
  };
  const ticketFor = (req: Request): TicketRow => {
    const ticket = repo.getTicketDetails(String(req.params.ticketId)).ticket;
    locationFor(req, ticket.location_id);
    return ticket;
  };
  const view = (req: Request, ticket: TicketRow) => staffTicket(repo, repo.getTicketDetails(ticket.id).ticket, user(req), deps.authSecret, now());
  const guestLink = (t: TicketRow) => `${deps.publicBaseUrl}/t/${t.qr_token}`;

  // ------------------------------------------------------------------ public

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, pendingWrites: repo.queue.pending });
  });

  app.post(
    '/api/auth/login',
    wrap((req, res) => {
      const body = parse(z.object({ username: z.string().min(1), password: z.string().min(1) }), req.body);
      const result = users.login(body.username, body.password);
      if ('error' in result) {
        res.status(result.error === 'locked' ? 423 : 401).json({
          error: result.error === 'locked' ? 'Too many failed attempts. Try again in 15 minutes.' : 'Wrong username or password',
        });
        return;
      }
      return { token: result.token, user: toPublicUser(result.user) };
    }),
  );

  if (deps.demo) {
    const demo = deps.demo;
    const OPEN: TicketStatus[] = ['checked_in', 'parked', 'retrieval_requested', 'assigned_in_transit', 'ready_for_pickup', 'out'];
    app.get('/api/demo/credentials', (_req, res) => {
      const guestTickets = repo
        .listLocations()
        .flatMap((l) => repo.listTickets(l.id, OPEN).map((t) => ({ t, location: l.name })))
        .sort((a, b) => Date.parse(b.t.checked_in_at) - Date.parse(a.t.checked_in_at))
        .slice(0, 20)
        .map(({ t, location }) => ({
          ticketNumber: t.ticket_number,
          location,
          status: t.status,
          guestLink: guestLink(t),
          pin: demo.pins.get(t.id) ?? null,
        }));
      res.json({
        notice: 'Test environment only. These credentials are removed at go-live (NODE_ENV=production).',
        password: demo.password,
        users: users.list().map((u) => ({ username: u.username, name: u.name, role: u.role })),
        guestTickets,
      });
    });
  }

  app.get(
    '/api/files',
    wrap(async (req, res) => {
      const ref = String(req.query.ref ?? '');
      if (!checkFileSignature(deps.authSecret, ref, Number(req.query.exp), String(req.query.sig ?? ''))) throw new HttpError(403, 'Link expired');
      const file = await photos.read(ref);
      res.setHeader('Cache-Control', 'private, max-age=600');
      res.type(file.mime).send(file.data);
    }),
  );

  // Guest ticket page, by the unguessable QR token (NFR-SEC-02).
  const guestTicketRow = (req: Request): TicketRow => {
    const ticket = repo.findTicketByQr(String(req.params.token));
    if (!ticket) throw new HttpError(404, 'Ticket not found');
    if (ticket.closed_at) {
      const days = repo.getSettings(ticket.location_id, ticket.settings_version).guestLinkExpiryDays;
      if (Date.parse(ticket.closed_at) + days * 86_400_000 < now().getTime()) throw new HttpError(410, 'This ticket link has expired');
    }
    return ticket;
  };
  const guest = express.Router();
  guest.get('/:token', wrap((req) => guestTicket(repo, guestTicketRow(req), now())));
  guest.post(
    '/:token/request',
    wrap((req) => {
      const t = guestTicketRow(req);
      const body = parse(z.object({ pickupPoint: z.string().optional(), arriveInMinutes: z.number().int().min(1).max(1440).optional() }), req.body);
      repo.requestRetrieval(t.id, { requestedBy: 'guest', ...body });
      return guestTicket(repo, repo.getTicketDetails(t.id).ticket, now());
    }),
  );
  guest.post(
    '/:token/arrival',
    wrap((req) => {
      const t = guestTicketRow(req);
      const body = parse(z.object({ arriveInMinutes: z.number().int().min(1).max(1440).optional(), arrivedNow: z.boolean().optional() }), req.body);
      repo.updateArrival(t.id, { ...body, by: 'guest' });
      return guestTicket(repo, repo.getTicketDetails(t.id).ticket, now());
    }),
  );
  guest.post(
    '/:token/cancel',
    wrap((req) => {
      const t = guestTicketRow(req);
      repo.cancelRetrieval(t.id, 'guest');
      return guestTicket(repo, repo.getTicketDetails(t.id).ticket, now());
    }),
  );
  guest.post(
    '/:token/payment',
    wrap((req) => {
      const t = guestTicketRow(req);
      const body = parse(z.object({ transactionReference: z.string().min(4).max(40), tip: z.number().min(0).optional() }), req.body);
      const due = repo.balanceDue(t.id);
      if (due <= 0) throw new HttpError(409, 'Nothing is due');
      repo.recordPayment(t.id, { method: 'payment_qr', amount: due, tip: body.tip, transactionReference: body.transactionReference, recordedBy: 'guest' });
      return guestTicket(repo, repo.getTicketDetails(t.id).ticket, now());
    }),
  );
  guest.post(
    '/:token/confirm',
    wrap((req) => {
      const t = guestTicketRow(req);
      const body = parse(z.object({ result: z.enum(['no_damage', 'damage_reported']), damageDescription: z.string().max(500).optional() }), req.body);
      repo.confirmHandover(t.id, { ...body, method: 'ticket_page', by: 'guest' });
      return guestTicket(repo, repo.getTicketDetails(t.id).ticket, now());
    }),
  );
  guest.post(
    '/:token/incident',
    wrap((req) => {
      const t = guestTicketRow(req);
      const body = parse(z.object({ type: z.enum(['damage', 'lost_item', 'delay', 'other']), description: z.string().min(3).max(1000) }), req.body);
      repo.reportIncident(t.id, { ...body, reportedBy: 'guest' });
      return { ok: true };
    }),
  );
  guest.post(
    '/:token/rating',
    wrap((req) => {
      const t = guestTicketRow(req);
      const body = parse(z.object({ rating: z.number().int().min(1).max(5), comment: z.string().max(500).optional() }), req.body);
      repo.rateTicket(t.id, body.rating, body.comment);
      return guestTicket(repo, repo.getTicketDetails(t.id).ticket, now());
    }),
  );
  app.use('/api/guest', guest);

  // ------------------------------------------------------------------ staff

  const staff = express.Router();
  staff.use(authenticate(users));

  staff.get('/me', wrap((req) => toPublicUser(user(req))));

  staff.get(
    '/locations',
    wrap((req) => {
      const u = user(req);
      return repo.listLocations().filter((l) => canAccessLocation(u, l.id));
    }),
  );

  staff.post(
    '/locations',
    requirePermission('locations.manage'),
    wrap((req) => {
      const body = parse(
        z.object({
          name: z.string().min(2).max(80),
          address: z.string().max(200).optional(),
          serviceProfile: z.enum(SERVICE_PROFILES),
          appName: z.string().min(2).max(40),
          ticketPrefix: z.string().regex(/^[A-Z]{1,4}$/).optional(),
          timezone: z.string().optional(),
        }),
        req.body,
      );
      return repo.createLocation({ ...body, createdBy: user(req).id });
    }),
  );

  staff.get('/locations/:locationId/settings', wrap((req) => repo.getSettings(locationFor(req, String(req.params.locationId)))));

  staff.put(
    '/locations/:locationId/settings',
    requirePermission('locations.settings'),
    wrap((req) => {
      const id = locationFor(req, String(req.params.locationId));
      const changes = parse(settingsPatch, req.body) as Partial<LocationSettings>;
      return repo.updateLocationSettings(id, changes, user(req).id);
    }),
  );

  staff.put(
    '/locations/:locationId/payment-qr',
    requirePermission('payment_qr.upload'),
    wrap((req) => {
      const id = locationFor(req, String(req.params.locationId));
      const body = parse(z.object({ imageDataUrl: z.string(), payeeName: z.string().min(2).max(80) }), req.body);
      return repo.updateLocationSettings(id, { paymentQr: { ...body, status: 'pending_approval', uploadedBy: user(req).id } }, user(req).id);
    }),
  );

  staff.get(
    '/payment-qr/pending',
    requirePermission('payment_qr.approve'),
    wrap(() =>
      repo
        .listLocations()
        .map((l) => ({ location: l, paymentQr: repo.getSettings(l.id).paymentQr }))
        .filter((x) => x.paymentQr?.status === 'pending_approval'),
    ),
  );

  staff.post(
    '/locations/:locationId/payment-qr/review',
    requirePermission('payment_qr.approve'),
    wrap((req) => {
      const id = locationFor(req, String(req.params.locationId));
      const body = parse(z.object({ decision: z.enum(['approved', 'rejected']) }), req.body);
      const qr = repo.getSettings(id).paymentQr;
      if (!qr || qr.status !== 'pending_approval') throw new HttpError(409, 'No payment QR is waiting for review');
      return repo.updateLocationSettings(id, { paymentQr: { ...qr, status: body.decision, reviewedBy: user(req).id } }, user(req).id);
    }),
  );

  staff.get(
    '/locations/:locationId/dashboard',
    requirePermission('tickets.view'),
    wrap((req) => repo.dashboard(locationFor(req, String(req.params.locationId)))),
  );

  staff.get(
    '/locations/:locationId/tickets',
    requirePermission('tickets.view'),
    wrap((req) => {
      const id = locationFor(req, String(req.params.locationId));
      const q = String(req.query.q ?? '').trim();
      const statuses = String(req.query.status ?? '')
        .split(',')
        .filter((s): s is TicketStatus => (TICKET_STATUSES as readonly string[]).includes(s));
      const tickets = q ? repo.searchTickets(id, q) : repo.listTickets(id, statuses.length ? statuses : undefined);
      return tickets.slice(0, 200).map((t) => view(req, t));
    }),
  );

  staff.post(
    '/uploads',
    requirePermission('tickets.check_in'),
    wrap(async (req) => {
      const body = parse(z.object({ dataUrl: z.string() }), req.body);
      let file;
      try {
        file = decodeImage(body.dataUrl);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      return { fileRef: await photos.save(file.data, file.mime), storage: photos.kind };
    }),
  );

  staff.post(
    '/locations/:locationId/tickets',
    requirePermission('tickets.check_in'),
    wrap(async (req) => {
      const locationId = locationFor(req, String(req.params.locationId));
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
        req.body,
      );
      const { ticket, handoverPin } = await repo.checkIn({ ...body, locationId, attendantId: user(req).id, photoStorage: photos.kind });
      deps.demo?.pins.set(ticket.id, handoverPin);
      return {
        ticket: view(req, ticket),
        handoverPin,
        guestLink: guestLink(ticket),
        // SMS/WhatsApp sending (FR-NOT-01, FR-NOT-05) is not connected yet; staff share the link or print the ticket.
        sms: body.guestMobile ? 'not_configured' : 'no_mobile',
      };
    }),
  );

  staff.get('/tickets/:ticketId', requirePermission('tickets.view'), wrap((req) => view(req, ticketFor(req))));

  staff.post(
    '/tickets/:ticketId/spot',
    requirePermission('parking.record_spot'),
    wrap(async (req) => {
      const t = ticketFor(req);
      const body = parse(
        z.object({ text: z.string().max(120).optional(), gps: gps.optional(), spotPhotoRef: z.string().optional(), zoneCode: z.string().max(10).optional(), slotNumber: z.string().max(10).optional() }),
        req.body,
      );
      const result = await repo.recordParkingSpot(t.id, { ...body, attendantId: user(req).id, photoStorage: photos.kind });
      return { ticket: view(req, result.ticket), warnings: result.warnings };
    }),
  );

  staff.post(
    '/tickets/:ticketId/request',
    requirePermission('tickets.request_car'),
    wrap((req) => {
      const t = ticketFor(req);
      const body = parse(z.object({ pickupPoint: z.string().optional(), arriveInMinutes: z.number().int().min(1).max(1440).optional() }), req.body);
      repo.requestRetrieval(t.id, { ...body, requestedBy: user(req).id });
      return view(req, t);
    }),
  );

  staff.post(
    '/tickets/:ticketId/cancel-request',
    requirePermission('tickets.request_car'),
    wrap((req) => view(req, repo.cancelRetrieval(ticketFor(req).id, user(req).id))),
  );

  staff.get(
    '/locations/:locationId/queue',
    requirePermission('tasks.accept'),
    wrap((req) => {
      const id = locationFor(req, String(req.params.locationId));
      const u = user(req);
      const mine = repo
        .listTickets(id, ['assigned_in_transit', 'ready_for_pickup'])
        .filter((t) => repo.tasksForTicket(t.id).some((k) => k.type === 'retrieve' && k.status === 'accepted' && k.assigned_to === u.id));
      return {
        queue: repo.listQueue(id).map((task) => ({ task, ticket: view(req, repo.getTicketDetails(task.ticket_id).ticket) })),
        mine: mine.map((t) => view(req, t)),
      };
    }),
  );

  staff.post(
    '/tasks/:taskId/accept',
    requirePermission('tasks.accept'),
    wrap(async (req) => {
      const task = repo.getTask(String(req.params.taskId));
      locationFor(req, task.location_id);
      return repo.acceptTask(task.id, user(req).id);
    }),
  );

  staff.post(
    '/tasks/:taskId/priority',
    requirePermission('tasks.assign'),
    wrap((req) => {
      const body = parse(z.object({ priority: z.number().int().min(0).max(10) }), req.body);
      return repo.setTaskPriority(String(req.params.taskId), body.priority, user(req).id);
    }),
  );

  staff.post('/tickets/:ticketId/ready', requirePermission('tasks.accept'), wrap((req) => view(req, repo.markReady(ticketFor(req).id, user(req).id))));

  staff.post(
    '/tickets/:ticketId/verify',
    requirePermission('handover.hand_over'),
    wrap((req) => {
      const t = ticketFor(req);
      const body = parse(z.object({ qrToken: z.string().optional(), pin: z.string().regex(/^\d{4}$/).optional() }), req.body);
      const token = body.qrToken?.split('/t/').pop();
      return { verified: repo.verifyGuest(t.id, { qrToken: token, pin: body.pin }) };
    }),
  );

  staff.post(
    '/tickets/:ticketId/payments',
    requirePermission('payments.record'),
    wrap((req) => {
      const t = ticketFor(req);
      const body = parse(
        z.object({
          method: z.enum(['payment_qr', 'cash', 'card_terminal', 'none']),
          amount: z.number().min(0),
          tip: z.number().min(0).optional(),
          transactionReference: z.string().max(40).optional(),
          zeroFeeReason: z.string().max(80).optional(),
        }),
        req.body,
      );
      repo.recordPayment(t.id, { ...body, recordedBy: user(req).id });
      return view(req, t);
    }),
  );

  staff.get(
    '/locations/:locationId/payments/pending',
    requirePermission('payments.verify'),
    wrap((req) =>
      repo.pendingPayments(locationFor(req, String(req.params.locationId))).map((p) => ({
        payment: p,
        ticket: view(req, repo.getTicketDetails(p.ticket_id).ticket),
      })),
    ),
  );

  staff.post(
    '/payments/:paymentId/verify',
    requirePermission('payments.verify'),
    wrap((req) => {
      const body = parse(z.object({ decision: z.enum(['verified', 'rejected']) }), req.body);
      return repo.verifyPayment(String(req.params.paymentId), body.decision, user(req).id);
    }),
  );

  staff.post(
    '/tickets/:ticketId/confirm',
    requirePermission('handover.hand_over'),
    wrap((req) => {
      const t = ticketFor(req);
      const body = parse(confirmation.extend({ method: z.literal('signature') }), req.body);
      repo.confirmHandover(t.id, { ...body, by: user(req).id });
      return view(req, t);
    }),
  );

  staff.post(
    '/tickets/:ticketId/handover',
    requirePermission('handover.hand_over'),
    wrap((req) => {
      const t = ticketFor(req);
      const body = parse(z.object({ approveBalance: z.boolean().optional(), endOfStay: z.boolean().optional() }), req.body);
      const u = user(req);
      if (body.approveBalance && !can(u, 'handover.approve_balance')) {
        throw new HttpError(403, 'Only a supervisor can release a car with a balance due');
      }
      return view(req, repo.handover(t.id, { attendantId: u.id, supervisorApprovalBy: body.approveBalance ? u.id : undefined, endOfStay: body.endOfStay }));
    }),
  );

  staff.post('/tickets/:ticketId/repark', requirePermission('tasks.assign'), wrap((req) => view(req, repo.reparkNoShow(ticketFor(req).id, user(req).id))));
  staff.post('/tickets/:ticketId/return', requirePermission('parking.record_spot'), wrap((req) => view(req, repo.returnFromOut(ticketFor(req).id, user(req).id).ticket)));
  staff.post('/tickets/:ticketId/end-stay', requirePermission('handover.hand_over'), wrap((req) => view(req, repo.endStay(ticketFor(req).id, user(req).id))));

  staff.post(
    '/tickets/:ticketId/incidents',
    requirePermission('incidents.report'),
    wrap((req) => {
      const t = ticketFor(req);
      const body = parse(z.object({ type: z.enum(['damage', 'lost_item', 'delay', 'other']), description: z.string().min(3).max(1000) }), req.body);
      return repo.reportIncident(t.id, { ...body, reportedBy: user(req).id });
    }),
  );

  app.use('/api', staff);

  // ------------------------------------------------------------------ web app

  if (deps.webDist && existsSync(deps.webDist)) {
    const root = resolve(deps.webDist);
    app.use(express.static(root, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(root, 'index.html')));
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof ValetError) {
      res.status(HTTP_STATUS[err.code] ?? 400).json({ error: err.message, code: err.code });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}
