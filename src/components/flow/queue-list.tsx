import Link from 'next/link';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/auth/session';
import { formatPaise } from '@/lib/format/money';
import { pendingForUserWhere } from '@/lib/flow/queue';
import { EmptyState } from '@/components/ui/page-header';

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
    <ul className="space-y-3.5">
      {pending.map((record) => {
        const form = record.flowInstance.bookingForm;
        const applicant = form.applicants[0];

        return (
          <li
            key={record.id}
            className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs transition hover:-translate-y-0.5 hover:border-dac-navy-300 hover:shadow-md"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-bold text-slate-900">
                    {applicant?.fullName ?? 'No applicant name yet'}
                  </p>
                  {form.bookingId ? (
                    <span className="rounded-md bg-dac-navy-50 px-2 py-0.5 font-mono text-xs font-semibold text-dac-navy-800">
                      {form.bookingId}
                    </span>
                  ) : null}
                  {record.flowStep.action === 'VALIDATE_AND_SIGN' ? (
                    <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">
                      Validate + sign
                    </span>
                  ) : null}
                </div>

                <p className="mt-1.5 text-xs font-medium text-slate-700">
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-900 border border-amber-200/70">
                    Step {record.orderIndex} · {record.flowStep.label}
                  </span>
                  {form.project?.name ? ` · ${form.project.name}` : null}
                  {form.salePricePaise ? ` · ${formatPaise(form.salePricePaise)}` : null}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Raised by <strong className="font-medium text-slate-700">{form.createdBy.name}</strong>
                  {form.submittedAt ? ` · submitted ${formatIst(form.submittedAt)}` : null}
                  {record.assigneeId === user.id ? ' · claimed by you' : null}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/forms/${form.id}`}
                  className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
                >
                  Open
                </Link>
                <Link
                  href={`/forms/${form.id}/sign/${record.orderIndex}`}
                  className="rounded-xl bg-gradient-to-r from-dac-navy-800 to-dac-navy-700 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:from-dac-navy-900 hover:to-dac-navy-800"
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
