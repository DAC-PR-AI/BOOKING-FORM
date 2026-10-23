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
  DRAFT: 'bg-gray-100 text-gray-700',
  SUBMITTED: 'bg-blue-50 text-blue-700',
  IN_REVIEW: 'bg-amber-50 text-amber-800',
  RETURNED: 'bg-red-50 text-red-700',
  COMPLETED: 'bg-green-50 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
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
              ? 'Every booking form in the organisation.'
              : 'Booking forms you have created, with their current status.'
          }
        />
        <Link
          href="/forms/new"
          className="rounded-md bg-dac-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-dac-navy-900"
        >
          New booking form
        </Link>
      </div>

      {forms.length === 0 ? (
        <EmptyState>
          No booking forms yet. Use <strong>New booking form</strong> to create your first
          draft.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Booking ID</th>
                <th scope="col" className="px-4 py-3 font-semibold">Applicant</th>
                <th scope="col" className="px-4 py-3 font-semibold">Project</th>
                <th scope="col" className="px-4 py-3 font-semibold">Sale price</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3 font-semibold">Waiting on</th>
                <th scope="col" className="px-4 py-3 font-semibold">Updated</th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {forms.map((f) => {
                const applicant = f.applicants[0];
                const pending = f.flowInstance?.stepRecords[0];
                const editable = f.status === 'DRAFT' || f.status === 'RETURNED';

                return (
                  <tr key={f.id}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-900">
                      {f.bookingId ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {applicant?.fullName ?? (
                        <span className="font-normal text-gray-400">Not yet entered</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{f.project?.name ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-600">
                      {f.salePricePaise ? formatPaise(f.salePricePaise) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[f.status]}`}
                      >
                        {STATUS_LABEL[f.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {pending?.flowStep.label ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatIst(f.updatedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {editable ? (
                        <Link
                          href={`/forms/${f.id}/edit`}
                          className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                        >
                          Continue
                        </Link>
                      ) : (
                        <span className="text-xs text-gray-400">Locked</span>
                      )}
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
