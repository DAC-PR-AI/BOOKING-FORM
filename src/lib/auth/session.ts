import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { Role, User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { env, isProduction } from '@/lib/env';
import { SESSION_COOKIE } from './constants';

/**
 * Opaque, database-backed sessions.
 *
 * Why not a JWT: every action in this system is audited and an admin must be
 * able to revoke a signatory's access immediately (someone leaves, a device is
 * lost). A stateless token cannot be revoked; a session row can, with one
 * DELETE. The cost is one indexed lookup per request, which is cheap next to
 * the queries a form page already runs.
 *
 * Cookie value is `<token>.<hmac>`:
 *   * `token` is 32 random bytes — the secret the user holds.
 *   * Only SHA-256(token) is stored, so a database leak does not yield usable
 *     session cookies.
 *   * The HMAC lets the server discard a forged or truncated cookie before
 *     touching the database.
 *
 * Middleware does NOT call into this module — it runs outside India. See
 * PLAN.md §3 and middleware.ts.
 */

export { SESSION_COOKIE };
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export type SessionUser = User & { role: Role };

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmacFor(token: string): string {
  return createHmac('sha256', Buffer.from(env.SESSION_SECRET, 'base64'))
    .update(token)
    .digest('base64url');
}

/** Splits `<token>.<hmac>` and verifies the signature in constant time. */
function parseCookieValue(value: string): string | null {
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;

  const token = value.slice(0, dot);
  const provided = value.slice(dot + 1);
  const expected = hmacFor(token);

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return token;
}

export async function createSession(
  userId: string,
  meta: { ip?: string | undefined; userAgent?: string | undefined } = {},
): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, `${token}.${hmacFor(token)}`, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

/**
 * Resolves the current user, or null. Expired sessions are deleted on sight so
 * the table does not grow unbounded on the 500 MB free tier.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const token = parseCookieValue(raw);
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: { include: { role: true } } },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  // A deactivated account loses access immediately, without waiting for expiry.
  if (!session.user.isActive) {
    await prisma.session.deleteMany({ where: { userId: session.userId } }).catch(() => undefined);
    return null;
  }

  return session.user;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;

  if (raw) {
    const token = parseCookieValue(raw);
    if (token) {
      await prisma.session
        .deleteMany({ where: { tokenHash: sha256Hex(token) } })
        .catch(() => undefined);
    }
  }

  store.delete(SESSION_COOKIE);
}

/** Revokes every session for a user — used when an admin deactivates them. */
export async function destroyAllSessionsFor(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
