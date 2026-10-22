import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/rbac';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

function Tile({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-5 shadow-sm transition hover:border-dac-navy-500">
      <p className="text-2xl font-semibold tabular-nums text-gray-900">{value}</p>
      <p className="mt-1 text-sm text-gray-600">{label}</p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function DashboardPage() {
  const user = await requireUser();
  const isCreator = user.role.name === 'SALES_EXECUTIVE';
  const isAdmin = user.role.name === 'ADMIN';

  // Creators see their own forms; admins see the whole organisation;
  // signatories see what is pending on them.
  const [drafts, inReview, returned, completed, pendingOnMe] = await Promise.all([
    prisma.bookingForm.count({
      where: {
        organizationId: user.organizationId,
        status: 'DRAFT',
        ...(isAdmin ? {} : { createdById: user.id }),
      },
    }),
    prisma.bookingForm.count({
      where: {
        organizationId: user.organizationId,
        status: 'IN_REVIEW',
        ...(isAdmin ? {} : { createdById: user.id }),
      },
    }),
    prisma.bookingForm.count({
      where: {
        organizationId: user.organizationId,
        status: 'RETURNED',
        ...(isAdmin ? {} : { createdById: user.id }),
      },
    }),
    prisma.bookingForm.count({
      where: {
        organizationId: user.organizationId,
        status: 'COMPLETED',
        ...(isAdmin ? {} : { createdById: user.id }),
      },
    }),
    prisma.formStepRecord.count({
      where: { assigneeId: user.id, status: 'PENDING' },
    }),
  ]);

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.name.split(' ')[0] ?? user.name}`}
        description={`Signed in as ${user.role.label}.`}
      />

      <section aria-label="Needs my action" className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Needs my action</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Waiting on me to sign"
            value={pendingOnMe}
            href={
              user.role.name === 'SALES_COORDINATOR'
                ? '/coordinator/queue'
                : '/signatory/queue'
            }
          />
          {isCreator || isAdmin ? (
            <Tile label="Returned to me" value={returned} href="/forms" />
          ) : null}
        </div>
      </section>

      <section aria-label="Booking forms">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          {isAdmin ? 'All booking forms' : 'My booking forms'}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Drafts" value={drafts} href={isAdmin ? undefined : '/forms'} />
          <Tile label="In review" value={inReview} href={isAdmin ? undefined : '/forms'} />
          <Tile label="Returned" value={returned} href={isAdmin ? undefined : '/forms'} />
          <Tile label="Completed" value={completed} href={isAdmin ? undefined : '/forms'} />
        </div>
      </section>

      <p className="mt-8 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <strong className="font-semibold">Phase 1 of 8.</strong> Authentication, roles and the
        data model are in place. Creating a booking form arrives in Phase 2.
      </p>
    </>
  );
}
