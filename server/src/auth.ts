import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { NextFunction, Request, Response } from 'express';

import { can, type Permission, type StaffUser, type UserAuth } from './permissions.js';

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




const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60_000;
const TOKEN_TTL_MS = 12 * 60 * 60_000;

/** Staff accounts, sign-in with lockout (NFR-SEC-03) and signed session tokens. */
export class UserDirectory implements UserAuth {
  private readonly users = new Map<string, StaffUser>();
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private readonly secret: string,
    users: StaffUser[] = [],
    private readonly now: () => number = Date.now,
  ) {
    for (const u of users) this.add(u);
  }

  static fromFile(path: string, secret: string): UserDirectory {
    return new UserDirectory(secret, JSON.parse(readFileSync(path, 'utf8')) as StaffUser[]);
  }

  add(user: StaffUser): void {
    this.users.set(user.id, user);
  }

  get size(): number {
    return this.users.size;
  }

  list(): StaffUser[] {
    return [...this.users.values()];
  }

  byId(id: string): StaffUser | undefined {
    return this.users.get(id);
  }

  /** Returns a token, or a reason the sign-in was refused. */
  login(username: string, password: string): { token: string; user: StaffUser } | { error: 'invalid' | 'locked' } {
    const key = username.trim().toLowerCase();
    const state = this.failures.get(key);
    if (state && state.lockedUntil > this.now()) return { error: 'locked' };
    const user = [...this.users.values()].find((u) => u.username.toLowerCase() === key);
    if (!user || !checkPassword(password, user.passwordHash)) {
      const count = (state && state.lockedUntil <= this.now() && state.count >= LOCK_AFTER ? 0 : state?.count ?? 0) + 1;
      this.failures.set(key, { count, lockedUntil: count >= LOCK_AFTER ? this.now() + LOCK_MS : 0 });
      return { error: count >= LOCK_AFTER ? 'locked' : 'invalid' };
    }
    this.failures.delete(key);
    return { token: this.sign({ sub: user.id, exp: this.now() + TOKEN_TTL_MS }), user };
  }

  sign(payload: { sub: string; exp: number }): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${createHmac('sha256', this.secret).update(body).digest('base64url')}`;
  }

  verify(token: string): StaffUser | undefined {
    const [body, sig] = token.split('.');
    if (!body || !sig) return undefined;
    const expected = createHmac('sha256', this.secret).update(body).digest('base64url');
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return undefined;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as { sub: string; exp: number };
    if (payload.exp < this.now()) return undefined;
    return this.users.get(payload.sub);
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

export function authenticate(directory: UserAuth) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('authorization') ?? '';
    const user = header.startsWith('Bearer ') ? directory.verify(header.slice(7)) : undefined;
    if (!user) {
      res.status(401).json({ error: 'Sign in required' });
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
