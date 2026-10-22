import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/rbac';
import { PageHeader, EmptyState } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'To validate' };
export const dynamic = 'force-dynamic';

export default async function CoordinatorQueuePage() {
  const user = await requireRole('SALES_COORDINATOR');

  const pending = await prisma.formStepRecord.findMany({
    where: { assigneeId: user.id, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    include: { flowInstance: { include: { bookingForm: true } } },
  });

  return (
    <>
      <PageHeader
        title="To validate"
        description="Review the form and its documents, tick Validated, then sign to release it to MIS."
      />

      {pending.length === 0 ? (
        <EmptyState>
          Nothing to validate. Forms arrive here after VP Sales signs (step 6 of 9).
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
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
