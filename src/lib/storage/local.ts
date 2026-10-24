import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat as fsStat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { SignedUpload, StorageDriver, StoredObject } from './types';
import { isSafeKey } from './keys';

/**
 * Filesystem storage driver — development and self-hosting.
 *
 * Why this exists rather than pointing development at a cloud bucket:
 *
 *   * No secret is needed to run the app. A new developer clones, installs,
 *     seeds and uploads, with nothing to request from anyone.
 *   * Nothing regulated leaves the machine during development, which is the
 *     same rule production follows, enforced the strongest possible way.
 *
 * It is NOT suitable for Vercel: serverless filesystems are ephemeral and not
 * shared between invocations, so an upload would vanish. `assertUsable()`
 * refuses to let it start in production, where that failure would look like
 * data loss rather than a misconfiguration.
 *
 * Files live OUTSIDE the repository (default `../dac-storage`) so an upload
 * can never be committed or served as a static asset.
 */

const STORAGE_ROOT = resolve(
  process.env.LOCAL_STORAGE_DIR ?? resolve(process.cwd(), '..', 'dac-storage'),
);

/**
 * Resolves a key under the storage root and proves it stayed there.
 * `isSafeKey` already rejects traversal; this re-checks the resolved path
 * because the consequence of a mistake is an arbitrary file write.
 */
function absolutePathFor(key: string): string {
  if (!isSafeKey(key)) {
    throw new Error('Unsafe storage key.');
  }

  const full = resolve(join(STORAGE_ROOT, key));
  if (full !== STORAGE_ROOT && !full.startsWith(STORAGE_ROOT + sep)) {
    throw new Error('Storage key escaped the storage root.');
  }

  return full;
}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error('SESSION_SECRET is not set.');
  return value;
}

/** Purpose prefix, for domain separation — see the note in `upload-token.ts`. */
const PURPOSE = 'dac:local-object:v1\n';

function signPath(key: string, expiresAt: number): string {
  return createHmac('sha256', secret())
    .update(PURPOSE)
    .update(`${key}\n${expiresAt}`)
    .digest('base64url');
}

/**
 * Verifies a signed local URL. Returns the key only when the signature and
 * the expiry both hold, so the route handler cannot accidentally serve an
 * unverified path.
 */
export function verifyLocalSignature(
  key: string,
  expiresAt: number,
  signature: string,
  now: Date = new Date(),
): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= now.getTime()) return false;

  const expected = signPath(key, expiresAt);
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Written by the upload route once the grant has been verified. */
export async function writeLocalObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const path = absolutePathFor(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  // The content type is not recoverable from the bytes, and guessing from the
  // extension would be a second source of truth. Keep it beside the object.
  await writeFile(`${path}.type`, contentType, 'utf8');
}

export const localDriver: StorageDriver = {
  name: 'local',

  residency: {
    inIndia: true,
    detail: `Local filesystem at ${STORAGE_ROOT} — development only, never deployed.`,
  },

  async createSignedUpload(_key, contentType, _expiresInSeconds, grantToken): Promise<SignedUpload> {
    // The grant authorises the write and names the key, so there is no second
    // signature here. The route verifies the grant and derives the key from
    // it — it never takes a key from the request.
    return {
      url: `/api/storage/local/upload?token=${encodeURIComponent(grantToken)}`,
      method: 'PUT',
      headers: { 'content-type': contentType },
    };
  },

  async createSignedDownloadUrl(key, expiresInSeconds): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const params = new URLSearchParams({
      key,
      exp: String(expiresAt),
      sig: signPath(key, expiresAt),
    });
    return `/api/storage/local/object?${params.toString()}`;
  },

  async get(key): Promise<StoredObject> {
    const path = absolutePathFor(key);
    const body = await readFile(path);
    let contentType = 'application/octet-stream';
    try {
      contentType = (await readFile(`${path}.type`, 'utf8')).trim() || contentType;
    } catch {
      // Sidecar missing — an object written before the sidecar existed, or a
      // partial write. The generic type is safe: the browser will download
      // rather than render it.
    }
    return { body, contentType, sizeBytes: body.byteLength };
  },

  async stat(key) {
    try {
      const path = absolutePathFor(key);
      const info = await fsStat(path);
      let contentType = 'application/octet-stream';
      try {
        contentType = (await readFile(`${path}.type`, 'utf8')).trim() || contentType;
      } catch {
        /* as in get() */
      }
      return { sizeBytes: info.size, contentType };
    } catch {
      return null;
    }
  },

  async remove(key): Promise<void> {
    const path = absolutePathFor(key);
    await rm(path, { force: true });
    await rm(`${path}.type`, { force: true });
  },
};

/** Called by the driver factory. Keeps an ephemeral filesystem out of production. */
export function assertUsable(): void {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_STORAGE !== 'yes') {
    throw new Error(
      'The local storage driver cannot be used in production: serverless filesystems are ' +
        'ephemeral, so uploads would be lost. Configure SUPABASE_SERVICE_ROLE_KEY (Mumbai ' +
        'project) instead. Set ALLOW_LOCAL_STORAGE=yes only when self-hosting on a real disk.',
    );
  }
}

export { STORAGE_ROOT };
