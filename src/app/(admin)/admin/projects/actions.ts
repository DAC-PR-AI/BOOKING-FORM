'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/rbac';
import { audit } from '@/lib/audit/log';

/**
 * Admin project CRUD.
 *
 * Projects are ultimately mastered in a Google Sheet (PLAN.md §2A), but that
 * sync lands in Phase 7. Until then an admin adds them by hand here, so nobody
 * is blocked from creating bookings.
 *
 * `externalCode` is captured now even though nothing writes it yet: when the
 * sync arrives it keys on that code, and without it the first sync would have
 * to reconcile hand-entered rows against sheet rows with no shared key.
 */

export type ProjectState = { error?: string | undefined; ok?: boolean | undefined };

const createSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(160),
  externalCode: z.string().trim().max(60).optional(),
  location: z.string().trim().max(160).optional(),
});

export async function createProject(
  _prev: ProjectState,
  formData: FormData,
): Promise<ProjectState> {
  const admin = await requireAdmin();

  const parsed = createSchema.safeParse({
    name: formData.get('name') ?? '',
    externalCode: (formData.get('externalCode') as string) || undefined,
    location: (formData.get('location') as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const { name, externalCode, location } = parsed.data;

  const duplicate = await prisma.project.findFirst({
    where: { organizationId: admin.organizationId, name },
  });
  if (duplicate) {
    return { error: `A project named "${name}" already exists.` };
  }

  const project = await prisma.project.create({
    data: {
      organizationId: admin.organizationId,
      name,
      externalCode: externalCode ?? null,
      location: location ?? null,
    },
  });

  await audit({
    organizationId: admin.organizationId,
    userId: admin.id,
    action: 'CREATE',
    after: { project: project.name, externalCode: project.externalCode },
    detail: `Created project "${project.name}".`,
  });

  revalidatePath('/admin/projects');
  return { ok: true };
}

export async function toggleProjectActive(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get('id') ?? '');

  const project = await prisma.project.findFirst({
    where: { id, organizationId: admin.organizationId },
  });
  if (!project) return;

  // Deactivate, never delete: existing bookings must keep resolving their project.
  const updated = await prisma.project.update({
    where: { id: project.id },
    data: { isActive: !project.isActive },
  });

  await audit({
    organizationId: admin.organizationId,
    userId: admin.id,
    action: 'EDIT',
    before: { isActive: project.isActive },
    after: { isActive: updated.isActive },
    detail: `${updated.isActive ? 'Activated' : 'Deactivated'} project "${project.name}".`,
  });

  revalidatePath('/admin/projects');
}
