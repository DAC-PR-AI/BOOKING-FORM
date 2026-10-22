import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * AES-256-GCM encryption for regulated personal fields (PAN, Aadhaar).
 *
 * Stored layout:  [ IV (12 bytes) | auth tag (16 bytes) | ciphertext ]
 *
 * Rules this module exists to enforce (PLAN.md §6, brief §3):
 *   * Plaintext PAN/Aadhaar is NEVER written to the database, logs, or the
 *     Google Sheet mirror — only ciphertext plus a last-4 for display.
 *   * Every decrypt is a deliberate call. There is no automatic unwrapping on
 *     read, so a `VIEW_SENSITIVE` audit entry cannot be forgotten by accident.
 *
 * Server-side only in practice (it is imported exclusively from server code),
 * but deliberately free of `server-only` and of the env module so that the
 * cryptography can be unit tested.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const ALGORITHM = 'aes-256-gcm';

function key(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('FIELD_ENCRYPTION_KEY is not set.');
  }

  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `FIELD_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${buf.length}.`,
    );
  }

  return buf;
}

export function encryptField(plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

/** Throws if the payload was tampered with — GCM authentication failure. */
export function decryptField(payload: Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);

  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error('Encrypted field is malformed: payload too short.');
  }

  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Last 4 characters, for lists and tables — the only form safe to render by default. */
export function last4(value: string): string {
  return value.slice(-4);
}

/** `XXXXXXXX1234` — masked display built from the stored last-4 alone. */
export function maskWithLast4(suffix: string, totalLength: number): string {
  return `${'X'.repeat(Math.max(0, totalLength - suffix.length))}${suffix}`;
}

/** Constant-time compare, for verifying a re-entered sensitive value. */
export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
