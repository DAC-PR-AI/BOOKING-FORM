import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/rbac';
import { assessForm, loadFormForGate } from '@/lib/forms/readiness';
import { activeTermsVersion } from '@/lib/forms/terms';
import { wordCount } from '@/lib/forms/terms-markdown';
import { groupIssues } from '@/lib/forms/gate-issues';
import { formatPaise } from '@/lib/format/money';
import { PageHeader } from '@/components/ui/page-header';
import { TermsBody } from '@/components/terms/terms-body';
import { ReviewPanel } from './review-panel';

export const metadata: Metadata = { title: 'Review and submit' };
export const dynamic = 'force-dynamic';

/** Statuses from which a form may still be submitted. */
const SUBMITTABLE = ['DRAFT', 'RETURNED'];

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireRole('SALES_EXECUTIVE', 'ADMIN');

  const form = await loadFormForGate(id, user.organizationId);
  // 404 rather than 403 — do not confirm that someone else's booking exists.
  if (!form) notFound();
  if (user.role.name !== 'ADMIN' && form.createdById !== user.id) notFound();

  // Already submitted: the status page is the right place to be, and it is
  // also where a successful submit lands.
  if (!SUBMITTABLE.includes(form.status)) redirect(`/forms/${form.id}`);

  const { readiness } = await assessForm(form, user.organizationId);
  const terms = await activeTermsVersion(user.organizationId);

  const primary = form.applicants.find((a) => a.applicantType === 'PRIMARY');
  const secondary = form.applicants.find((a) => a.applicantType === 'SECONDARY');

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title={form.status === 'RETURNED' ? 'Resubmit Booking Form' : 'Review and Submit'}
          description={
            form.status === 'RETURNED'
              ? 'This booking was returned for changes. Resubmitting sends it back into the signature flow.'
              : 'Check everything below, then submit. A Booking ID is allocated at this point and the form locks.'
          }
        />
        <div className="flex gap-2">
          <Link
            href={`/forms/${form.id}/edit`}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Back to the form
          </Link>
          <Link
            href={`/forms/${form.id}/documents`}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Documents
          </Link>
        </div>
      </div>

      {/* --- A short summary, so the big numbers are checked before signing --- */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">This booking</h2>
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Sole / First Applicant" value={primary?.fullName ?? '—'} />
          <Row label="Co / Second Applicant" value={secondary?.fullName ?? 'None'} />
          <Row label="Project" value={form.project?.name ?? '—'} />
          <Row
            label="Property"
            value={
              form.propertyType
                ? `${form.propertyType[0]}${form.propertyType.slice(1).toLowerCase()}${
                    form.apartmentNo ? ` ${form.apartmentNo}` : ''
                  }`
                : '—'
            }
          />
          <Row
            label="Sale Price"
            value={form.salePricePaise ? formatPaise(form.salePricePaise) : '—'}
          />
          <Row
            label="Booking Advance"
            value={form.bookingAdvancePaise ? formatPaise(form.bookingAdvancePaise) : '—'}
          />
        </dl>
      </section>

      {/* --- What is outstanding ------------------------------------------- */}
      {readiness.ready ? (
        <p className="mb-6 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          Every required field is filled and every mandatory document is attached.
        </p>
      ) : (
        <section className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <h2 className="text-sm font-semibold text-red-900">
            {readiness.issues.length === 1
              ? 'One thing is still outstanding'
              : `${readiness.issues.length} things are still outstanding`}
          </h2>
          <p className="mt-1 text-xs text-red-800">
            All of them are listed, in the order the paper form prints them, so the booking can
            be finished in one pass.
          </p>

          <div className="mt-3 space-y-3">
            {groupIssues(readiness.issues).map((group) => (
              <div key={group.section}>
                <h3 className="text-xs font-semibold tracking-wide text-red-900 uppercase">
                  {group.title}
                </h3>
                <ul className="mt-1 space-y-0.5 text-sm text-red-900">
                  {group.issues.map((issue, index) => (
                    <li key={`${issue.field}-${index}`} className="flex gap-2">
                      <span aria-hidden className="text-red-400">
                        •
                      </span>
                      <span>
                        {issue.field ? <strong className="font-medium">{issue.field}</strong> : null}
                        {issue.field ? ' — ' : null}
                        {issue.message}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={
                    group.section === 'documents'
                      ? `/forms/${form.id}/documents`
                      : `/forms/${form.id}/edit`
                  }
                  className="mt-1 inline-block text-xs font-semibold text-red-900 underline underline-offset-2"
                >
                  {group.section === 'documents' ? 'Go to documents' : 'Go to the form'}
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* --- Terms & Conditions, page 2 of the paper ----------------------- */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Terms &amp; Conditions for Provisional Allotment
          </h2>
          {terms ? (
            <span className="text-xs text-gray-500">
              Version {terms.version} · about {wordCount(terms.body).toLocaleString('en-IN')} words
            </span>
          ) : null}
        </header>

        {terms ? (
          <>
            {!terms.isApproved ? (
              <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                <strong>This version has not been approved by DAC.</strong> It was transcribed
                from a photograph of the paper form and is pending legal review, so it is usable
                for testing only. Production refuses to submit against an unapproved version.
              </p>
            ) : null}

            <div className="max-h-96 overflow-y-auto px-5 py-4">
              <TermsBody markdown={terms.body} />
            </div>
          </>
        ) : (
          <p className="px-4 py-4 text-sm text-red-800">
            No approved Terms &amp; Conditions version is available, so this booking cannot be
            submitted. An administrator must approve a version first.
          </p>
        )}
      </section>

      <ReviewPanel
        formId={form.id}
        ready={readiness.ready && terms !== null}
        isResubmission={form.status === 'RETURNED'}
        termsVersion={terms?.version ?? null}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-100 pb-1">
      <dt className="text-gray-600">{label}</dt>
      <dd className="text-right font-medium text-gray-900">{value}</dd>
    </div>
  );
}
