/**
 * Staff accounts and custom roles: sign-in with lockout (NFR-SEC-03), sessions, and the user and
 * role management behind the Staff page. Pure code with no Node.js dependencies, shared by the
 * server (scrypt passwords, HMAC tokens, a JSON file on disk) and the browser demo (localStorage).
 */
import {
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  isBuiltInRole,
  type CustomRole,
  type Permission,
  type StaffUser,
  type UserAuth,
} from './permissions.js';

export interface StaffData {
  users: StaffUser[];
  roles: CustomRole[];
}

export interface PasswordHasher {
  hash(password: string): string;
  check(password: string, stored: string): boolean;
}

export interface TokenPayload {
  sub: string;
  exp: number;
  /** The user's tokenVersion when signed; an older version means the session has ended. */
  v: number;
}

export interface TokenCodec {
  sign(payload: TokenPayload): string;
  /** The payload if the token is genuine, whatever its expiry. */
  read(token: string): TokenPayload | undefined;
}

/** A refused user or role change, with the HTTP status to answer with. */
export class StaffError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const MIN_PASSWORD_LENGTH = 10;
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60_000;
const TOKEN_TTL_MS = 12 * 60 * 60_000;
const USERNAME = /^[a-z0-9._-]{3,40}$/;

export interface RoleInfo {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  permissions: readonly Permission[];
  /** Number of users with this role. */
  users: number;
}

export interface UserInput {
  username: string;
  name: string;
  role: string;
  locations: string[] | 'all';
  password: string;
}

export interface UserPatch {
  name?: string;
  role?: string;
  locations?: string[] | 'all';
  disabled?: boolean;
}

