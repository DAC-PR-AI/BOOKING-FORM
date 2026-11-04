import type { Metadata } from 'next';
import Link from 'next/link';
import type { FormStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/rbac';
import { formatPaise } from '@/lib/format/money';
import { PageHeader, EmptyState } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'My Forms' };
export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<FormStatus, string> = {
  DRAFT: 'border-slate-200 bg-slate-100 text-slate-700',
  SUBMITTED: 'border-blue-200 bg-blue-50 text-blue-700',
  IN_REVIEW: 'border-amber-200 bg-amber-50 text-amber-800',
  RETURNED: 'border-red-200 bg-red-50 text-red-700',
  COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  CANCELLED: 'border-slate-200 bg-slate-100 text-slate-500',
};

const STATUS_DOT: Record<FormStatus, string> = {
  DRAFT: 'bg-slate-400',
  SUBMITTED: 'bg-blue-500',
  IN_REVIEW: 'bg-amber-500',
  RETURNED: 'bg-red-500',
  COMPLETED: 'bg-emerald-500',
  CANCELLED: 'bg-slate-400',
};

const STATUS_LABEL: Record<FormStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  IN_REVIEW: 'In review',
  RETURNED: 'Returned',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

function formatIst(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeZone: 'Asia/Kolkata',
  }).format(d);
}

export default async function MyFormsPage() {
  const user = await requireRole('SALES_EXECUTIVE', 'ADMIN');
  const isAdmin = user.role.name === 'ADMIN';

  const forms = await prisma.bookingForm.findMany({
    where: {
      organizationId: user.organizationId,
      ...(isAdmin ? {} : { createdById: user.id }),
    },
    include: {
      project: true,
      applicants: { where: { applicantType: 'PRIMARY' } },
      flowInstance: {
        include: {
          stepRecords: { where: { status: 'PENDING' }, include: { flowStep: true } },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title={isAdmin ? 'All Booking Forms' : 'My Forms'}
          description={
            isAdmin
              ? 'Every booking form in the organisation, with live pipeline status.'
              : 'Booking forms you have created, with their current approval status.'
          }
        />
        <Link
          href="/forms/new"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-dac-navy-800 to-dac-navy-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-dac-navy-900 hover:to-dac-navy-800 hover:shadow-md"
        >
          <span>+ New booking form</span>
        </Link>
      </div>

      {forms.length === 0 ? (
        <EmptyState>
          No booking forms yet. Use <strong>+ New booking form</strong> to create your first
          draft.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200/90 bg-white shadow-xs">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-xs uppercase tracking-wider text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-3.5 font-semibold">Booking ID</th>
                <th scope="col" className="px-4 py-3.5 font-semibold">Applicant</th>
                <th scope="col" className="px-4 py-3.5 font-semibold">Project</th>
                <th scope="col" className="px-4 py-3.5 font-semibold">Sale price</th>
                <th scope="col" className="px-4 py-3.5 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3.5 font-semibold">Waiting on</th>
                <th scope="col" className="px-4 py-3.5 font-semibold">Updated</th>
                <th scope="col" className="px-4 py-3.5 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {forms.map((f) => {
                const applicant = f.applicants[0];
                const pending = f.flowInstance?.stepRecords[0];
                const editable = f.status === 'DRAFT' || f.status === 'RETURNED';

                return (
                  <tr key={f.id} className="transition hover:bg-slate-50/80">
                    <td className="px-4 py-3.5 font-mono text-xs text-slate-900">
                      {f.bookingId ? (
                        <span className="rounded-md bg-dac-navy-50 px-2 py-1 font-semibold text-dac-navy-800">
                          {f.bookingId}
                        </span>
                      ) : (
                        <span className="text-slate-400">Draft</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-slate-900">
                      <Link
                        href={`/forms/${f.id}`}
                        className="decoration-slate-300 underline-offset-4 hover:text-dac-navy-700 hover:underline"
                      >
                        {applicant?.fullName ?? (
                          <span className="font-normal italic text-slate-400">
                            Not yet entered
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">{f.project?.name ?? '—'}</td>
                    <td className="px-4 py-3.5 font-medium tabular-nums text-slate-700">
                      {f.salePricePaise ? formatPaise(f.salePricePaise) : '—'}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[f.status]}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[f.status]}`}
                          aria-hidden="true"
                        />
                        {STATUS_LABEL[f.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs font-medium text-slate-600">
                      {pending ? (
                        <span className="rounded-md bg-amber-50 px-2 py-0.5 text-amber-900 border border-amber-200/60">
                          Step {pending.orderIndex}: {pending.flowStep.label}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-slate-500">{formatIst(f.updatedAt)}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex justify-end gap-1.5">
                        {editable ? (
                          <Link
                            href={`/forms/${f.id}/edit`}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:border-dac-navy-500 hover:text-dac-navy-800"
                          >
                            Continue
                          </Link>
                        ) : (
                          <Link
                            href={`/forms/${f.id}`}
                            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                          >
                            Status
                          </Link>
                        )}
                        {editable ? (
                          <Link
                            href={`/forms/${f.id}/review`}
                            className="rounded-lg bg-dac-navy-700 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-dac-navy-900"
                          >
                            {f.status === 'RETURNED' ? 'Resubmit' : 'Submit'}
                          </Link>
                        ) : null}
                        <Link
                          href={`/forms/${f.id}/documents`}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:border-slate-400 hover:bg-slate-50"
                        >
                          Documents
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
