import 'server-only';
import { prisma } from '@/lib/db';
import { isProduction } from '@/lib/env';

/**
 * Which Terms & Conditions version a booking is signed under.
 *
 * `tnc_versions` rows are never edited once a form references one — a
 * correction creates a new version — so each booking can prove exactly what
 * text was shown at signing time, which is the whole reason the table exists.
 *
 * The transcribed v1 is `is_approved = false` because it was read off a
 * photograph and has not been through DAC's legal review (see
 * `content/terms/v1.md`). Production therefore refuses to submit against an
 * unapproved version; development falls back to the newest one so the flow is
 * testable before the legal sign-off lands. That asymmetry is deliberate and
 * the only honest way to have both: an unreviewed clause must never bind a
 * real customer, and the team must not be blocked for weeks waiting.
 */

export type TermsVersion = {
  id: string;
  version: string;
  title: string;
  body: string;
  bodySha256: string;
  isApproved: boolean;
  effectiveFrom: Date | null;
};

export async function activeTermsVersion(
  organizationId: string,
): Promise<TermsVersion | null> {
  const select = {
    id: true,
    version: true,
    title: true,
    body: true,
    bodySha256: true,
    isApproved: true,
    effectiveFrom: true,
  } as const;

  const approved = await prisma.tncVersion.findFirst({
    where: { organizationId, isApproved: true },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    select,
  });
  if (approved) return approved;

  if (isProduction) return null;

  return prisma.tncVersion.findFirst({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    select,
  });
}

/** The exact version a submitted form was signed under, for the audit trail. */
export async function termsVersionById(id: string): Promise<TermsVersion | null> {
  return prisma.tncVersion.findUnique({
    where: { id },
    select: {
      id: true,
      version: true,
      title: true,
      body: true,
      bodySha256: true,
      isApproved: true,
      effectiveFrom: true,
    },
  });
}
