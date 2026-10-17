import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { buildExportWorkbook, type ValetSheetsRepository } from '@valet/sheets-integration';
import { requirePermission } from '../auth.js';
import type { DataManager } from './dataManager.js';

const STATE_TTL_MS = 10 * 60_000;

/** Signed, short-lived OAuth state so only an admin who started the sign-in can finish it. */
export function signState(secret: string, userId: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ u: userId, exp: now + STATE_TTL_MS })).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(`google-state:${body}`).digest('base64url')}`;
}

export function readState(secret: string, state: string, now = Date.now()): string | undefined {
  const [body, sig] = state.split('.');
  if (!body || !sig) return undefined;
  const expected = createHmac('sha256', secret).update(`google-state:${body}`).digest('base64url');
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return undefined;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as { u: string; exp: number };
  return payload.exp >= now ? payload.u : undefined;
}

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
const wrap =
  (fn: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve()
      .then(() => fn(req, res))
      .then((body) => {
        if (!res.headersSent) res.json(body ?? { ok: true });
      })
      .catch((err: unknown) => {
        if (res.headersSent) return next(err);
        const message = err instanceof Error ? err.message : String(err);
        res.status(err instanceof z.ZodError ? 400 : 409).json({ error: message });
      });
  };

export interface GoogleRouteDeps {
  data: DataManager;
  repo: ValetSheetsRepository;
  authSecret: string;
  appName: () => string;
}

/** Public: Google redirects the admin's browser here after they approve access. */
export function googlePublicRoutes(deps: GoogleRouteDeps) {
  return (app: express.Express): void => {
    app.get('/api/google/callback', async (req, res) => {
      const back = (q: string) => res.redirect(`/staff/data?${q}`);
      const userId = readState(deps.authSecret, String(req.query.state ?? ''));
      if (!userId) return back('google=error&message=' + encodeURIComponent('The sign-in link expired. Try Connect again.'));
      if (req.query.error) return back('google=error&message=' + encodeURIComponent(`Google said: ${String(req.query.error)}`));
      try {
        await deps.data.connect(String(req.query.code ?? ''), userId, deps.appName());
        back('google=connected');
      } catch (e) {
        back('google=error&message=' + encodeURIComponent((e as Error).message));
      }
    });
  };
}

/** Data administration for operator admins (permission data.manage). */
export function googleStaffRoutes(deps: GoogleRouteDeps) {
  return (staff: express.Router): void => {
    const admin = requirePermission('data.manage');
    const { data } = deps;

    staff.get('/google/status', admin, wrap(() => data.status()));

    staff.put(
      '/google/client',
      admin,
      wrap((req) => {
        const body = z.object({ clientId: z.string().min(10).max(200), clientSecret: z.string().max(200).optional() }).parse(req.body);
        data.setClient(body.clientId, body.clientSecret, req.user?.id ?? '');
        return data.status();
      }),
    );

    staff.post('/google/connect', admin, wrap((req) => ({ url: data.authUrl(signState(deps.authSecret, req.user?.id ?? '')) })));
    staff.post(
      '/google/disconnect',
      admin,
      wrap(async () => {
        await data.disconnect();
        return data.status();
      }),
    );
    staff.post('/google/sync', admin, wrap(async () => ({ pendingWrites: await data.sync() })));
    staff.post('/google/backup', admin, wrap(async () => ({ copied: await data.backup(), status: data.status() })));
    staff.post('/google/verify', admin, wrap(() => data.verify()));
    staff.get('/google/usage', admin, wrap(() => data.usage()));

    staff.post(
      '/google/sharing',
      admin,
      wrap(async (req) => {
        const body = z.object({ email: z.string().email().max(200), access: z.enum(['reader', 'writer']) }).parse(req.body);
        return { sharing: await data.share(body.email, body.access, req.user?.id ?? '') };
      }),
    );
    staff.delete(
      '/google/sharing/:email',
      admin,
      wrap(async (req) => ({ sharing: await data.unshare(String(req.params.email)) })),
    );

    // All data as one Excel workbook (also works before Google is connected).
    staff.get('/data/export.xlsx', admin, async (_req, res, next) => {
      try {
        const now = new Date();
        const buffer = await buildExportWorkbook(deps.repo.exportRows(), now).xlsx.writeBuffer();
        res.setHeader('Content-Disposition', `attachment; filename="valet-data-${now.toISOString().slice(0, 10)}.xlsx"`);
        res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buffer as ArrayBuffer));
      } catch (e) {
        next(e);
      }
    });
  };
}
