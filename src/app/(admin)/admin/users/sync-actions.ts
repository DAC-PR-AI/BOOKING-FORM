'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/rbac';
import { runUserSync, type UserSyncOutcome } from '@/lib/users/sync';

export async function syncUsersNow(): Promise<UserSyncOutcome> {
  const admin = await requireAdmin();

  const outcome = await runUserSync({
    organizationId: admin.organizationId,
    userId: admin.id,
  });

  if (outcome.ok) {
    revalidatePath('/admin/users');
  }

  return outcome;
}

export async function previewUserSync(): Promise<UserSyncOutcome> {
  const admin = await requireAdmin();

  return runUserSync({
    organizationId: admin.organizationId,
    userId: admin.id,
    dryRun: true,
  });
}

