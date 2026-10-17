import { describe, expect, it } from 'vitest';
import { ValetError } from '../src/errors.js';
import { ValetSheetsRepository } from '../src/ValetSheetsRepository.js';
import { FOUR_PHOTOS, setup } from './helpers.js';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ValetError ? e.code : String(e);
  }
  return undefined;
}

async function codeAsync(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (e) {
    return e instanceof ValetError ? e.code : String(e);
  }
  return undefined;
}

describe('paid parking lifecycle', () => {
  it('checks in, parks, retrieves, takes cash and closes', async () => {
    const { repo, store, clock, location } = await setup('paid_parking');
    const { ticket, handoverPin, parkTask } = await repo.checkIn({
      locationId: location.id,
      attendantId: 'att-1',
      plateNumber: 'ka 01 ab 1234',
      keyTag: 'K-1',
      guestMobile: '+919876543210',
      guestName: 'Asha',
      vehiclePhotoRefs: FOUR_PHOTOS,
    });
    expect(ticket.ticket_number).toBe('TL0001');
    expect(handoverPin).toMatch(/^\d{4}$/);
    expect(ticket.handover_pin_hash).not.toContain(handoverPin);
    expect(parkTask.assigned_to).toBe('att-1');

    await repo.recordParkingSpot(ticket.id, { attendantId: 'att-1', zoneCode: 'B2', slotNumber: '14' });
    clock.advance(95);
    const { task } = repo.requestRetrieval(ticket.id, { requestedBy: 'guest', pickupPoint: 'Main gate' });
    // 95 min − 10 free = 85 billable → 2 started hours × 50
    expect(repo.getTicketDetails(ticket.id).ticket.fee_amount).toBe(100);

    expect(repo.listQueue(location.id).map((t) => t.id)).toEqual([task.id]);
    await repo.acceptTask(task.id, 'att-2');
    repo.markReady(ticket.id, 'att-2');

    expect(repo.verifyGuest(ticket.id, { pin: handoverPin })).toBe(true);
    expect(repo.verifyGuest(ticket.id, { pin: handoverPin === '0000' ? '1111' : '0000' })).toBe(false);
    expect(repo.verifyGuest(ticket.id, { qrToken: ticket.qr_token })).toBe(true);

    expect(code(() => repo.handover(ticket.id, { attendantId: 'att-2', confirmation: { result: 'no_damage', method: 'ticket_page' } }))).toBe('BALANCE_DUE');
    repo.recordPayment(ticket.id, { method: 'cash', amount: 100, recordedBy: 'att-2' });
    expect(code(() => repo.handover(ticket.id, { attendantId: 'att-2' }))).toBe('CONFIRMATION_REQUIRED');
    const closed = repo.handover(ticket.id, { attendantId: 'att-2', confirmation: { result: 'no_damage', method: 'ticket_page' } });
    expect(closed.status).toBe('closed');

    await repo.flush();
    const sheetTicket = store.tabs.get('Tickets')?.[0];
    expect(sheetTicket?.status).toBe('closed');
    expect(sheetTicket).not.toHaveProperty('plate_number');
    expect(store.tabs.get('Vehicles')?.[0]?.plate_number).toBe('KA01AB1234');
    expect(store.tabs.get('AuditLog')?.length).toBeGreaterThan(10);
  });

  it('reloads the same state from the store', async () => {
    const { repo, store, location } = await setup('paid_parking');
    const { ticket } = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'MH12XY9', keyTag: 'K', vehiclePhotoRefs: FOUR_PHOTOS });
    await repo.flush();
    const reloaded = new ValetSheetsRepository({ store, pinSecret: 'test-secret', flushIntervalMs: 0 });
    await reloaded.load();
    expect(reloaded.getTicketDetails(ticket.id).vehicle?.plate_number).toBe('MH12XY9');
  });

  it('requires the configured vehicle photos and a key tag', async () => {
    const { repo, location } = await setup('paid_parking');
    await expect(repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'X1', keyTag: 'K', vehiclePhotoRefs: ['p1'] })).rejects.toThrow(/vehicle photos/);
    await expect(repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'X1', keyTag: ' ', vehiclePhotoRefs: FOUR_PHOTOS })).rejects.toThrow(/Key tag/);
  });

  it('prevents two cars in one slot', async () => {
    const { repo, location } = await setup('paid_parking');
    const a = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'A1', keyTag: 'K1', vehiclePhotoRefs: FOUR_PHOTOS });
    const b = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'B1', keyTag: 'K2', vehiclePhotoRefs: FOUR_PHOTOS });
    await repo.recordParkingSpot(a.ticket.id, { attendantId: 'a', zoneCode: 'Z', slotNumber: '1' });
    expect(await codeAsync(() => repo.recordParkingSpot(b.ticket.id, { attendantId: 'a', zoneCode: 'Z', slotNumber: '1' }))).toBe('SLOT_OCCUPIED');
  });

  it('gives a task to only one attendant', async () => {
    const { repo, location } = await setup('paid_parking');
    const { ticket } = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'A1', keyTag: 'K1', vehiclePhotoRefs: FOUR_PHOTOS });
    await repo.recordParkingSpot(ticket.id, { attendantId: 'a', zoneCode: 'Z', slotNumber: '1' });
    const { task } = repo.requestRetrieval(ticket.id, { requestedBy: 'guest' });
    const results = await Promise.allSettled([repo.acceptTask(task.id, 'att-1'), repo.acceptTask(task.id, 'att-2')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('lets the guest cancel only before acceptance', async () => {
    const { repo, location } = await setup('paid_parking');
    const { ticket } = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'A1', keyTag: 'K1', vehiclePhotoRefs: FOUR_PHOTOS });
    await repo.recordParkingSpot(ticket.id, { attendantId: 'a', zoneCode: 'Z', slotNumber: '1' });
    repo.requestRetrieval(ticket.id, { requestedBy: 'guest' });
    expect(repo.cancelRetrieval(ticket.id, 'guest').status).toBe('parked');
    const { task } = repo.requestRetrieval(ticket.id, { requestedBy: 'guest' });
    await repo.acceptTask(task.id, 'att-1');
    expect(code(() => repo.cancelRetrieval(ticket.id, 'guest'))).toBe('INVALID_STATE');
  });

  it('numbers tickets sequentially under concurrent check-ins', async () => {
    const { repo, location } = await setup('paid_parking');
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: `P${n}`, keyTag: `K${n}`, vehiclePhotoRefs: FOUR_PHOTOS })),
    );
    expect(results.map((r) => r.ticket.ticket_number).sort()).toEqual(['TL0001', 'TL0002', 'TL0003', 'TL0004', 'TL0005']);
  });
});

