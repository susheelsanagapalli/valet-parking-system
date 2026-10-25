/** Letters and digits that can't be confused when read out or copied by hand (no 0/O, 1/l/I). */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A random starting password for an admin to hand over, in groups of four: "Hk7m-pQ2x-9rWb". */
export function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export const MIN_PASSWORD_LENGTH = 10;
