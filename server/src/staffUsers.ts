import { hashPassword } from './auth.js';
import { ROLES, type Role, type StaffUser } from './permissions.js';

export interface StaffUserInput {
  username: string;
  name: string;
  role: string;
  /** "all", or location ids separated by commas. */
  locations: string;
  password: string;
}

export const MIN_PASSWORD_LENGTH = 10;

/**
 * Adds a user to the staff users list, or updates the one with the same username (new password,
 * name, role and locations). Returns the new list; the input list is not changed.
 */
export function upsertStaffUser(users: StaffUser[], input: StaffUserInput): { users: StaffUser[]; created: boolean } {
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('Username: 3–40 characters, letters, digits, dot, dash or underscore');
  if (input.name.trim().length < 2) throw new Error('Name is required');
  if (!(ROLES as readonly string[]).includes(input.role)) throw new Error(`Role must be one of: ${ROLES.join(', ')}`);
  if (input.password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  const ids = input.locations.trim();
  const locations: StaffUser['locations'] =
    ids === '' || ids === 'all'
      ? 'all'
      : ids
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

  const existing = users.find((u) => u.username.toLowerCase() === username);
  const user: StaffUser = {
    id: existing?.id ?? `u-${username}`,
    username,
    name: input.name.trim(),
    role: input.role as Role,
    locations,
    passwordHash: hashPassword(input.password),
  };
  return {
    users: existing ? users.map((u) => (u === existing ? user : u)) : [...users, user],
    created: !existing,
  };
}

export function removeStaffUser(users: StaffUser[], username: string): StaffUser[] {
  const key = username.trim().toLowerCase();
  const next = users.filter((u) => u.username.toLowerCase() !== key);
  if (next.length === users.length) throw new Error(`No user called "${username}"`);
  return next;
}
