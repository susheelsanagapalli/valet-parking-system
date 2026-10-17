import type { LocationSettings } from '../src/settings.js';
import { MemorySheetStore } from '../src/store/MemorySheetStore.js';
import type { ServiceProfile } from '../src/types.js';
import { ValetSheetsRepository } from '../src/ValetSheetsRepository.js';

export class Clock {
  constructor(public current = new Date('2026-10-17T12:00:00.000Z')) {}
  now = (): Date => new Date(this.current);
  advance(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

export async function setup(profile: ServiceProfile = 'paid_parking', overrides: Partial<LocationSettings> = {}) {
  const store = new MemorySheetStore();
  const clock = new Clock();
  const repo = new ValetSheetsRepository({ store, pinSecret: 'test-secret', flushIntervalMs: 0, now: clock.now });
  await repo.load();
  const location = repo.createLocation({
    name: 'Test Location',
    serviceProfile: profile,
    appName: 'ValetPay',
    ticketPrefix: 'TL',
    settingsOverrides: overrides,
    createdBy: 'admin',
  });
  return { store, clock, repo, location };
}

export const FOUR_PHOTOS = ['p1', 'p2', 'p3', 'p4'];
