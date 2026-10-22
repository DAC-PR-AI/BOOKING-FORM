/**
 * Shared auth constants.
 *
 * Deliberately dependency-free: middleware imports this, and middleware must
 * not pull in Prisma, `server-only`, or anything that reads personal data.
 * See PLAN.md §3.
 */

export const SESSION_COOKIE = 'dac_session';

/** Routes reachable without a session. */
export const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password'] as const;
