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
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['platform_admin', 'operator_admin', 'location_manager', 'supervisor', 'attendant', 'merchant_validator'] as const;
export type Role = (typeof ROLES)[number];

const ATTENDANT: Permission[] = ['tickets.check_in', 'tickets.view', 'tickets.request_car', 'parking.record_spot', 'tasks.accept', 'handover.hand_over', 'payments.record', 'incidents.report'];
const SUPERVISOR: Permission[] = [...ATTENDANT, 'tasks.assign', 'handover.approve_balance', 'payments.verify', 'guest.view_full_mobile', 'reports.view'];
const MANAGER: Permission[] = [...SUPERVISOR, 'locations.settings', 'payment_qr.upload'];
const OPERATOR_ADMIN: Permission[] = [...MANAGER, 'locations.manage', 'sms.configure', 'data.manage'];

/** Built-in roles (SRS 2.9.2). Nobody can see handover PINs, so there is no permission for it. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  platform_admin: PERMISSIONS,
  operator_admin: OPERATOR_ADMIN,
  location_manager: MANAGER,
  supervisor: SUPERVISOR,
  attendant: ATTENDANT,
  merchant_validator: ['tickets.view', 'tickets.request_car'],
};

export interface StaffUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  /** Location ids the user works at, or "all". */
  locations: string[] | 'all';
  passwordHash: string;
}

export type PublicUser = Omit<StaffUser, 'passwordHash'> & { permissions: readonly Permission[] };

export function toPublicUser(u: StaffUser): PublicUser {
  const { passwordHash: _omit, ...rest } = u;
  return { ...rest, permissions: ROLE_PERMISSIONS[u.role] };
}

export function can(user: StaffUser, permission: Permission): boolean {
  return ROLE_PERMISSIONS[user.role].includes(permission);
}

export function canAccessLocation(user: StaffUser, locationId: string): boolean {
  return user.locations === 'all' || user.locations.includes(locationId);
}

/** Staff sign-in, implemented by the server's UserDirectory and by the browser demo. */
export interface UserAuth {
  login(username: string, password: string): { token: string; user: StaffUser } | { error: 'invalid' | 'locked' };
  verify(token: string): StaffUser | undefined;
  list(): StaffUser[];
}
