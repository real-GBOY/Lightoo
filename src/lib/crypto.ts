import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ConfigError } from './errors';

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, n: number) => Promise<Buffer>;

function key(raw = process.env.TOKEN_ENCRYPTION_KEY): Buffer {
  const k = Buffer.from(raw ?? '', 'base64');
  if (k.length !== 32) throw ConfigError('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded.');
  return k;
}

/** AES-256-GCM. Output: base64url(iv[12] | tag[16] | ciphertext). */
export function encrypt(plain: string, rawKey?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(rawKey), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

export function decrypt(blob: string, rawKey?: string): string {
  const b = Buffer.from(blob, 'base64url');
  const d = createDecipheriv('aes-256-gcm', key(rawKey), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

/** Password hash format: scrypt:<salt b64url>:<hash b64url>. ':' (not '$') so .env loaders never expand it. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, 64);
  return `scrypt:${salt.toString('base64url')}:${h.toString('base64url')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, h] = stored.split(':');
  if (alg !== 'scrypt' || !s || !h) return false;
  const expected = Buffer.from(h, 'base64url');
  const actual = await scrypt(pw, Buffer.from(s, 'base64url'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