export function checkPasswordRules(password: string, username: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new StaffError(400, `The password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  if (password.length > 200) throw new StaffError(400, 'The password is too long');
  if (password.trim().toLowerCase() === username.trim().toLowerCase()) throw new StaffError(400, 'The password must not be the username');
}

const subset = (inner: readonly Permission[], outer: readonly Permission[]) => inner.every((p) => outer.includes(p));
const locationsWithin = (inner: string[] | 'all', outer: string[] | 'all') => outer === 'all' || (inner !== 'all' && inner.every((l) => outer.includes(l)));

export class StaffDirectory implements UserAuth {
  private readonly users = new Map<string, StaffUser>();
  private readonly customRoles = new Map<string, CustomRole>();
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private readonly options: {
      hasher: PasswordHasher;
      tokens: TokenCodec;
      now?: () => number;
      /** Called with the full data after every change, to save it. */
      onChange?: (data: StaffData) => void;
      /** Ids for new users and roles; random by default. */
      newId?: () => string;
    },
    data: Partial<StaffData> = {},
  ) {
    for (const r of data.roles ?? []) this.customRoles.set(r.id, r);
    for (const u of data.users ?? []) this.users.set(u.id, u);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private changed(): void {
    this.options.onChange?.(this.data());
  }

  /** Everything to store, with password hashes. */
  data(): StaffData {
    return { users: [...this.users.values()].map((u) => structuredClone(u)), roles: [...this.customRoles.values()].map((r) => structuredClone(r)) };
  }

  get size(): number {
    return this.users.size;
  }

  /** Adds or replaces an account as is (seeding, imports). */
  add(user: StaffUser): void {
    this.users.set(user.id, user);
    this.changed();
  }

  list(): StaffUser[] {
    return [...this.users.values()];
  }

  byId(id: string): StaffUser | undefined {
    return this.users.get(id);
  }

  permissionsFor(role: string): readonly Permission[] {
    if (isBuiltInRole(role)) return ROLE_PERMISSIONS[role];
    return this.customRoles.get(role)?.permissions ?? [];
  }

  roleName(role: string): string {
    if (isBuiltInRole(role)) return ROLE_LABELS[role];
    return this.customRoles.get(role)?.name ?? role;
  }

  /** The stored user with resolved permissions, for one request. */
  private session(user: StaffUser): StaffUser {
    return { ...user, permissions: this.permissionsFor(user.role) };
  }

  // ---------------------------------------------------------------- sign-in

  login(username: string, password: string): { token: string; user: StaffUser } | { error: 'invalid' | 'locked' | 'disabled' } {
    const key = username.trim().toLowerCase();
    const state = this.failures.get(key);
    if (state && state.lockedUntil > this.now()) return { error: 'locked' };
    const user = [...this.users.values()].find((u) => u.username.toLowerCase() === key);
    if (!user || !this.options.hasher.check(password, user.passwordHash)) {
      const count = (state && state.lockedUntil <= this.now() && state.count >= LOCK_AFTER ? 0 : (state?.count ?? 0)) + 1;
      this.failures.set(key, { count, lockedUntil: count >= LOCK_AFTER ? this.now() + LOCK_MS : 0 });
      return { error: count >= LOCK_AFTER ? 'locked' : 'invalid' };
    }
    // Checked after the password, so a wrong guess can't tell whether an account exists.
    if (user.disabled) return { error: 'disabled' };
    this.failures.delete(key);
    return { token: this.issue(user), user: this.session(user) };
  }

  private issue(user: StaffUser): string {
    return this.options.tokens.sign({ sub: user.id, exp: this.now() + TOKEN_TTL_MS, v: user.tokenVersion ?? 0 });
  }

  verify(token: string): StaffUser | undefined {
    const payload = this.options.tokens.read(token);
    if (!payload || payload.exp < this.now()) return undefined;
    const user = this.users.get(payload.sub);
    if (!user || user.disabled || (payload.v ?? 0) !== (user.tokenVersion ?? 0)) return undefined;
    return this.session(user);
  }

  /** The user's own change. Ends their other sessions and returns a new token for this one. */
  changeOwnPassword(userId: string, current: string, next: string): { token: string; user: StaffUser } {
    const user = this.users.get(userId);
    if (!user) throw new StaffError(404, 'Account not found');
    if (!this.options.hasher.check(current, user.passwordHash)) throw new StaffError(400, 'The current password is wrong');
    checkPasswordRules(next, user.username);
    if (current === next) throw new StaffError(400, 'Choose a password different from the current one');
    const updated: StaffUser = {
      ...user,
      passwordHash: this.options.hasher.hash(next),
      mustChangePassword: false,
      tokenVersion: (user.tokenVersion ?? 0) + 1,
      passwordChangedAt: new Date(this.now()).toISOString(),
    };
    this.users.set(user.id, updated);
    this.changed();
    return { token: this.issue(updated), user: this.session(updated) };
  }

  // ---------------------------------------------------------------- roles

  roles(): RoleInfo[] {
    const count = (role: string) => [...this.users.values()].filter((u) => u.role === role).length;
    return [
      ...Object.entries(ROLE_PERMISSIONS).map(([id, permissions]) => ({
        id,
        name: ROLE_LABELS[id as keyof typeof ROLE_LABELS],
        description: '',
        builtIn: true,
        permissions,
        users: count(id),
      })),
      ...[...this.customRoles.values()].map((r) => ({ id: r.id, name: r.name, description: r.description, builtIn: false, permissions: r.permissions, users: count(r.id) })),
    ];
  }

  private cleanPermissions(actor: StaffUser, permissions: string[]): Permission[] {
    const list = [...new Set(permissions)];
    const unknown = list.filter((p) => !(PERMISSIONS as readonly string[]).includes(p));
    if (unknown.length) throw new StaffError(400, `Unknown permission: ${unknown.join(', ')}`);
    if (list.length === 0) throw new StaffError(400, 'Tick at least one permission');
    const mine = this.permissionsFor(actor.role);
    const extra = list.filter((p) => !mine.includes(p as Permission));
    if (extra.length) throw new StaffError(403, `You can't give permissions you don't have: ${extra.join(', ')}`);
    return list as Permission[];
  }

  createRole(actor: StaffUser, input: { name: string; description?: string; permissions: string[] }): RoleInfo {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 40) throw new StaffError(400, 'Role name: 2–40 characters');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const taken = this.roles().some((r) => r.name.toLowerCase() === name.toLowerCase());
    if (taken || !slug) throw new StaffError(409, `There is already a role called "${name}"`);
    const id = this.customRoles.has(`custom-${slug}`) ? `custom-${slug}-${this.newId()}` : `custom-${slug}`;
    const role: CustomRole = {
      id,
      name,
      description: (input.description ?? '').trim().slice(0, 200),
      permissions: this.cleanPermissions(actor, input.permissions),
      createdBy: actor.id,
      createdAt: new Date(this.now()).toISOString(),
    };
    this.customRoles.set(id, role);
    this.changed();
    return this.roles().find((r) => r.id === id)!;
  }

  updateRole(actor: StaffUser, id: string, patch: { name?: string; description?: string; permissions?: string[] }): RoleInfo {
    const role = this.customRoles.get(id);
    if (!role) throw new StaffError(isBuiltInRole(id) ? 400 : 404, isBuiltInRole(id) ? 'Built-in roles cannot be changed; create a custom role instead' : 'Role not found');
    if (!subset(role.permissions, this.permissionsFor(actor.role))) throw new StaffError(403, "You can't change a role with permissions you don't have");
    const name = patch.name?.trim();
    if (name !== undefined) {
      if (name.length < 2 || name.length > 40) throw new StaffError(400, 'Role name: 2–40 characters');
      if (this.roles().some((r) => r.id !== id && r.name.toLowerCase() === name.toLowerCase())) throw new StaffError(409, `There is already a role called "${name}"`);
    }
    const updated: CustomRole = {
      ...role,
      name: name ?? role.name,
      description: patch.description !== undefined ? patch.description.trim().slice(0, 200) : role.description,
      permissions: patch.permissions ? this.cleanPermissions(actor, patch.permissions) : role.permissions,
    };
    // Someone who manages users can't remove that permission from their own role and lock everyone out by accident.
    if (actor.role === id && !updated.permissions.includes('users.manage')) {
      throw new StaffError(400, "You can't remove staff management from your own role");
    }
    this.customRoles.set(id, updated);
    this.changed();
    return this.roles().find((r) => r.id === id)!;
  }

  deleteRole(actor: StaffUser, id: string): void {
    const role = this.customRoles.get(id);
    if (!role) throw new StaffError(isBuiltInRole(id) ? 400 : 404, isBuiltInRole(id) ? 'Built-in roles cannot be deleted' : 'Role not found');
    if (!subset(role.permissions, this.permissionsFor(actor.role))) throw new StaffError(403, "You can't delete a role with permissions you don't have");
    const holders = [...this.users.values()].filter((u) => u.role === id).length;
    if (holders) throw new StaffError(409, `${holders} user${holders > 1 ? 's have' : ' has'} this role; give them another role first`);
    this.customRoles.delete(id);
    this.changed();
  }

  // ---------------------------------------------------------------- users

  private roleExists(role: string): boolean {
    return isBuiltInRole(role) || this.customRoles.has(role);
  }

  canManage(actor: StaffUser, target: Pick<StaffUser, 'role' | 'locations'>): boolean {
    try {
      this.assertCanManage(actor, target);
      return true;
    } catch {
      return false;
    }
  }

  /** The actor may only manage people who have no more permissions or locations than they do. */
  private assertCanManage(actor: StaffUser, target: Pick<StaffUser, 'role' | 'locations'>): void {
    if (!subset(this.permissionsFor(target.role), this.permissionsFor(actor.role))) {
      throw new StaffError(403, `You can't manage a ${this.roleName(target.role)}: that role has permissions you don't have`);
    }
    if (!locationsWithin(target.locations, actor.locations)) throw new StaffError(403, "You can only give access to locations you work at yourself");
  }

  private newId(): string {
    return this.options.newId?.() ?? globalThis.crypto.randomUUID().slice(0, 8);
  }

  createUser(actor: StaffUser, input: UserInput): StaffUser {
    const username = input.username.trim().toLowerCase();
    if (!USERNAME.test(username)) throw new StaffError(400, 'Username: 3–40 characters, letters, digits, dot, dash or underscore');
    if ([...this.users.values()].some((u) => u.username.toLowerCase() === username)) throw new StaffError(409, `The username "${username}" is taken`);
    const name = input.name.trim();
    if (name.length < 2 || name.length > 80) throw new StaffError(400, 'Name: 2–80 characters');
    if (!this.roleExists(input.role)) throw new StaffError(400, 'Choose a role');
    if (input.locations !== 'all' && input.locations.length === 0) throw new StaffError(400, 'Choose at least one location, or all locations');
    this.assertCanManage(actor, input);
    checkPasswordRules(input.password, username);
    const user: StaffUser = {
      id: `u-${this.newId()}`,
      username,
      name,
      role: input.role,
      locations: input.locations,
      passwordHash: this.options.hasher.hash(input.password),
      mustChangePassword: true,
      tokenVersion: 0,
    };
    this.users.set(user.id, user);
    this.changed();
    return user;
  }

  private target(actor: StaffUser, id: string): StaffUser {
    const user = this.users.get(id);
    if (!user) throw new StaffError(404, 'Account not found');
    this.assertCanManage(actor, user);
    return user;
  }

  updateUser(actor: StaffUser, id: string, patch: UserPatch): StaffUser {
    const user = this.target(actor, id);
    const self = user.id === actor.id;
    if (self && patch.role !== undefined && patch.role !== user.role) throw new StaffError(400, "You can't change your own role");
    if (self && patch.disabled) throw new StaffError(400, "You can't disable your own account");
    if (self && patch.locations !== undefined && JSON.stringify(patch.locations) !== JSON.stringify(user.locations)) {
      throw new StaffError(400, "You can't change your own locations");
    }
    if (patch.role !== undefined && !this.roleExists(patch.role)) throw new StaffError(400, 'Choose a role');
    if (patch.locations !== undefined && patch.locations !== 'all' && patch.locations.length === 0) throw new StaffError(400, 'Choose at least one location, or all locations');
    const name = patch.name?.trim();
    if (name !== undefined && (name.length < 2 || name.length > 80)) throw new StaffError(400, 'Name: 2–80 characters');
    const updated: StaffUser = {
      ...user,
      name: name ?? user.name,
      role: patch.role ?? user.role,
      locations: patch.locations ?? user.locations,
      disabled: patch.disabled ?? user.disabled,
    };
    this.assertCanManage(actor, updated);
    // Disabling ends open sessions straight away.
    if (patch.disabled && !user.disabled) updated.tokenVersion = (user.tokenVersion ?? 0) + 1;
    this.users.set(id, updated);
    this.changed();
    return updated;
  }

  /** An admin sets a new password; the user must change it at next sign-in, and is signed out now. */
  resetPassword(actor: StaffUser, id: string, password: string): StaffUser {
    const user = this.target(actor, id);
    if (user.id === actor.id) throw new StaffError(400, 'Change your own password from your account menu');
    checkPasswordRules(password, user.username);
    const updated: StaffUser = {
      ...user,
      passwordHash: this.options.hasher.hash(password),
      mustChangePassword: true,
      tokenVersion: (user.tokenVersion ?? 0) + 1,
      passwordChangedAt: new Date(this.now()).toISOString(),
    };
    this.users.set(id, updated);
    this.failures.delete(user.username.toLowerCase());
    this.changed();
    return updated;
  }

  deleteUser(actor: StaffUser, id: string): void {
    const user = this.target(actor, id);
    if (user.id === actor.id) throw new StaffError(400, "You can't delete your own account");
    this.users.delete(id);
    this.changed();
  }
}
