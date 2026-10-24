import 'server-only';
import type { Prisma } from '@prisma/client';
import { bookingYearIst, formatBookingId } from './booking-id';

/**
 * Allocates the next Booking ID for an organisation and year.
 *
 * Must be called inside the submit transaction. Two sales executives
 * submitting at the same moment is not a hypothetical — it is a Monday — and
 * two bookings sharing an ID would be a data-integrity failure that surfaces
 * weeks later in finance.
 *
 * `INSERT … ON CONFLICT … DO UPDATE` is one statement and takes a row lock on
 * the conflicting row, so concurrent submits serialise behind it rather than
 * both reading the same `last_value`. Done as two statements (SELECT then
 * UPDATE) this would be a textbook race; done in application code with a
 * retry loop it would be slower and still wrong under REPEATABLE READ.
 *
 * The sequence is gap-free: if the surrounding transaction rolls back, the
 * increment rolls back with it, so a failed submit does not consume a number.
 */
export async function allocateBookingId(
  tx: Prisma.TransactionClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<string> {
  const year = bookingYearIst(now);

  const rows = await tx.$queryRaw<Array<{ last_value: number }>>`
    INSERT INTO booking_sequences (id, organization_id, year, last_value, updated_at)
    VALUES (gen_random_uuid(), ${organizationId}::uuid, ${year}, 1, now())
    ON CONFLICT (organization_id, year)
    DO UPDATE SET last_value = booking_sequences.last_value + 1, updated_at = now()
    RETURNING last_value
  `;

  const sequence = rows[0]?.last_value;
  if (typeof sequence !== 'number') {
    throw new Error('Booking ID allocation returned no sequence value.');
  }

  return formatBookingId(year, sequence);
}
