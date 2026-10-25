/**
 * Roles and permissions (SRS 2.9). Pure code with no Node.js dependencies, shared by the server and
 * the in-browser demo server.
 */

/** Permission catalogue (subset of SRS 2.9.1 used by this server). */
export const PERMISSIONS = [
  'tickets.check_in',
  'tickets.view',
  'tickets.request_car',
  'parking.record_spot',
  'tasks.accept',
  'tasks.assign',
  'handover.hand_over',
  'handover.approve_balance',
  'payments.record',
  'payments.verify',
  'incidents.report',
  'reports.view',
  'guest.view_full_mobile',
  'locations.manage',
  'locations.settings',
  'payment_qr.upload',
  'payment_qr.approve',
  'sms.configure',
  'data.manage',
  'users.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** What each permission allows, for the role editor. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  'tickets.check_in': 'Check in cars',
  'tickets.view': 'See cars and tickets',
  'tickets.request_car': 'Request a car for a guest',
  'parking.record_spot': 'Record and move parking spots',
  'tasks.accept': 'Accept park and retrieve tasks',
  'tasks.assign': 'Prioritise tasks and re-park no-shows',
  'handover.hand_over': 'Hand cars back to guests',
  'handover.approve_balance': 'Release a car with a balance due',
  'payments.record': 'Record cash and card payments',
  'payments.verify': 'Verify QR payments',
  'incidents.report': 'Report incidents',
  'reports.view': 'See the dashboard',
  'guest.view_full_mobile': "See guests' full mobile numbers",
  'locations.manage': 'Create locations',
  'locations.settings': 'Change location settings',
  'payment_qr.upload': 'Upload the payment QR',
  'payment_qr.approve': 'Approve payment QRs (platform)',
  'sms.configure': 'Set up guest SMS',
  'data.manage': 'Manage Google data and backups',
  'users.manage': 'Manage staff accounts and roles',
};

export const ROLES = ['platform_admin', 'operator_admin', 'location_manager', 'supervisor', 'attendant', 'merchant_validator'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  platform_admin: 'Platform admin',
  operator_admin: 'Operator admin',
  location_manager: 'Location manager',
  supervisor: 'Supervisor',
  attendant: 'Attendant',
  merchant_validator: 'Merchant validator',
};

const ATTENDANT: Permission[] = ['tickets.check_in', 'tickets.view', 'tickets.request_car', 'parking.record_spot', 'tasks.accept', 'handover.hand_over', 'payments.record', 'incidents.report'];
const SUPERVISOR: Permission[] = [...ATTENDANT, 'tasks.assign', 'handover.approve_balance', 'payments.verify', 'guest.view_full_mobile', 'reports.view'];
const MANAGER: Permission[] = [...SUPERVISOR, 'locations.settings', 'payment_qr.upload'];
const OPERATOR_ADMIN: Permission[] = [...MANAGER, 'locations.manage', 'sms.configure', 'data.manage', 'users.manage'];

/** Built-in roles (SRS 2.9.2). Nobody can see handover PINs, so there is no permission for it. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  platform_admin: PERMISSIONS,
  operator_admin: OPERATOR_ADMIN,
  location_manager: MANAGER,
  supervisor: SUPERVISOR,
  attendant: ATTENDANT,
  merchant_validator: ['tickets.view', 'tickets.request_car'],
};

export function isBuiltInRole(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role);
}

/** A role an admin defined, with exactly the permissions they ticked. */
export interface CustomRole {
  /** "custom-<slug>", so it can never clash with a built-in role. */
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  createdBy: string;
  createdAt: string;
}

export interface StaffUser {
  id: string;
  username: string;
  name: string;
  /** A built-in role, or the id of a custom role. */
  role: Role | string;
  /** Location ids the user works at, or "all". */
  locations: string[] | 'all';
  passwordHash: string;
  /** Set when an admin gave out the password; the user must choose their own before doing anything else. */
  mustChangePassword?: boolean;
  /** Disabled accounts can't sign in, and their open sessions end. */
  disabled?: boolean;
  /** Raised on password change, reset or disabling, which ends every session signed before it. */
  tokenVersion?: number;
  passwordChangedAt?: string;
  /**
   * Resolved permissions, filled in by the directory on sign-in and on every request (never
   * stored). Needed because custom roles live in the directory, not in this file.
   */
  permissions?: readonly Permission[];
}

export type PublicUser = Omit<StaffUser, 'passwordHash' | 'tokenVersion' | 'permissions'> & { permissions: readonly Permission[] };

export function permissionsOf(user: StaffUser): readonly Permission[] {
  return user.permissions ?? (isBuiltInRole(user.role) ? ROLE_PERMISSIONS[user.role] : []);
}

export function toPublicUser(u: StaffUser): PublicUser {
  const { passwordHash: _hash, tokenVersion: _version, permissions: _permissions, ...rest } = u;
  return { ...rest, permissions: permissionsOf(u) };
}

export function can(user: StaffUser, permission: Permission): boolean {
  return permissionsOf(user).includes(permission);
}

/**
 * Requests allowed while a user still has to replace the password an admin gave them: enough to
 * show who they are and change it.
 */
export function allowedBeforePasswordChange(method: string, path: string): boolean {
  return (method === 'GET' && (path === '/me' || path === '/locations')) || (method === 'POST' && path === '/auth/change-password');
}

export function canAccessLocation(user: StaffUser, locationId: string): boolean {
  return user.locations === 'all' || user.locations.includes(locationId);
}

/** Staff sign-in, implemented by StaffDirectory for both the server and the browser demo. */
export interface UserAuth {
  login(username: string, password: string): { token: string; user: StaffUser } | { error: 'invalid' | 'locked' | 'disabled' };
  verify(token: string): StaffUser | undefined;
  list(): StaffUser[];
}
