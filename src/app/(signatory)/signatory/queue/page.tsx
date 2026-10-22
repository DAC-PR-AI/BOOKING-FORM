import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireRole, SIGNATORY_ROLES } from '@/lib/auth/rbac';
import { PageHeader, EmptyState } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'Pending for me' };
export const dynamic = 'force-dynamic';

export default async function SignatoryQueuePage() {
  const user = await requireRole(...SIGNATORY_ROLES);

  // A signatory sees a form ONLY while it is pending on them.
  const pending = await prisma.formStepRecord.findMany({
    where: { assigneeId: user.id, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    include: {
      flowStep: true,
      flowInstance: { include: { bookingForm: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="Pending for me"
        description={`Booking forms waiting on your signature as ${user.role.label}.`}
      />

      {pending.length === 0 ? (
        <EmptyState>
          Nothing is waiting on you. Forms appear here the moment the previous step is
          signed.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {pending.map((record) => (
            <li
              key={record.id}
              className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm"
            >
              <span className="font-medium text-gray-900">
                {record.flowInstance.bookingForm.bookingId ?? 'Draft'}
              </span>
              <span className="ml-2 text-gray-500">
                step {record.orderIndex} · {record.flowStep.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
