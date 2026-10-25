import { describe, expect, it } from 'vitest';
import { UserDirectory } from '../src/auth.js';
import { removeStaffUser, upsertStaffUser } from '../src/staffUsers.js';

const base = { username: 'Asha', name: 'Asha Rao', role: 'operator_admin', locations: 'all', password: 'correct horse battery' };

describe('staff users file', () => {
  it('adds a user whose password works for sign-in', () => {
    const { users, created } = upsertStaffUser([], base);
    expect(created).toBe(true);
    expect(users[0]).toMatchObject({ id: 'u-asha', username: 'asha', role: 'operator_admin', locations: 'all' });
    expect(users[0]?.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(users)).not.toContain('correct horse');
    const dir = new UserDirectory('secret', users);
    expect('token' in dir.login('asha', 'correct horse battery')).toBe(true);
    expect('token' in dir.login('asha', 'wrong password!')).toBe(false);
  });

  it('updates an existing user instead of adding a second one', () => {
    const first = upsertStaffUser([], base).users;
    const { users, created } = upsertStaffUser(first, { ...base, role: 'attendant', locations: 'loc-1, loc-2', password: 'another long one' });
    expect(created).toBe(false);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: 'u-asha', role: 'attendant', locations: ['loc-1', 'loc-2'] });
  });

  it('rejects weak passwords, unknown roles and bad usernames', () => {
    expect(() => upsertStaffUser([], { ...base, password: 'short' })).toThrow(/at least 10/);
    expect(() => upsertStaffUser([], { ...base, role: 'owner' })).toThrow(/Role must be one of/);
    expect(() => upsertStaffUser([], { ...base, username: 'a b' })).toThrow(/Username/);
  });

  it('removes a user by username', () => {
    const users = upsertStaffUser([], base).users;
    expect(removeStaffUser(users, 'ASHA')).toEqual([]);
    expect(() => removeStaffUser(users, 'nobody')).toThrow(/No user/);
  });
});