describe('parking spot capture settings', () => {
  it('restaurant: landmark + GPS required, text fallback when GPS is weak', async () => {
    const { repo, location } = await setup('restaurant');
    const make = async (plate: string) => (await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: plate, keyTag: plate })).ticket;

    const good = await make('R1');
    const ok = await repo.recordParkingSpot(good.id, { attendantId: 'a', text: 'Opposite gate 3', gps: { lat: 12.97, lng: 77.6, accuracyM: 6 } });
    expect(ok.warnings).toEqual([]);
    expect(ok.ticket.spot_gps_accuracy).toBe(6);

    const weak = await make('R2');
    expect(await codeAsync(() => repo.recordParkingSpot(weak.id, { attendantId: 'a', gps: { lat: 1, lng: 1, accuracyM: 60 } }))).toBe('INVALID_INPUT');
    const fallback = await repo.recordParkingSpot(weak.id, { attendantId: 'a', text: 'Basement, pillar 4', gps: { lat: 1, lng: 1, accuracyM: 60 } });
    expect(fallback.warnings[0]).toMatch(/accuracy/);
  });

  it('GPS only: the text field appears when there is no position', async () => {
    const { repo, location } = await setup('custom', { spotText: 'off', spotGps: 'required' });
    const { ticket } = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'G1', keyTag: 'K' });
    expect(await codeAsync(() => repo.recordParkingSpot(ticket.id, { attendantId: 'a' }))).toBe('INVALID_INPUT');
    const result = await repo.recordParkingSpot(ticket.id, { attendantId: 'a', text: 'Level -2' });
    expect(result.warnings[0]).toMatch(/No GPS/);
  });

  it('all optional: at least one item must be recorded', async () => {
    const { repo, location } = await setup('custom', { spotText: 'optional', spotPhoto: 'optional' });
    const { ticket } = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'O1', keyTag: 'K' });
    expect(await codeAsync(() => repo.recordParkingSpot(ticket.id, { attendantId: 'a' }))).toBe('INVALID_INPUT');
    const parked = await repo.recordParkingSpot(ticket.id, { attendantId: 'a', spotPhotoRef: 'drive-file-1' });
    expect(parked.ticket.status).toBe('parked');
  });

  it('rejects settings with every capture item off', async () => {
    const { repo, location } = await setup('custom');
    expect(code(() => repo.updateLocationSettings(location.id, { spotText: 'off' }, 'admin'))).toBe('INVALID_SETTINGS');
  });

  it('keeps the settings version of open tickets', async () => {
    const { repo, location } = await setup('custom');
    const { ticket } = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'V1', keyTag: 'K' });
    repo.updateLocationSettings(location.id, { spotText: 'off', spotPhoto: 'required' }, 'admin');
    const parked = await repo.recordParkingSpot(ticket.id, { attendantId: 'a', text: 'Row C' });
    expect(parked.ticket.settings_version).toBe(1);
  });
});

