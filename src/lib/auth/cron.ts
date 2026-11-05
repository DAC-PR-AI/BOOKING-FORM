import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time verification of `Authorization: Bearer <CRON_SECRET>`.
 *
 * Hashing both strings with SHA-256 before `timingSafeEqual` guarantees
 * constant-time comparison without leaking the length of `CRON_SECRET`.
 *
 * When `failClosedInProd` is true (default for cron job mutations like
 * `/api/cron/digest` and `/api/cron/sync-projects`), an unset `CRON_SECRET` in
 * production is rejected (`false`) so an accidentally unconfigured secret can
 * never expose cron endpoints to unauthenticated internet traffic.
 */
export function verifyCronAuth(
  authorizationHeader: string | null,
  options?: {
    cronSecret?: string | undefined;
    nodeEnv?: string | undefined;
    failClosedInProd?: boolean;
  },
): boolean {
  const secret = options?.cronSecret ?? process.env.CRON_SECRET;
  const nodeEnv = options?.nodeEnv ?? process.env.NODE_ENV;
  const failClosedInProd = options?.failClosedInProd ?? true;

  if (!secret || secret.length === 0) {
    if (failClosedInProd && nodeEnv === 'production') {
      return false;
    }
    return true;
  }

  if (!authorizationHeader) {
    return false;
  }

  const expected = `Bearer ${secret}`;
  const digestActual = createHash('sha256').update(authorizationHeader, 'utf8').digest();
  const digestExpected = createHash('sha256').update(expected, 'utf8').digest();

  return timingSafeEqual(digestActual, digestExpected);
}

