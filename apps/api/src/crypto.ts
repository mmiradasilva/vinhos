import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Keys derived from SESSION_SECRET, one per purpose. */
export interface Keys {
  cookie: Buffer;
  cursor: Buffer;
}

export function deriveKeys(secret: Buffer): Keys {
  const derive = (label: string) => createHmac('sha256', secret).update(label).digest();
  return { cookie: derive('cookie-encryption'), cursor: derive('cursor-signing') };
}

/** Encrypts and authenticates a JSON value (AES-256-GCM) for use in a cookie. */
export function seal(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function unseal<T>(sealed: string | undefined, key: Buffer): T | null {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/** Signed, opaque token (used for list cursors). */
export function sign(value: unknown, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  const mac = createHmac('sha256', key).update(body).digest('base64url').slice(0, 22);
  return `${body}.${mac}`;
}

export function verify<T>(token: string, key: Buffer): T | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', key).update(body).digest('base64url').slice(0, 22);
  if (!safeEqual(mac, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
