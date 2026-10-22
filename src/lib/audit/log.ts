import 'server-only';
import { headers } from 'next/headers';
import type { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Append-only audit trail.
 *
 * Every create, edit, upload, sensitive-field view, signature, validation,
 * return and export lands here (brief §5.3). A follow-up migration revokes
 * UPDATE and DELETE on the table so even a compromised application role cannot
 * rewrite history.
 *
 * NEVER pass raw PAN or Aadhaar values in `before`/`after`. Record the field
 * NAME that changed, not its contents — see `redact()` below.
 */

export { redact } from './redact';
import { redact } from './redact';

export type AuditInput = {
  organizationId: string;
  action: AuditAction;
  userId?: string | undefined;
  bookingFormId?: string | undefined;
  before?: unknown;
  after?: unknown;
  detail?: string | undefined;
};

async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    return {
      ip: forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null,
      userAgent: h.get('user-agent'),
    };
  } catch {
    // Outside a request context (e.g. the seed script).
    return { ip: null, userAgent: null };
  }
}

/**
 * Writes an audit entry. Deliberately swallows its own errors: a failed audit
 * write must not roll back the user's action, but it must be visible in logs.
 * For actions where the audit entry is legally required (signing), pass the
 * surrounding transaction client instead via `auditWithin`.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    const { ip, userAgent } = await requestMeta();
    await prisma.auditLog.create({ data: buildData(input, ip, userAgent) });
  } catch (error) {
    console.error('[audit] failed to write audit entry', {
      action: input.action,
      bookingFormId: input.bookingFormId,
      error,
    });
  }
}

/** Audit inside an existing transaction — the entry commits or rolls back with it. */
export async function auditWithin(
  tx: Prisma.TransactionClient,
  input: AuditInput,
): Promise<void> {
  const { ip, userAgent } = await requestMeta();
  await tx.auditLog.create({ data: buildData(input, ip, userAgent) });
}

function buildData(
  input: AuditInput,
  ip: string | null,
  userAgent: string | null,
): Prisma.AuditLogUncheckedCreateInput {
  return {
    organizationId: input.organizationId,
    action: input.action,
    userId: input.userId ?? null,
    bookingFormId: input.bookingFormId ?? null,
    before: (redact(input.before) ?? null) as Prisma.InputJsonValue,
    after: (redact(input.after) ?? null) as Prisma.InputJsonValue,
    detail: input.detail ?? null,
    ip,
    userAgent,
  };
}
