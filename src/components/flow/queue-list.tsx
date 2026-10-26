import Link from 'next/link';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/auth/session';
import { formatPaise } from '@/lib/format/money';
import { pendingForUserWhere } from '@/lib/flow/queue';
import { EmptyState } from '@/components/ui/page-header';

/**
 * "Waiting on me" — shared by the signatory and Co-ordinator queues.
 *
 * The query itself lives in `@/lib/flow/queue` so it can be imported without
 * React; this is only its presentation.
 */

function formatIst(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeZone: 'Asia/Kolkata',
  }).format(d);
}

export async function QueueList({
  user,
  emptyMessage,
}: {
  user: SessionUser;
  emptyMessage: React.ReactNode;
}) {
  const pending = await prisma.formStepRecord.findMany({
    where: pendingForUserWhere(user),
    // Oldest first: a booking that has been waiting longest is the one holding
    // somebody up.
    orderBy: { updatedAt: 'asc' },
    take: 100,
    include: {
      flowStep: { select: { label: true, action: true } },
      flowInstance: {
        select: {
          bookingForm: {
            select: {
              id: true,
              bookingId: true,
              salePricePaise: true,
              submittedAt: true,
              project: { select: { name: true } },
              applicants: {
                where: { applicantType: 'PRIMARY' },
                select: { fullName: true },
              },
              createdBy: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (pending.length === 0) return <EmptyState>{emptyMessage}</EmptyState>;

  return (
    <ul className="space-y-3">
      {pending.map((record) => {
        const form = record.flowInstance.bookingForm;
        const applicant = form.applicants[0];

        return (
          <li
            key={record.id}
            className="rounded-lg border border-gray-200 bg-white p-4 transition hover:border-gray-300"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  {applicant?.fullName ?? 'No applicant name yet'}
                  {record.flowStep.action === 'VALIDATE_AND_SIGN' ? (
                    <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                      Validate + sign
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 font-mono text-xs text-gray-500">
                  {form.bookingId ?? '—'}
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  Step {record.orderIndex} · {record.flowStep.label}
                  {form.project?.name ? ` · ${form.project.name}` : null}
                  {form.salePricePaise ? ` · ${formatPaise(form.salePricePaise)}` : null}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  Raised by {form.createdBy.name}
                  {form.submittedAt ? ` · submitted ${formatIst(form.submittedAt)}` : null}
                  {record.assigneeId === user.id ? ' · claimed by you' : null}
                </p>
              </div>

              <div className="flex shrink-0 gap-2">
                <Link
                  href={`/forms/${form.id}`}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Open
                </Link>
                <Link
                  href={`/forms/${form.id}/sign/${record.orderIndex}`}
                  className="rounded-md bg-dac-navy-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-dac-navy-900"
                >
                  {record.flowStep.action === 'VALIDATE_AND_SIGN' ? 'Validate' : 'Review and sign'}
                </Link>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
