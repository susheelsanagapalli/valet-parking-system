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

/** Operator's own payment QR (FR-PAY-15). Shown to guests only once a platform admin approves it. */
export interface PaymentQr {
  imageDataUrl: string;
  payeeName: string;
  status: 'pending_approval' | 'approved' | 'rejected';
  uploadedBy: string;
  reviewedBy?: string;
}

/** The subset of the SRS settings catalogue (2.7.1) used by the data layer. */
export interface LocationSettings {
  pickupPoints: string[];
  paymentQr?: PaymentQr;
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
  /** Days the guest link works after closure; photos are deleted then too (NFR-SEC-02, FR-DATA-08). */
  guestLinkExpiryDays: number;
  tariff: Tariff;
  /** Makes, models and colours attendants pick from at check-in, kept by admins. */
  vehicleCatalogue: VehicleCatalogue;
}

export interface VehicleMake {
  name: string;
  models: string[];
}

export interface VehicleCatalogue {
  makes: VehicleMake[];
  colours: string[];
  /** Adds "Other" to each list, with a text field, for cars not in the list. */
  allowOther: boolean;
}

/** A starting list of common makes and models in India; admins edit it per location. */
export const DEFAULT_VEHICLE_CATALOGUE: VehicleCatalogue = {
  makes: [
    { name: 'Maruti Suzuki', models: ['Alto', 'Baleno', 'Brezza', 'Celerio', 'Ciaz', 'Dzire', 'Ertiga', 'Fronx', 'Grand Vitara', 'Swift', 'Wagon R', 'XL6'] },
    { name: 'Hyundai', models: ['Alcazar', 'Aura', 'Creta', 'Exter', 'i10', 'i20', 'Tucson', 'Venue', 'Verna'] },
    { name: 'Tata', models: ['Altroz', 'Harrier', 'Nexon', 'Punch', 'Safari', 'Tiago', 'Tigor'] },
    { name: 'Mahindra', models: ['Bolero', 'Scorpio', 'Thar', 'XUV 3XO', 'XUV700'] },
    { name: 'Toyota', models: ['Camry', 'Fortuner', 'Glanza', 'Hyryder', 'Innova', 'Innova Hycross'] },
    { name: 'Honda', models: ['Amaze', 'City', 'Elevate'] },
    { name: 'Kia', models: ['Carens', 'Carnival', 'Seltos', 'Sonet'] },
    { name: 'MG', models: ['Astor', 'Comet', 'Hector', 'Windsor', 'ZS EV'] },
    { name: 'Skoda', models: ['Kushaq', 'Kylaq', 'Slavia', 'Superb'] },
    { name: 'Volkswagen', models: ['Taigun', 'Tiguan', 'Virtus'] },
    { name: 'Renault', models: ['Kiger', 'Kwid', 'Triber'] },
    { name: 'Nissan', models: ['Magnite'] },
    { name: 'BMW', models: ['3 Series', '5 Series', '7 Series', 'X1', 'X3', 'X5', 'X7'] },
    { name: 'Mercedes-Benz', models: ['A-Class', 'C-Class', 'E-Class', 'GLA', 'GLC', 'GLE', 'GLS', 'S-Class'] },
    { name: 'Audi', models: ['A4', 'A6', 'Q3', 'Q5', 'Q7'] },
  ],
  colours: ['White', 'Black', 'Silver', 'Grey', 'Red', 'Blue', 'Brown', 'Beige', 'Green', 'Orange', 'Yellow'],
  allowOther: true,
};

/** Catalogue defaults; the Custom profile starts from these. */
export const CATALOGUE_DEFAULTS: LocationSettings = {
  pickupPoints: ['Main entrance'],
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
  guestLinkExpiryDays: 7,
  tariff: { type: 'hourly', rate: 50, freeMinutes: 0 },
  vehicleCatalogue: DEFAULT_VEHICLE_CATALOGUE,
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
  if (s.pickupPoints.length === 0) errors.push('At least one pickup point is required.');
  if (s.paymentQr && !/^data:image\/(png|jpeg);base64,/.test(s.paymentQr.imageDataUrl)) errors.push('Payment QR must be a PNG or JPEG image.');
  if (s.paymentQr && s.paymentQr.imageDataUrl.length > 45_000) errors.push('Payment QR image is too large; use an image under 30 KB.');
  errors.push(...validateVehicleCatalogue(s.vehicleCatalogue));
  return errors;
}

const names = (list: string[]) => list.map((n) => n.trim().toLowerCase());
const hasDuplicates = (list: string[]) => new Set(names(list)).size !== list.length;

function validateVehicleCatalogue(c: VehicleCatalogue): string[] {
  const errors: string[] = [];
  if (c.makes.length > 100) errors.push('The vehicle list can have at most 100 makes.');
  if (c.colours.length > 50) errors.push('The vehicle list can have at most 50 colours.');
  const all = [...c.makes.map((m) => m.name), ...c.makes.flatMap((m) => m.models), ...c.colours];
  if (all.some((n) => n.trim().length === 0 || n.length > 40)) errors.push('Vehicle makes, models and colours must be 1–40 characters.');
  if (hasDuplicates(c.makes.map((m) => m.name))) errors.push('Each vehicle make can only be listed once.');
  if (hasDuplicates(c.colours)) errors.push('Each colour can only be listed once.');
  for (const m of c.makes) {
    if (m.models.length > 100) errors.push(`${m.name}: at most 100 models.`);
    if (hasDuplicates(m.models)) errors.push(`${m.name}: each model can only be listed once.`);
  }
  if (!c.allowOther && c.makes.length === 0) errors.push('Add at least one make, or allow "Other" so attendants can type it.');
  return errors;
}

/** Whether a make, model and colour can be used at check-in under this list (case-insensitive). */
export function vehicleProblem(c: VehicleCatalogue, v: { make?: string; model?: string; colour?: string }): string | null {
  if (c.allowOther) return null;
  const is = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const make = v.make ? c.makes.find((m) => is(m.name, v.make!)) : undefined;
  if (v.make && !make) return `"${v.make}" is not in this location's list of makes`;
  if (v.model && (!make || !make.models.some((m) => is(m, v.model!)))) return `"${v.model}" is not in the list of ${make?.name ?? 'models'}`;
  if (v.colour && !c.colours.some((x) => is(x, v.colour!))) return `"${v.colour}" is not in this location's list of colours`;
  return null;
}
