import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/rbac';
import { authoriseFormAccess } from '@/lib/documents/access';
import { termsVersionById } from '@/lib/forms/terms';
import { PageHeader } from '@/components/ui/page-header';
import { TermsBody } from '@/components/terms/terms-body';

export const metadata: Metadata = { title: 'Terms accepted' };
export const dynamic = 'force-dynamic';

function formatIst(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(d);
}

/**
 * The exact Terms & Conditions text a booking was accepted under.
 *
 * Read-only, and resolved by the version id stored on the form rather than by
 * "the current version" — that distinction is the entire reason
 * `tnc_versions` is a table. If DAC publishes a v2 next month, this page must
 * still show what this applicant actually agreed to, and the SHA-256 below is
 * what proves the text has not been altered since.
 */
export default async function AcceptedTermsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const access = await authoriseFormAccess(user, id);
  if (!access) notFound();

  const form = await prisma.bookingForm.findUniqueOrThrow({
    where: { id: access.bookingFormId },
    select: { id: true, bookingId: true, tncVersionId: true, tncAcceptedAt: true },
  });

  if (!form.tncVersionId) notFound();

  const terms = await termsVersionById(form.tncVersionId);
  if (!terms) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Terms & Conditions Accepted"
          description={
            form.tncAcceptedAt
              ? `Accepted on ${formatIst(form.tncAcceptedAt)}${
                  form.bookingId ? ` for ${form.bookingId}` : ''
                }.`
              : 'The version this booking is bound by.'
          }
        />
        <Link
          href={`/forms/${form.id}`}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Back to the booking
        </Link>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white">
        <header className="border-b border-gray-200 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">
              Version {terms.version}
              {terms.isApproved ? null : (
                <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                  Not approved
                </span>
              )}
            </h2>
            <span className="text-xs text-gray-500">
              {terms.effectiveFrom
                ? `Effective ${terms.effectiveFrom.toISOString().slice(0, 10)}`
                : 'No effective date set'}
            </span>
          </div>
          {/* The hash is the evidence: it ties this booking to these exact words. */}
          <p className="mt-1 font-mono text-[11px] break-all text-gray-400">
            sha256 {terms.bodySha256}
          </p>
        </header>

        <div className="px-5 py-4">
          <TermsBody markdown={terms.body} />
        </div>
      </section>
    </div>
  );
}
