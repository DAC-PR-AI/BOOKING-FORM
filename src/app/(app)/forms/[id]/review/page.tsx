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
  if (!form) notFound();
  if (user.role.name !== 'ADMIN' && form.createdById !== user.id) notFound();

  if (!SUBMITTABLE.includes(form.status)) redirect(`/forms/${form.id}`);

  const { readiness } = await assessForm(form, user.organizationId);
  const terms = await activeTermsVersion(user.organizationId);

  const primary = form.applicants.find((a) => a.applicantType === 'PRIMARY');
  const secondary = form.applicants.find((a) => a.applicantType === 'SECONDARY');

  return (
    <div className="mx-auto max-w-4xl">
      {/* 3-Step Workflow Bar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-slate-200/90 bg-white px-4 py-3 text-xs shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/forms/${form.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-dac-navy-700 transition hover:border-dac-navy-300 hover:bg-dac-navy-50"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-dac-navy-100 text-[10px] text-dac-navy-800">
              1
            </span>
            <span>Booking Form</span>
          </Link>
          <span className="text-slate-300" aria-hidden="true">→</span>
          <Link
            href={`/forms/${form.id}/documents`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-dac-navy-700 transition hover:border-dac-navy-300 hover:bg-dac-navy-50"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-dac-navy-100 text-[10px] text-dac-navy-800">
              2
            </span>
            <span>Supporting documents</span>
          </Link>
          <span className="text-slate-300" aria-hidden="true">→</span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-dac-navy-800 px-2.5 py-1 font-semibold text-white shadow-2xs">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px]">
              3
            </span>
            <span>Review and submit</span>
          </span>
        </div>
      </div>

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
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
          >
            ← Back to the form
          </Link>
          <Link
            href={`/forms/${form.id}/documents`}
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
          >
            Documents
          </Link>
        </div>
      </div>

      {/* --- Executive Summary Card --- */}
      <section className="mb-6 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <h2 className="mb-3.5 text-xs font-bold tracking-wider text-dac-navy-900 uppercase">
          This booking
        </h2>
        <dl className="grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
          <Row label="Sole / First Applicant" value={primary?.fullName ?? '—'} />
          <Row label="Co / Second Applicant" value={secondary?.fullName ?? 'None'} />
          <Row label="Project" value={form.project?.name ?? '—'} />
          <Row
            label="Property"
            value={
              form.propertyType
                ? `${form.propertyType[0]}${form.propertyType.slice(1).toLowerCase()}${form.apartmentNo ? ` ${form.apartmentNo}` : ''
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
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/90 px-5 py-4 text-sm font-medium text-emerald-950 shadow-2xs">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
            ✓
          </span>
          <span>Every required field is filled and every mandatory document is attached.</span>
        </div>
      ) : (
        <section className="mb-6 rounded-2xl border border-red-200 bg-red-50/80 p-5 shadow-2xs">
          <h2 className="text-sm font-bold text-red-900">
            {readiness.issues.length === 1
              ? 'One thing is still outstanding'
              : `${readiness.issues.length} things are still outstanding`}
          </h2>
          <p className="mt-1 text-xs text-red-800">
            All of them are listed, in the order the paper form prints them, so the booking can
            be finished in one pass.
          </p>

          <div className="mt-4 space-y-4">
            {groupIssues(readiness.issues).map((group) => (
              <div
                key={group.section}
                className="rounded-xl border border-red-200/80 bg-white/80 p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold tracking-wider text-red-900 uppercase">
                    {group.title}
                  </h3>
                  <Link
                    href={
                      group.section === 'documents'
                        ? `/forms/${form.id}/documents`
                        : `/forms/${form.id}/edit`
                    }
                    className="rounded-md bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-900 transition hover:bg-red-200"
                  >
                    {group.section === 'documents' ? 'Go to documents →' : 'Go to the form →'}
                  </Link>
                </div>
                <ul className="mt-2 space-y-1 text-sm text-red-900">
                  {group.issues.map((issue, index) => (
                    <li key={`${issue.field}-${index}`} className="flex gap-2">
                      <span aria-hidden className="text-red-500">
                        •
                      </span>
                      <span>
                        {issue.field ? <strong className="font-semibold">{issue.field}</strong> : null}
                        {issue.field ? ' — ' : null}
                        {issue.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* --- Terms & Conditions, page 2 of the paper ----------------------- */}
      <section className="mb-6 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-5 py-3.5">
          <h2 className="text-sm font-bold text-slate-900">
            Terms &amp; Conditions for Provisional Allotment
          </h2>
          {terms ? (
            <span className="text-xs font-medium text-slate-500">
              Version {terms.version} · about {wordCount(terms.body).toLocaleString('en-IN')} words
            </span>
          ) : null}
        </header>

        {terms ? (
          <>
            {!terms.isApproved ? (
              <p className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-xs text-amber-900">
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
          <p className="px-5 py-4 text-sm text-red-800">
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
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
