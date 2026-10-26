import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth/rbac';
import { PageHeader } from '@/components/ui/page-header';
import { QueueList } from '@/components/flow/queue-list';

export const metadata: Metadata = { title: 'To validate' };
export const dynamic = 'force-dynamic';

/**
 * The Co-ordinator's step is the one that asserts the form was *checked*, not
 * merely approved — it is `VALIDATE_AND_SIGN` and lands on `VALIDATED` rather
 * than `SIGNED`, so the distinction survives in the record.
 */
export default async function CoordinatorQueuePage() {
  const user = await requireRole('SALES_COORDINATOR');

  return (
    <>
      <PageHeader
        title="To validate"
        description="Review the form and its documents, tick Validated, then sign to release it to MIS."
      />

      <QueueList
        user={user}
        emptyMessage={
          <>Nothing to validate. Forms arrive here after VP Sales signs (step 6 of 9).</>
        }
      />
    </>
  );
}
