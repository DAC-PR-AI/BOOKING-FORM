import 'server-only';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Who may see a booking's supporting documents.
 *
 * These files are PAN cards, Aadhaar cards and photographs, so the list is
 * deliberately short and derived from the work, not from seniority:
 *
 *   * an Admin, who can rescue any form;
 *   * the sales executive who created it;
 *   * anyone the flow has actually placed on this form — they are being asked
 *     to sign it, and signing without seeing the attachments would be absurd.
 *
 * Note the third rule is a step record on *this* form, not a role. Holding the
 * AGM role does not grant sight of every booking in the company; being the AGM
 * on this booking does. Denials are 404, so a signatory cannot discover that a
 * booking exists by probing (PLAN.md §9).
 */

export type DocumentAccess = {
  bookingFormId: string;
  /** True when the form is still the creator's to change. */
  editable: boolean;
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
              { flowInstance: { stepRecords: { some: { assigneeId: user.id } } } },
            ],
          }),
    },
    select: { id: true, status: true, createdById: true },
  });

  if (!form) return null;

  const isCreator = form.createdById === user.id || user.role.name === 'ADMIN';
  const statusAllowsEditing = (EDITABLE_STATUSES as readonly string[]).includes(form.status);

  return {
    bookingFormId: form.id,
    editable: isCreator && statusAllowsEditing,
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
