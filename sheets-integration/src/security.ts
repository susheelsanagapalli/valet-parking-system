import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

/** Unguessable token encoded in the ticket QR (NFR-SEC-02). */
export function newQrToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Random 4-digit handover PIN, returned once to be sent to the guest; never stored in plain form. */
export function newHandoverPin(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}

/**
 * Keyed hash of a handover PIN (NFR-SEC-01). The ticket id is mixed in so equal PINs on different
 * tickets give different hashes, and the secret stays with the backend, so viewers of the
 * spreadsheet cannot recover a PIN by trying all 10,000 values.
 */
export function hashPin(secret: string, ticketId: string, pin: string): string {
  return createHmac('sha256', secret).update(`${ticketId}:${pin}`).digest('hex');
}

export function verifyPin(secret: string, ticketId: string, pin: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPin(secret, ticketId, pin), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Shows only the last 4 digits of a mobile number (NFR-PRIV-01). */
export function maskMobile(mobile: string | null): string | null {
  if (!mobile) return mobile;
  const digits = mobile.replace(/\D/g, '');
  return digits.length <= 4 ? '••••' : `••••••${digits.slice(-4)}`;
}

export function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
