import 'server-only';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id password hashing.
 *
 * Parameters follow the current OWASP recommendation for Argon2id:
 *   m = 19456 KiB (19 MiB), t = 2, p = 1
 * These are also the library defaults; they are written out explicitly so a
 * future library default change cannot silently weaken stored hashes.
 *
 * `@node-rs/argon2` is used rather than the `argon2` package because it ships
 * prebuilt binaries and so survives a Vercel serverless build. It is declared
 * in `serverExternalPackages` (next.config.ts) to keep the native binding out
 * of the bundle.
 */

const OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  // algorithm defaults to Argon2id (2). Not imported: it is a `const enum`,
  // which cannot be imported under `isolatedModules`.
} as const;

/**
 * Upper bound on password byte length before passing to Argon2id.
 * Prevents CPU/memory exhaustion (DoS) via multi-megabyte password strings.
 */
export const MAX_PASSWORD_BYTES = 128;

export async function hashPassword(plain: string): Promise<string> {
  if (Buffer.byteLength(plain, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error(`Password exceeds maximum length of ${MAX_PASSWORD_BYTES} bytes.`);
  }
  return hash(plain, OPTIONS);
}

/**
 * Returns false rather than throwing on a malformed stored hash or oversized
 * input, so a corrupt row or oversized payload cannot be distinguished from a
 * wrong password by error text or cause an Argon2 DoS.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  if (Buffer.byteLength(plain, 'utf8') > MAX_PASSWORD_BYTES) {
    return false;
  }
  try {
    return await verify(storedHash, plain, OPTIONS);
  } catch {
    return false;
  }
}

/**
 * A real Argon2id hash of a value nobody knows, used to burn the same time on
 * a login for an account that does not exist.
 *
 * Without this, an unknown email returns in a millisecond while a known one
 * spends ~100ms in Argon2 — a timing oracle that enumerates staff addresses
 * just as effectively as a distinct error message would, which is precisely
 * what the single generic message exists to prevent.
 *
 * Computed once, lazily: hashing on module load would cost every cold start.
 */
let decoyHash: Promise<string> | null = null;

export function burnPasswordTime(plain: string): Promise<boolean> {
  const bounded = plain.slice(0, MAX_PASSWORD_BYTES);
  decoyHash ??= hashPassword(`decoy:${Math.random()}:${Date.now()}`);
  return decoyHash.then((stored) => verifyPassword(stored, bounded));
}
