import { randomBytes, scrypt as callbackScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(callbackScrypt);
const KEY_LENGTH = 64;

// Versioned format so future password migrations are possible.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(32).toString('hex');
  const key = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$v1$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, version, salt, hex] = encoded.split('$');
  if (algorithm !== 'scrypt' || version !== 'v1' || !salt || !hex || !/^[0-9a-f]{128}$/.test(hex)) {
    return false;
  }
  const actual = Buffer.from(hex, 'hex');
  const candidate = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return actual.length === candidate.length && timingSafeEqual(actual, candidate);
}
