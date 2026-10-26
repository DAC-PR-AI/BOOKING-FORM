'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/rbac';
import { runProjectSync, type SyncOutcome } from '@/lib/projects/sync';

/**
 * Server Actions for the project sheet sync.
 *
 * Admin only. The sync can deactivate projects, which changes what every
 * sales executive sees in the booking dropdown, so it is not something a
 * signatory should be able to trigger.
 */

export async function syncProjectsNow(): Promise<SyncOutcome> {
  const admin = await requireAdmin();

  const outcome = await runProjectSync({
    organizationId: admin.organizationId,
    userId: admin.id,
  });

  if (outcome.ok) {
    revalidatePath('/admin/projects');
    // The booking form's dropdown reads this list.
    revalidatePath('/forms/new');
  }

  return outcome;
}

/** Same plan, no writes — so an admin can see what a sync would change. */
export async function previewProjectSync(): Promise<SyncOutcome> {
  const admin = await requireAdmin();

  return runProjectSync({
    organizationId: admin.organizationId,
    userId: admin.id,
    dryRun: true,
  });
}
