'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/rbac';
import { hashPassword } from '@/lib/auth/password';
import { destroyAllSessionsFor } from '@/lib/auth/session';
import { allowedAuthDomain, isAllowedStaffEmail } from '@/lib/auth/google';
import { audit } from '@/lib/audit/log';

export type UserActionState = {
  error?: string | undefined;
  ok?: boolean | undefined;
  message?: string | undefined;
};

const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  roleId: z.string().uuid('Select a valid role from the Role Master.'),
  phone: z.string().trim().max(20).optional(),
  password: z.string().optional(),
});

export async function createUserAndMapRole(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const admin = await requireAdmin();
  const domain = allowedAuthDomain();

  const parsed = createUserSchema.safeParse({
    name: formData.get('name') ?? '',
    email: formData.get('email') ?? '',
    roleId: formData.get('roleId') ?? '',
    phone: (formData.get('phone') as string) || undefined,
    password: (formData.get('password') as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const { name, email, roleId, phone, password } = parsed.data;

  // Enforce @dacdevelopers.com domain for all newly mapped staff accounts
  if (!isAllowedStaffEmail(email, { allowDevSeedDomain: false })) {
    return {
      error: `Only @${domain} Google Workspace email addresses can be mapped.`,
    };
  }

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) {
    return { error: 'Selected role does not exist in the Role Master.' };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: `An account for "${email}" already exists.` };
  }

  // If no password is supplied (Google Workspace OAuth user), generate a strong
  // random password hash so the non-null column is satisfied safely.
  const rawPassword =
    password && password.trim().length >= 8
      ? password.trim()
      : randomBytes(24).toString('base64url');
  const passwordHash = await hashPassword(rawPassword);

  const created = await prisma.user.create({
    data: {
      organizationId: admin.organizationId,
      roleId: role.id,
      name,
      email,
      phone: phone || null,
      passwordHash,
      isActive: true,
    },
  });

  await audit({
    organizationId: admin.organizationId,
    userId: admin.id,
    action: 'CREATE',
    after: {
      mappedUserId: created.id,
      email: created.email,
      roleId: role.id,
      roleCode: role.name,
      roleLabel: role.label,
    },
    detail: `Mapped "${created.email}" (${created.name}) to role "${role.label}" [Role ID: ${role.id}].`,
  });

  revalidatePath('/admin/users');
  return {
    ok: true,
    message: `Mapped ${created.name} (${created.email}) to ${role.label}.`,
  };
}

export async function updateUserRoleMapping(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get('userId') ?? '');
  const roleId = String(formData.get('roleId') ?? '');

  if (!userId || !roleId) return;

  const [targetUser, newRole] = await Promise.all([
    prisma.user.findFirst({
      where: { id: userId, organizationId: admin.organizationId },
      include: { role: true },
    }),
    prisma.role.findUnique({ where: { id: roleId } }),
  ]);

  if (!targetUser || !newRole || targetUser.roleId === newRole.id) return;

  // Prevent locking out the last active admin
  if (targetUser.role.name === 'ADMIN' && newRole.name !== 'ADMIN') {
    const activeAdminCount = await prisma.user.count({
      where: {
        organizationId: admin.organizationId,
        isActive: true,
        role: { name: 'ADMIN' },
      },
    });
    if (activeAdminCount <= 1) {
      return;
    }
  }

  await prisma.user.update({
    where: { id: targetUser.id },
    data: { roleId: newRole.id },
  });

  await audit({
    organizationId: admin.organizationId,
    userId: admin.id,
    action: 'EDIT',
    before: { roleId: targetUser.roleId, role: targetUser.role.name },
    after: { roleId: newRole.id, role: newRole.name },
    detail: `Changed role mapping for "${targetUser.email}" from "${targetUser.role.label}" to "${newRole.label}" [Role ID: ${newRole.id}].`,
  });

  revalidatePath('/admin/users');
}

export async function toggleUserActive(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get('userId') ?? '');

  if (!userId || userId === admin.id) return;

  const targetUser = await prisma.user.findFirst({
    where: { id: userId, organizationId: admin.organizationId },
    include: { role: true },
  });
  if (!targetUser) return;

  const nextActive = !targetUser.isActive;

  await prisma.user.update({
    where: { id: targetUser.id },
    data: { isActive: nextActive },
  });

  if (!nextActive) {
    await destroyAllSessionsFor(targetUser.id);
  }

  await audit({
    organizationId: admin.organizationId,
    userId: admin.id,
    action: 'EDIT',
    before: { isActive: targetUser.isActive },
    after: { isActive: nextActive },
    detail: `${nextActive ? 'Activated' : 'Deactivated'} user "${targetUser.email}" (${targetUser.role.label}).`,
  });

  revalidatePath('/admin/users');
}

export async function updateRoleMasterDetails(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const roleId = String(formData.get('roleId') ?? '');
  const label = String(formData.get('label') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();

  if (!roleId || label.length < 2) return;

  const existing = await prisma.role.findUnique({ where: { id: roleId } });
  if (!existing) return;

  const updated = await prisma.role.update({
    where: { id: existing.id },
    data: {
      label: label.slice(0, 80),
      description: description ? description.slice(0, 240) : null,
    },
  });

  await audit({
    organizationId: admin.organizationId,
    userId: admin.id,
    action: 'EDIT',
    before: { label: existing.label, description: existing.description },
    after: { label: updated.label, description: updated.description },
    detail: `Updated Role Master entry "${existing.name}" [ID: ${existing.id}].`,
  });

  revalidatePath('/admin/users');
}