describe('arrival-time requests', () => {
  it('releases the task so the car is ready on arrival', async () => {
    const { repo, clock, location } = await setup('restaurant', { avgRetrievalMinutes: 8 });
    const { ticket } = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'T1', keyTag: 'K' });
    await repo.recordParkingSpot(ticket.id, { attendantId: 'a', text: 'Lane 2', gps: { lat: 1, lng: 1, accuracyM: 5 } });
    const { task } = repo.requestRetrieval(ticket.id, { requestedBy: 'guest', arriveInMinutes: 20 });
    expect(repo.listQueue(location.id)).toHaveLength(0);
    await expect(repo.acceptTask(task.id, 'att')).rejects.toThrow(/not released/);
    clock.advance(12);
    expect(repo.listQueue(location.id).map((t) => t.id)).toEqual([task.id]);
  });

  it('"I\'m here" brings the task forward', async () => {
    const { repo, location } = await setup('restaurant');
    const { ticket } = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'T2', keyTag: 'K' });
    await repo.recordParkingSpot(ticket.id, { attendantId: 'a', text: 'Lane 2', gps: { lat: 1, lng: 1, accuracyM: 5 } });
    repo.requestRetrieval(ticket.id, { requestedBy: 'guest', arriveInMinutes: 30 });
    expect(repo.listQueue(location.id)).toHaveLength(0);
    repo.updateArrival(ticket.id, { arrivedNow: true, by: 'guest' });
    expect(repo.listQueue(location.id)).toHaveLength(1);
  });

  it('rejects arrivals beyond the scheduling limit', async () => {
    const { repo, location } = await setup('restaurant');
    const { ticket } = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'T3', keyTag: 'K' });
    await repo.recordParkingSpot(ticket.id, { attendantId: 'a', text: 'Lane 2', gps: { lat: 1, lng: 1, accuracyM: 5 } });
    expect(code(() => repo.requestRetrieval(ticket.id, { requestedBy: 'guest', arriveInMinutes: 25 * 60 }))).toBe('INVALID_INPUT');
  });
});

describe('QR payments', () => {
  it('keeps a QR payment pending until staff verify it', async () => {
    const { repo, location } = await setup('event_venue');
    const { ticket } = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'E1', keyTag: 'K' });
    await repo.recordParkingSpot(ticket.id, { attendantId: 'a', text: 'Field A', gps: { lat: 1, lng: 1, accuracyM: 4 } });
    const { task } = repo.requestRetrieval(ticket.id, { requestedBy: 'guest' });
    const payment = repo.recordPayment(ticket.id, { method: 'payment_qr', amount: 200, transactionReference: '425931234567', recordedBy: 'guest' });
    expect(payment.status).toBe('pending');
    expect(repo.balanceDue(ticket.id)).toBe(200);
    expect(repo.dashboard(location.id).pendingPayments).toBe(1);

    await repo.acceptTask(task.id, 'att');
    repo.markReady(ticket.id, 'att');
    const confirmation = { result: 'no_damage' as const, method: 'ticket_page' as const };
    expect(code(() => repo.handover(ticket.id, { attendantId: 'att', confirmation }))).toBe('BALANCE_DUE');
    repo.verifyPayment(payment.id, 'verified', 'sup-1');
    expect(repo.balanceDue(ticket.id)).toBe(0);
    expect(repo.handover(ticket.id, { attendantId: 'att', confirmation }).status).toBe('closed');
  });

  it('rejects payment methods the location does not accept', async () => {
    const { repo, location } = await setup('event_venue');
    const { ticket } = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'E2', keyTag: 'K' });
    expect(code(() => repo.recordPayment(ticket.id, { method: 'card_terminal', amount: 200, recordedBy: 'a' }))).toBe('INVALID_INPUT');
  });

  it('allows release with a balance only with supervisor approval', async () => {
    const { repo, location } = await setup('event_venue');
    const { ticket } = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'E3', keyTag: 'K' });
    await repo.recordParkingSpot(ticket.id, { attendantId: 'a', text: 'Field B', gps: { lat: 1, lng: 1, accuracyM: 4 } });
    const { task } = repo.requestRetrieval(ticket.id, { requestedBy: 'guest' });
    await repo.acceptTask(task.id, 'att');
    repo.markReady(ticket.id, 'att');
    const closed = repo.handover(ticket.id, { attendantId: 'att', confirmation: { result: 'no_damage', method: 'signature' }, supervisorApprovalBy: 'sup-1' });
    expect(closed.status).toBe('closed');
  });
});

