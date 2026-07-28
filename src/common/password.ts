import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Hash de senha com scrypt (nativo do Node — sem dependências externas).
 * Formato armazenado: "<salt_hex>:<hash_hex>".
 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(plain, salt, 64);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = scryptSync(plain, salt, expected.length);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
