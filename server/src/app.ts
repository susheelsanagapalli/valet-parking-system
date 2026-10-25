import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ValetSheetsRepository } from '@valet/sheets-integration';
import { ApiResponse, HttpError, apiRoutes, errorResponse, type ApiContext } from './api.js';
import { authenticate, requirePermission } from './auth.js';
import { checkFileSignature, decodeImage, signFileUrl, type PhotoStore } from './photos.js';
import type { Notifier } from './sms.js';
import type { SmsSettingsMemory } from './smsOptions.js';
import type { StaffDirectory } from './staffDirectory.js';

export { HttpError } from './api.js';

export interface AppDeps {
  repo: ValetSheetsRepository;
  users: StaffDirectory;
  photos: PhotoStore;
  authSecret: string;
  publicBaseUrl: string;
  webDist?: string;
  now?: () => Date;
  /** Git commit being run, shown by /api/health. */
  commit?: string;
  /** Web app addresses on other origins (e.g. GitHub Pages) allowed to call this API. */
  corsOrigins?: string[];
  /**
   * Demo mode only: the shared demo password and the handover PIN of each ticket checked in since
   * start-up, so testers find every credential on the sign-in page. Never set in production.
   */
  demo?: { password: string; pins: Map<string, string> };
  /** Guest SMS; when missing, no messages are sent. */
  notifier?: Notifier;
  /** SMS settings chosen in the admin panel; changing them switches the notifier's sender. */
  smsSettings?: SmsSettingsMemory;
  /** Test HTTPS certificate (DER), offered at /dev-cert.crt so phones can trust the https test address. */
  devCertDer?: Buffer;
  /** Extra routes (e.g. Google Drive administration), mounted under /api after sign-in. */
  extraStaffRoutes?: (staff: express.Router) => void;
  /** Extra public routes (e.g. the Google sign-in callback), mounted before sign-in is required. */
  extraPublicRoutes?: (app: express.Express) => void;
}

function queryStrings(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) out[k] = Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
  return out;
}

/** The Valet server: the shared API routes (api.ts) on Express, plus files, the web app and Google routes. */
export function createApp(deps: AppDeps): express.Express {
  const { repo, users, photos } = deps;
  const app = express();
  app.disable('x-powered-by');

  if (deps.corsOrigins?.length) {
    // Sign-in uses a bearer token, not cookies, so allowing listed origins exposes no session.
    const allowed = new Set(deps.corsOrigins);
    app.use('/api', (req, res, next) => {
      const origin = req.header('origin');
      if (origin && allowed.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Max-Age', '600');
      }
      if (req.method === 'OPTIONS') {
        res.sendStatus(origin && allowed.has(origin) ? 204 : 403);
        return;
      }
      next();
    });
  }
  app.use(express.json({ limit: '1mb' }));

  if (deps.devCertDer) {
    const der = deps.devCertDer;
    app.get('/dev-cert.crt', (_req, res) => {
      res.setHeader('Content-Disposition', 'attachment; filename="valet-test-server.crt"');
      res.type('application/x-x509-ca-cert').send(der);
    });
  }

  deps.extraPublicRoutes?.(app);

  // Photos, through short-lived signed links (server only).
  app.get('/api/files', (req, res, next) => {
    const ref = String(req.query.ref ?? '');
    if (!checkFileSignature(deps.authSecret, ref, Number(req.query.exp), String(req.query.sig ?? ''))) {
      res.status(403).json({ error: 'Link expired' });
      return;
    }
    photos
      .read(ref)
      .then((file) => {
        res.setHeader('Cache-Control', 'private, max-age=600');
        res.type(file.mime).send(file.data);
      })
      .catch(next);
  });

  const routes = apiRoutes({
    repo,
    users,
    publicBaseUrl: deps.publicBaseUrl,
    now: deps.now,
    commit: deps.commit,
    photoUrl: (ref) => signFileUrl(deps.authSecret, ref),
    saveUpload: async (dataUrl) => {
      const file = decodeImage(dataUrl);
      return { fileRef: await photos.save(file.data, file.mime), storage: photos.kind };
    },
    photoStorage: () => photos.kind,
    demo: deps.demo,
    notifier: deps.notifier,
    smsSettings: deps.smsSettings,
  });

  for (const route of routes) {
    const handlers: express.RequestHandler[] = [];
    if (route.access === 'staff') handlers.push(authenticate(users));
    if (route.permission) handlers.push(requirePermission(route.permission));
    handlers.push((req: Request, res: Response, next: NextFunction) => {
      const ctx: ApiContext = { params: req.params as Record<string, string>, query: queryStrings(req), body: req.body, user: req.user };
      Promise.resolve()
        .then(() => route.handler(ctx))
        .then((result) => {
          if (res.headersSent) return;
          if (result instanceof ApiResponse) res.status(result.status).json(result.body);
          else res.json(result ?? { ok: true });
        })
        .catch(next);
    });
    app[route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'](`/api${route.path}`, ...handlers);
  }

  // Google Drive administration and any other staff-only extras; unknown /api paths need sign-in.
  const staff = express.Router();
  staff.use(authenticate(users));
  deps.extraStaffRoutes?.(staff);
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
    const { status, body } = errorResponse(err);
    if (status === 500 && !(err instanceof HttpError)) console.error(err);
    res.status(status).json(body);
  });

  return app;
}