describe('hotel in-and-out', () => {
  it('goes out, returns, and closes at the end of the stay', async () => {
    const { repo, clock, location } = await setup('hotel');
    await expect(repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'H1', keyTag: 'K' })).rejects.toThrow(/Stay end date/);
    const { ticket } = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'H1', keyTag: 'K', stayEndDate: '2026-10-19' });
    expect(ticket.is_in_and_out).toBe(true);
    await repo.recordParkingSpot(ticket.id, { attendantId: 'a', text: 'P1 row 3' });

    const confirmation = { result: 'no_damage' as const, method: 'ticket_page' as const };
    let { task } = repo.requestRetrieval(ticket.id, { requestedBy: 'guest' });
    await repo.acceptTask(task.id, 'att');
    repo.markReady(ticket.id, 'att');
    expect(repo.handover(ticket.id, { attendantId: 'att', confirmation }).status).toBe('out');

    clock.advance(120);
    expect(repo.returnFromOut(ticket.id, 'att').ticket.status).toBe('checked_in');
    await repo.recordParkingSpot(ticket.id, { attendantId: 'att', text: 'P2 row 1' });

    clock.advance(60 * 20);
    ({ task } = repo.requestRetrieval(ticket.id, { requestedBy: 'guest' }));
    await repo.acceptTask(task.id, 'att');
    repo.markReady(ticket.id, 'att');
    const closed = repo.handover(ticket.id, { attendantId: 'att', confirmation, endOfStay: true });
    expect(closed.status).toBe('closed');
    expect(repo.exportRows().TicketMovements).toHaveLength(2);
  });

  it('damage reported at handover opens an incident', async () => {
    const { repo, location } = await setup('restaurant');
    const { ticket } = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'D1', keyTag: 'K' });
    await repo.recordParkingSpot(ticket.id, { attendantId: 'a', text: 'Lane 1', gps: { lat: 1, lng: 1, accuracyM: 5 } });
    const { task } = repo.requestRetrieval(ticket.id, { requestedBy: 'guest' });
    await repo.acceptTask(task.id, 'att');
    repo.markReady(ticket.id, 'att');
    repo.handover(ticket.id, { attendantId: 'att', confirmation: { result: 'damage_reported', method: 'ticket_page', damageDescription: 'Dent on door' } });
    const incidents = repo.exportRows().Incidents ?? [];
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.description).toBe('Dent on door');
  });
});

describe('privacy', () => {
  it('masks the mobile number unless allowed', async () => {
    const { repo, location } = await setup('restaurant');
    const { ticket } = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'M1', keyTag: 'K', guestMobile: '+919876543210' });
    expect(repo.getTicketDetails(ticket.id).customer?.mobile).toBe('••••••3210');
    expect(repo.getTicketDetails(ticket.id, { showFullMobile: true }).customer?.mobile).toBe('+919876543210');
  });

  it('finds tickets by plate, mobile and number', async () => {
    const { repo, location } = await setup('restaurant');
    const { ticket } = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'KA05MN7788', keyTag: 'K', guestMobile: '+919812345678' });
    expect(repo.searchTickets(location.id, 'ka05 mn').map((t) => t.id)).toEqual([ticket.id]);
    expect(repo.searchTickets(location.id, '5678').map((t) => t.id)).toEqual([ticket.id]);
    expect(repo.searchTickets(location.id, ticket.ticket_number).map((t) => t.id)).toEqual([ticket.id]);
  });
});
