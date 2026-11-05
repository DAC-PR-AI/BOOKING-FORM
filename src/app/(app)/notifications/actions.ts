'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/rbac';

const notificationIdSchema = z.string().uuid();

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

  const parsed = notificationIdSchema.safeParse(notificationId);
  if (!parsed.success) return;

  await prisma.notification.updateMany({
    where: { id: parsed.data, userId: user.id, readAt: null },
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
