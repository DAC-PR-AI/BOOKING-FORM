import type { Prisma } from '@prisma/client';
import type { SessionUser } from '@/lib/auth/session';

/**
 * "Waiting on me", as a database filter.
 *
 * This is `canActOnStep` expressed as a Prisma `where`, and the two must never
 * disagree: a queue that offers a step the rules then refuse is a dead end,
 * and a queue that hides a step the rules allow is a booking nobody knows is
 * stuck. `scripts/verify-sign.ts` checks every step the query returns against
 * the predicate.
 *
 * The important subtlety: Phase 4 deliberately leaves staff steps
 * **unassigned**, so any active holder of the role can pick a booking up
 * rather than every booking stalling behind one named person's absence. A
 * queue filtered on `assigneeId` alone therefore shows nothing — which is
 * exactly what the original Phase 1 stubs did.
 *
 * Kept out of the component file so it can be imported from a script without
 * dragging React and `next/link` into a plain Node process.
 */
export function pendingForUserWhere(user: SessionUser): Prisma.FormStepRecordWhereInput {
  return {
    status: 'PENDING',
    flowInstance: {
      bookingForm: {
        organizationId: user.organizationId,
        // Only while the pipeline is live. A RETURNED form is the creator's
        // problem, not a signatory's.
        status: { in: ['SUBMITTED', 'IN_REVIEW'] },
      },
    },
    OR: [
      // Claimed by me — including an in-person applicant step, which is
      // assigned to the creator when the flow is built.
      { assigneeId: user.id },
      // Unclaimed and carrying my role.
      { assigneeId: null, flowStep: { roleId: user.roleId } },
    ],
  };
}
