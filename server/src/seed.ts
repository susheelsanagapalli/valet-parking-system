import type { ValetSheetsRepository } from '@valet/sheets-integration';
import { hashPassword, type StaffUser, type UserDirectory } from './auth.js';

export const DEMO_PASSWORD = 'valet123';

/** Demo locations, one per main service profile, when the store is empty. */
export function seedLocations(repo: ValetSheetsRepository): void {
  if (repo.listLocations().length > 0) return;
  repo.createLocation({ name: 'Spice Garden Restaurant', address: '12 MG Road, Bengaluru', serviceProfile: 'restaurant', appName: 'ValetPay', ticketPrefix: 'SG', createdBy: 'seed' });
  repo.createLocation({
    name: 'City Centre Parking',
    address: '1 Station Road, Bengaluru',
    serviceProfile: 'paid_parking',
    appName: 'ValetPay',
    ticketPrefix: 'CC',
    settingsOverrides: { vehiclePhotos: 'optional' },
    createdBy: 'seed',
  });
  repo.createLocation({ name: 'Grand Palace Hotel', address: '5 Palace Road, Bengaluru', serviceProfile: 'hotel', appName: 'ValetPay', ticketPrefix: 'GP', createdBy: 'seed' });
}

/** Demo users for each built-in role; all share DEMO_PASSWORD. */
export function seedUsers(users: UserDirectory): void {
  if (users.size > 0) return;
  const hash = hashPassword(DEMO_PASSWORD);
  const demo: Array<Omit<StaffUser, 'passwordHash'>> = [
    { id: 'u-platform', username: 'platform', name: 'Platform Admin', role: 'platform_admin', locations: 'all' },
    { id: 'u-admin', username: 'admin', name: 'Operator Admin', role: 'operator_admin', locations: 'all' },
    { id: 'u-supervisor', username: 'supervisor', name: 'Shift Supervisor', role: 'supervisor', locations: 'all' },
    { id: 'u-attendant', username: 'attendant', name: 'Ravi (Attendant)', role: 'attendant', locations: 'all' },
    { id: 'u-attendant2', username: 'attendant2', name: 'Meena (Attendant)', role: 'attendant', locations: 'all' },
  ];
  for (const u of demo) users.add({ ...u, passwordHash: hash });
}
