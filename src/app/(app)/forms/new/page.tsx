import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/rbac';
import { PageHeader } from '@/components/ui/page-header';
import { createDraft } from '../actions';

export const metadata: Metadata = { title: 'New booking form' };
export const dynamic = 'force-dynamic';

/**
 * Deliberately a confirmation step rather than creating a draft on GET:
 * a bare navigation (or a browser prefetch) must not create database rows.
 */
export default async function NewBookingFormPage() {
  const user = await requireRole('SALES_EXECUTIVE', 'ADMIN');

  const activeProjects = await prisma.project.count({
    where: { organizationId: user.organizationId, isActive: true },
  });

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="New Booking Form"
        description="This creates a draft you can fill in over time. Nothing is submitted yet."
      />

      {activeProjects === 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          There are no active projects yet, so the Project Name field will be empty. An
          administrator can add one under <strong>Admin → Projects</strong>.
        </p>
      ) : null}

      <form action={createDraft} className="mt-6">
        <button
          type="submit"
          className="rounded-md bg-dac-navy-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-dac-navy-900"
        >
          Create draft
        </button>
      </form>
    </div>
  );
}
