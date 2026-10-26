import type { Metadata } from 'next';
import { requireRole, SIGNATORY_ROLES } from '@/lib/auth/rbac';
import { PageHeader } from '@/components/ui/page-header';
import { QueueList } from '@/components/flow/queue-list';

export const metadata: Metadata = { title: 'Pending for me' };
export const dynamic = 'force-dynamic';

/**
 * A signatory sees a booking only while the flow is actually waiting on them —
 * see `pendingForUserWhere` and `authoriseFormAccess`. Before their turn, the
 * booking is not theirs to know about.
 */
export default async function SignatoryQueuePage() {
  const user = await requireRole(...SIGNATORY_ROLES);

  return (
    <>
      <PageHeader
        title="Pending for me"
        description={`Booking forms waiting on your signature as ${user.role.label}.`}
      />

      <QueueList
        user={user}
        emptyMessage={
          <>
            Nothing is waiting on you. Forms appear here the moment the previous step is
            signed.
          </>
        }
      />
    </>
  );
}
