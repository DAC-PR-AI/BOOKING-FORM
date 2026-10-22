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

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

/**
 * Returns false rather than throwing on a malformed stored hash, so a corrupt
 * row cannot be distinguished from a wrong password by timing or by error text.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, OPTIONS);
  } catch {
    return false;
  }
}
