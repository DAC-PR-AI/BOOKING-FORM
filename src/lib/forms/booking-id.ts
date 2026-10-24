/**
 * Booking ID formatting.
 *
 * `DAC/YYYY/NNNNN` (FIELD_MAP.md item 10), allocated at **submit**, never at
 * draft creation: an abandoned draft must not burn a number, because finance
 * reads a gap in the sequence as a missing booking.
 *
 * The formatting is separated from the allocation (`allocate.ts`) so the shape
 * of the identifier can be unit tested without a database, and so the year and
 * padding rules are visible in one place rather than inlined in a transaction.
 */

export const BOOKING_ID_PREFIX = 'DAC';
const SEQUENCE_DIGITS = 5;

/** Matches a well-formed Booking ID. Exported so tests and imports can assert on it. */
export const BOOKING_ID_PATTERN = /^[A-Z]{2,6}\/\d{4}\/\d{5,}$/;

export function formatBookingId(
  year: number,
  sequence: number,
  prefix: string = BOOKING_ID_PREFIX,
): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error(`Booking ID year is out of range: ${year}`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Booking ID sequence must be a positive integer, got ${sequence}`);
  }

  // Past 99999 the number simply gets longer rather than wrapping or
  // truncating. A silently duplicated Booking ID would be far worse than an
  // identifier one character wider than the box it is printed in.
  return `${prefix}/${year}/${String(sequence).padStart(SEQUENCE_DIGITS, '0')}`;
}

/**
 * The year a Booking ID is stamped with.
 *
 * India Standard Time, not the server's zone and not UTC. A booking submitted
 * at 01:00 IST on 1 January is a booking of the new year to everyone in the
 * office; UTC would file it under the old one, and the sequence would look like
 * it had jumped backwards.
 */
export function bookingYearIst(now: Date = new Date()): number {
  const ist = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
  }).format(now);
  return Number.parseInt(ist, 10);
}

/** Splits a Booking ID back into its parts, or null if it is not one of ours. */
export function parseBookingId(
  bookingId: string,
): { prefix: string; year: number; sequence: number } | null {
  const match = /^([A-Z]{2,6})\/(\d{4})\/(\d{5,})$/.exec(bookingId);
  if (!match) return null;

  const [, prefix, year, sequence] = match as unknown as [string, string, string, string];
  return {
    prefix,
    year: Number.parseInt(year, 10),
    sequence: Number.parseInt(sequence, 10),
  };
}
