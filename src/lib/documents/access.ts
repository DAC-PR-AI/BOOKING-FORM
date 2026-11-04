import 'server-only';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Who may see a booking, its documents and its signatures.
 *
 * These files are PAN cards, Aadhaar cards and photographs, so the list is
 * deliberately short and derived from the work, not from seniority:
 *
 *   * an Admin, who can rescue any form;
 *   * the sales executive who created it;
 *   * whoever has already acted on a step of this form — signing claims the
 *     step, so they can look back at what they put their name to;
 *   * whoever the form is waiting on **right now**, matched by role, because
 *     staff steps are claimable by any holder of the role rather than assigned
 *     to one named person in advance (`planFlow` leaves `assigneeId` null).
 *
 * That last rule is the narrowest one that works. Holding the AGM role does
 * not grant sight of every booking in the company: it grants sight of the ones
 * currently sitting on the AGM step. Before their turn a signatory has no
 * business knowing the booking exists — and denials are 404, not 403, so they
 * cannot find out by probing (PLAN.md §9).
 */

export type DocumentAccess = {
  bookingFormId: string;
  /** Form status */
  status: string;
  /** True when the form itself (and mandatory identity documents) can be edited: DRAFT or RETURNED by creator/admin. */
  editable: boolean;
  /**
   * True when non-mandatory supporting documents (e.g. 1st payment screenshot,
   * cost sheets, mail) can be uploaded or updated at any time during the
   * booking lifecycle (any status other than CANCELLED).
   */
  canUploadAnytime: boolean;
  /** The creator, or an Admin standing in for them. */
  isCreator: boolean;
};

const EDITABLE_STATUSES = ['DRAFT', 'RETURNED'] as const;

export async function authoriseFormAccess(
  user: SessionUser,
  bookingFormId: string,
): Promise<DocumentAccess | null> {
  const form = await prisma.bookingForm.findFirst({
    where: {
      id: bookingFormId,
      organizationId: user.organizationId,
      ...(user.role.name === 'ADMIN'
        ? {}
        : {
            OR: [
              { createdById: user.id },
              // A step they have acted on, or claimed.
              { flowInstance: { stepRecords: { some: { assigneeId: user.id } } } },
              // The step the form is waiting on, matched by role.
              {
                flowInstance: {
                  stepRecords: {
                    some: { status: 'PENDING', flowStep: { roleId: user.roleId } },
                  },
                },
              },
            ],
          }),
    },
    select: { id: true, status: true, createdById: true },
  });

  if (!form) return null;

  const isCreator = form.createdById === user.id || user.role.name === 'ADMIN';
  const statusAllowsEditing = (EDITABLE_STATUSES as readonly string[]).includes(form.status);
  const canUploadAnytime = form.status !== 'CANCELLED';

  return {
    bookingFormId: form.id,
    status: form.status,
    editable: isCreator && statusAllowsEditing,
    canUploadAnytime,
    isCreator,
  };
}

/**
 * Document types whose contents are regulated personal identifiers, so a view
 * is logged as VIEW_SENSITIVE rather than a plain read. Matched on the type
 * key prefix because the admin screen can rename labels but not keys.
 */
const SENSITIVE_TYPE_PREFIXES = ['pan_', 'aadhaar_'];

export function isSensitiveDocumentType(typeKey: string): boolean {
  return SENSITIVE_TYPE_PREFIXES.some((prefix) => typeKey.startsWith(prefix));
}
