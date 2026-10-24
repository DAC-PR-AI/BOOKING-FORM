/**
 * Upload grants.
 *
 * Uploading is two round trips: the server authorises and hands back a grant,
 * the browser PUTs the bytes, then the browser asks the server to record the
 * document. Between those calls the server must remember what it authorised —
 * which form, which document type, which key, which content type, what size
 * ceiling — without trusting the browser to repeat it honestly.
 *
 * A signed token carries that decision instead of a `pending_uploads` table.
 * Rationale:
 *
 *   * An abandoned upload expires by itself. A table would need sweeping, and
 *     an unswept one is a slow leak of rows that look like real work.
 *   * The confirm step cannot be talked into attaching a document to a form
 *     the user was never authorised for, because the form id is inside the
 *     signature.
 *
 * The signature is HMAC-SHA-256 over a canonical JSON payload using
 * SESSION_SECRET. Keyed, not a bare hash: the browser holds the token, so an
 * unkeyed digest would be forgeable.
 *
 * Deliberately free of `server-only` and of the env module so the signing
 * logic can be unit tested.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type UploadGrant = {
  /** Who the grant was issued to. The confirm step re-checks this. */
  userId: string;
  bookingFormId: string;
  documentTypeId: string;
  /** Null for FORM-scoped types. */
  applicantId: string | null;
  storageKey: string;
  contentType: string;
  maxBytes: number;
  /** Seconds since the epoch. */
  expiresAt: number;
};

export type VerifyFailure =
  | 'malformed'
  | 'bad-signature'
  | 'expired';

export type VerifyResult =
  | { ok: true; grant: UploadGrant }
  | { ok: false; reason: VerifyFailure };

/**
 * Field order is fixed so the same grant always signs to the same bytes.
 * `JSON.stringify` on an object literal would depend on key insertion order,
 * which is too subtle a thing to rest a signature on.
 */
function canonical(grant: UploadGrant): string {
  return JSON.stringify([
    grant.userId,
    grant.bookingFormId,
    grant.documentTypeId,
    grant.applicantId,
    grant.storageKey,
    grant.contentType,
    grant.maxBytes,
    grant.expiresAt,
  ]);
}

/**
 * Domain separation. SESSION_SECRET also signs session cookies and local
 * object URLs, so every message signed with it is prefixed with its purpose —
 * a grant can then never be replayed as a cookie, or vice versa, even though
 * the key is shared.
 */
const PURPOSE = 'dac:upload-grant:v1\n';

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(PURPOSE).update(payload).digest('base64url');
}

export function createUploadToken(grant: UploadGrant, secret: string): string {
  const payload = Buffer.from(canonical(grant), 'utf8').toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyUploadToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };

  const [payload, signature] = parts as [string, string];
  if (!payload || !signature) return { ok: false, reason: 'malformed' };

  const expected = sign(payload, secret);
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // Compare before parsing: an attacker must not get parser feedback on a
  // payload they did not sign.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad-signature' };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (!Array.isArray(decoded) || decoded.length !== 8) {
    return { ok: false, reason: 'malformed' };
  }

  const [userId, bookingFormId, documentTypeId, applicantId, storageKey, contentType, maxBytes, expiresAt] =
    decoded as unknown[];

  if (
    typeof userId !== 'string' ||
    typeof bookingFormId !== 'string' ||
    typeof documentTypeId !== 'string' ||
    (applicantId !== null && typeof applicantId !== 'string') ||
    typeof storageKey !== 'string' ||
    typeof contentType !== 'string' ||
    typeof maxBytes !== 'number' ||
    typeof expiresAt !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }

  if (expiresAt * 1000 <= now.getTime()) {
    return { ok: false, reason: 'expired' };
  }

  return {
    ok: true,
    grant: {
      userId,
      bookingFormId,
      documentTypeId,
      applicantId,
      storageKey,
      contentType,
      maxBytes,
      expiresAt,
    },
  };
}

/** How long a grant stays usable. Long enough for a slow mobile upload. */
export const UPLOAD_GRANT_TTL_SECONDS = 15 * 60;

/** How long a view URL stays usable. Short — it may end up in history. */
export const DOWNLOAD_URL_TTL_SECONDS = 60;
