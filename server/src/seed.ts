import { hashPassword, type UserDirectory } from './auth.js';
import { DEMO_PASSWORD, DEMO_USERS } from './seedData.js';

export * from './seedData.js';

/** Demo users for each built-in role; all share DEMO_PASSWORD. */
export function seedUsers(users: UserDirectory): void {
  if (users.size > 0) return;
  const hash = hashPassword(DEMO_PASSWORD);
  for (const u of DEMO_USERS) users.add({ ...u, passwordHash: hash });
}
