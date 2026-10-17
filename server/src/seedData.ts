/** Demo data shared by the server and the in-browser demo (no Node.js dependencies). */
import type { ValetSheetsRepository } from '@valet/sheets-integration';
import type { StaffUser } from './permissions.js';

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

/** Two parked cars so testers can open a guest page straight away. Returns ticket id → handover PIN. */
export async function seedTickets(repo: ValetSheetsRepository): Promise<Map<string, string>> {
  const pins = new Map<string, string>();
  const locations = repo.listLocations();
  if (locations.some((l) => repo.listTickets(l.id).length > 0)) return pins;
  const restaurant = locations.find((l) => l.service_profile === 'restaurant');
  const paid = locations.find((l) => l.service_profile === 'paid_parking');
  if (restaurant) {
    const { ticket, handoverPin } = await repo.checkIn({ locationId: restaurant.id, attendantId: 'seed', plateNumber: 'KA03TT1001', keyTag: 'K-21', guestMobile: '+919800000001', guestName: 'Test Guest', make: 'Honda', model: 'City', colour: 'Silver' });
    await repo.recordParkingSpot(ticket.id, { attendantId: 'seed', text: 'Near the side gate', gps: { lat: 12.9759, lng: 77.6046, accuracyM: 6 } });
    pins.set(ticket.id, handoverPin);
  }
  if (paid) {
    const { ticket, handoverPin } = await repo.checkIn({ locationId: paid.id, attendantId: 'seed', plateNumber: 'KA03TT2002', keyTag: 'K-22', guestMobile: '+919800000002', make: 'Tata', model: 'Nexon', colour: 'Blue' });
    await repo.recordParkingSpot(ticket.id, { attendantId: 'seed', zoneCode: 'B2', slotNumber: '14' });
    pins.set(ticket.id, handoverPin);
  }
  return pins;
}

/** Demo staff for each built-in role; all share DEMO_PASSWORD. */
export const DEMO_USERS: Array<Omit<StaffUser, 'passwordHash'>> = [
  { id: 'u-platform', username: 'platform', name: 'Platform Admin', role: 'platform_admin', locations: 'all' },
  { id: 'u-admin', username: 'admin', name: 'Operator Admin', role: 'operator_admin', locations: 'all' },
  { id: 'u-supervisor', username: 'supervisor', name: 'Shift Supervisor', role: 'supervisor', locations: 'all' },
  { id: 'u-attendant', username: 'attendant', name: 'Ravi (Attendant)', role: 'attendant', locations: 'all' },
  { id: 'u-attendant2', username: 'attendant2', name: 'Meena (Attendant)', role: 'attendant', locations: 'all' },
];
