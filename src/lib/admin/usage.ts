/**
 * Free-tier meters.
 *
 * The Supabase free plan gives 500 MB of database and 1 GB of storage, and
 * crossing the database limit puts the project into **read-only** — which for
 * this app means bookings can be read but not signed. That is not a failure
 * anyone should meet by surprise, so PLAN.md §5 sets an upgrade trigger at
 * 70% and this is what makes it visible.
 *
 * Pure and unit tested: a meter that reads comfortable while the real figure
 * is at 95% is worse than no meter, because it is actively reassuring.
 */

export type UsageLevel = 'ok' | 'watch' | 'critical';

/** The documented upgrade trigger, and the point it becomes urgent. */
export const WATCH_AT = 0.7;
export const CRITICAL_AT = 0.9;

export type Meter = {
  label: string;
  used: number;
  limit: number;
  /** 0–100, clamped. */
  percent: number;
  level: UsageLevel;
  /** What to do about it, if anything. */
  note: string | null;
};

export function levelFor(used: number, limit: number): UsageLevel {
  if (limit <= 0) return 'ok';
  const ratio = used / limit;
  if (ratio >= CRITICAL_AT) return 'critical';
  if (ratio >= WATCH_AT) return 'watch';
  return 'ok';
}

export function meter(input: {
  label: string;
  used: number;
  limit: number;
  /** Said plainly when the level is not ok. */
  consequence: string;
}): Meter {
  const level = levelFor(input.used, input.limit);
  const percent =
    input.limit <= 0 ? 0 : Math.min(100, Math.max(0, (input.used / input.limit) * 100));

  return {
    label: input.label,
    used: input.used,
    limit: input.limit,
    percent,
    level,
    note:
      level === 'ok'
        ? null
        : level === 'watch'
          ? `Past ${Math.round(WATCH_AT * 100)}% — plan the upgrade now. ${input.consequence}`
          : `Past ${Math.round(CRITICAL_AT * 100)}% — upgrade before this fills. ${input.consequence}`,
  };
}

/** Free-tier limits, in bytes. Sources dated in PLAN.md §5. */
export const FREE_TIER = {
  databaseBytes: 500 * 1024 * 1024,
  storageBytes: 1024 * 1024 * 1024,
} as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Roughly how many more bookings fit, from what the stored ones actually
 * weigh. A projection from real averages rather than a guess at what a
 * booking "should" cost — compressed photos vary enormously.
 */
export function bookingsRemaining(input: {
  usedBytes: number;
  limitBytes: number;
  completedBookings: number;
}): number | null {
  if (input.completedBookings === 0 || input.usedBytes === 0) return null;

  const perBooking = input.usedBytes / input.completedBookings;
  if (perBooking <= 0) return null;

  return Math.max(0, Math.floor((input.limitBytes - input.usedBytes) / perBooking));
}
