'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/rbac';

/**
 * Marking notifications read.
 *
 * Every write is scoped to the acting user's own rows. `updateMany` with the
 * user id in the `where` rather than a read-then-check: a notification id is
 * guessable, and this way there is no path that touches somebody else's row
 * even if an id is wrong or forged.
 */

export async function markRead(notificationId: string): Promise<void> {
  const user = await requireUser();

  await prisma.notification.updateMany({
    where: { id: notificationId, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath('/notifications');
}

export async function markAllRead(): Promise<void> {
  const user = await requireUser();

  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath('/notifications');
}
