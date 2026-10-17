import type { PaymentMethod, ServiceProfile } from './types.js';

/** Off / optional / required switch used by parking spot and photo settings (SRS 2.7.1). */
export type Requirement = 'off' | 'optional' | 'required';

export interface Tariff {
  type: 'complimentary' | 'flat' | 'hourly';
  /** Flat fee, or rate per started hour, in the location currency. */
  rate: number;
  freeMinutes: number;
  /** Maximum charge per 24 hours for hourly tariffs. */
  dailyCap?: number;
}

/** The subset of the SRS settings catalogue (2.7.1) used by the data layer. */
export interface LocationSettings {
  spotText: Requirement;
  spotTextLabel: string;
  spotGps: Requirement;
  gpsMinAccuracyM: number;
  spotPhoto: Requirement;
  zoneSlotList: boolean;
  vehiclePhotos: Requirement;
  vehiclePhotoCount: number;
  handoverConfirmation: boolean;
  paymentMethods: Exclude<PaymentMethod, 'none'>[];
  paymentRequiredBeforeHandover: boolean;
  arrivalTimeRequest: boolean;
  arrivalOptionsMinutes: number[];
  maxScheduleHoursAhead: number;
  avgRetrievalMinutes: number;
  inAndOut: boolean;
  pauseFeeWhileOut: boolean;
  stayEndDateRequired: boolean;
  tariff: Tariff;
}

/** Catalogue defaults; the Custom profile starts from these. */
export const CATALOGUE_DEFAULTS: LocationSettings = {
  spotText: 'required',
  spotTextLabel: 'Parking spot / landmark',
  spotGps: 'off',
  gpsMinAccuracyM: 20,
  spotPhoto: 'off',
  zoneSlotList: false,
  vehiclePhotos: 'optional',
  vehiclePhotoCount: 4,
  handoverConfirmation: true,
  paymentMethods: ['payment_qr', 'cash'],
  paymentRequiredBeforeHandover: true,
  arrivalTimeRequest: true,
  arrivalOptionsMinutes: [5, 10, 15, 30],
  maxScheduleHoursAhead: 24,
  avgRetrievalMinutes: 8,
  inAndOut: false,
  pauseFeeWhileOut: false,
  stayEndDateRequired: false,
  tariff: { type: 'hourly', rate: 50, freeMinutes: 0 },
};

/** Profile defaults that differ from the catalogue (SRS 2.7.2). */
export const PROFILE_DEFAULTS: Record<ServiceProfile, Partial<LocationSettings>> = {
  paid_parking: {
    spotText: 'optional',
    spotTextLabel: 'Notes',
    zoneSlotList: true,
    vehiclePhotos: 'required',
    tariff: { type: 'hourly', rate: 50, freeMinutes: 10, dailyCap: 400 },
  },
  restaurant: {
    spotTextLabel: 'Landmark',
    spotGps: 'required',
    paymentRequiredBeforeHandover: false,
    tariff: { type: 'complimentary', rate: 0, freeMinutes: 0 },
  },
  hotel: {
    spotPhoto: 'optional',
    paymentRequiredBeforeHandover: false,
    inAndOut: true,
    stayEndDateRequired: true,
    tariff: { type: 'hourly', rate: 60, freeMinutes: 0, dailyCap: 500 },
  },
  event_venue: {
    spotTextLabel: 'Landmark',
    spotGps: 'required',
    vehiclePhotos: 'off',
    tariff: { type: 'flat', rate: 200, freeMinutes: 0 },
  },
  custom: {},
};

export function resolveSettings(profile: ServiceProfile, overrides: Partial<LocationSettings> = {}): LocationSettings {
  return structuredClone({ ...CATALOGUE_DEFAULTS, ...PROFILE_DEFAULTS[profile], ...overrides });
}

/** Returns configuration problems; empty when the settings are valid. */
export function validateSettings(s: LocationSettings): string[] {
  const errors: string[] = [];
  if (s.spotText === 'off' && s.spotGps === 'off' && s.spotPhoto === 'off' && !s.zoneSlotList) {
    errors.push('At least one of parking spot text, GPS, photo or zone/slot list must be on (FR-PARK-11).');
  }
  if (s.vehiclePhotoCount < 1 || s.vehiclePhotoCount > 8) errors.push('Vehicle photo count must be between 1 and 8.');
  if (s.gpsMinAccuracyM <= 0) errors.push('GPS minimum accuracy must be greater than 0 metres.');
  if (s.tariff.type !== 'complimentary' && s.paymentMethods.length === 0) errors.push('At least one payment method is required when a fee applies.');
  if (s.tariff.rate < 0 || s.tariff.freeMinutes < 0) errors.push('Tariff rate and free minutes cannot be negative.');
  if (s.tariff.type === 'flat' && s.inAndOut && s.pauseFeeWhileOut) errors.push('Pausing the fee while out only applies to hourly tariffs.');
  if (s.avgRetrievalMinutes < 0) errors.push('Average retrieval time cannot be negative.');
  return errors;
}
