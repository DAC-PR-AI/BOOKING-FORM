import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth/rbac';
import { PageHeader, EmptyState } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'My Forms' };
export const dynamic = 'force-dynamic';

export default async function MyFormsPage() {
  // Admins can see everything; creators see their own.
  await requireRole('SALES_EXECUTIVE', 'ADMIN');

  return (
    <>
      <PageHeader
        title="My Forms"
        description="Booking forms you have created, with their current status."
      />
      <EmptyState>
        No booking forms yet. Creating and saving a draft arrives in Phase 2.
      </EmptyState>
    </>
  );
}
