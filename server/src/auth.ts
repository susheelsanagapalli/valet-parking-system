import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { NextFunction, Request, Response } from 'express';

import { allowedBeforePasswordChange, can, type Permission, type StaffUser, type UserAuth } from './permissions.js';
import { StaffDirectory, type PasswordHasher, type StaffData, type TokenCodec, type TokenPayload } from './staffDirectory.js';

export * from './permissions.js';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString('hex')}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const scrypt: PasswordHasher = { hash: hashPassword, check: checkPassword };

function hmacTokens(secret: string): TokenCodec {
  return {
    sign(payload) {
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
    },
    read(token) {
      const [body, sig] = token.split('.');
      if (!body || !sig) return undefined;
      const expected = createHmac('sha256', secret).update(body).digest('base64url');
      if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return undefined;
      try {
        return JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
      } catch {
        return undefined;
      }
    },
  };
}

/** Reads a staff file: the full {users, roles} the server saves, or a plain list of users (npm run staff-user). */
export function readStaffFile(path: string): StaffData {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as StaffData | StaffData['users'];
  return Array.isArray(parsed) ? { users: parsed, roles: [] } : { users: parsed.users ?? [], roles: parsed.roles ?? [] };
}

/** Writes through a temporary file, so a crash mid-write never leaves a half-written staff file. */
function writeStaffFile(path: string, data: StaffData): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

/** Staff accounts on the server: scrypt passwords, HMAC-signed session tokens, optionally saved to a file. */
export class UserDirectory extends StaffDirectory {
  constructor(secret: string, users: StaffUser[] = [], now: () => number = Date.now, options: { roles?: StaffData['roles']; savePath?: string } = {}) {
    const savePath = options.savePath;
    super({ hasher: scrypt, tokens: hmacTokens(secret), now, onChange: savePath ? (data) => writeStaffFile(savePath, data) : undefined }, { users, roles: options.roles });
  }

  static fromFile(path: string, secret: string): UserDirectory {
    const data = readStaffFile(path);
    return new UserDirectory(secret, data.users, Date.now, { roles: data.roles });
  }

  /**
   * Accounts kept in `savePath` and saved there after every change made in the app. The first time
   * (no file yet), they are copied from `bootstrapPath` (STAFF_USERS_FILE), which is read-only.
   */
  static open(secret: string, savePath: string, bootstrapPath?: string): { users: UserDirectory; source: 'saved' | 'bootstrap' | 'empty' } {
    const source = existsSync(savePath) ? 'saved' : bootstrapPath ? 'bootstrap' : 'empty';
    const data = source === 'saved' ? readStaffFile(savePath) : source === 'bootstrap' ? readStaffFile(bootstrapPath!) : { users: [], roles: [] };
    const users = new UserDirectory(secret, data.users, Date.now, { roles: data.roles, savePath });
    if (source === 'bootstrap') writeStaffFile(savePath, users.data());
    return { users, source };
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: StaffUser;
    }
  }
}

export const PASSWORD_CHANGE_REQUIRED = 'Choose a new password before continuing';

export function authenticate(directory: UserAuth) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('authorization') ?? '';
    const user = header.startsWith('Bearer ') ? directory.verify(header.slice(7)) : undefined;
    if (!user) {
      res.status(401).json({ error: 'Sign in required' });
      return;
    }
    if (user.mustChangePassword && !allowedBeforePasswordChange(req.method, req.path.replace(/^\/api/, ''))) {
      res.status(403).json({ error: PASSWORD_CHANGE_REQUIRED, code: 'PASSWORD_CHANGE_REQUIRED' });
      return;
    }
    req.user = user;
    next();
  };
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !can(req.user, permission)) {
      res.status(403).json({ error: `Missing permission: ${permission}` });
      return;
    }
    next();
  };
}
