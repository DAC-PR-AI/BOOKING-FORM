import 'server-only';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit/log';
import { hashPassword } from '@/lib/auth/password';
import { googleUsersConfig, readUsersRows, sheetUrl } from '@/lib/google/sheets';
import { parseUserSheet, type SheetUser, type UserSheetProblem } from './sheet';

export type UserSyncOutcome =
  | {
    ok: true;
    created: number;
    updated: number;
    unchanged: number;
    deactivated: number;
    problems: UserSheetProblem[];
    sheetLink: string;
    at: Date;
  }
  | { ok: false; error: string; at: Date };

export type UserSyncStatus = {
  configured: boolean;
  sheetLink: string | null;
  tab: string | null;
  lastSyncedAt: Date | null;
  activeUsers: number;
  totalUsers: number;
};

export async function userSyncStatus(organizationId: string): Promise<UserSyncStatus> {
  const config = googleUsersConfig();

  const [activeUsers, totalUsers, latestAudit] = await Promise.all([
    prisma.user.count({ where: { organizationId, isActive: true } }),
    prisma.user.count({ where: { organizationId } }),
    prisma.auditLog.findFirst({
      where: {
        organizationId,
        action: 'SYNC',
      },
      orderBy: { at: 'desc' },
      select: { at: true },
    }),
  ]);

  return {
    configured: config !== null,
    sheetLink: config ? sheetUrl(config) : null,
    tab: config?.tab ?? null,
    lastSyncedAt: latestAudit?.at ?? null,
    activeUsers,
    totalUsers,
  };
}

export async function runUserSync({
  organizationId,
  userId,
  dryRun = false,
}: {
  organizationId: string;
  userId: string;
  dryRun?: boolean;
}): Promise<UserSyncOutcome> {
  const at = new Date();
  const config = googleUsersConfig();

  if (!config) {
    return {
      ok: false,
      error:
        'Google Sheets integration is not configured. Check GOOGLE_SERVICE_ACCOUNT_EMAIL, ' +
        'GOOGLE_PRIVATE_KEY, and GOOGLE_USERS_SHEET_ID in .env.',
      at,
    };
  }

  let rows: string[][];
  try {
    rows = await readUsersRows(config);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      at,
    };
  }

  const { users: sheetUsers, problems } = parseUserSheet(rows);

  if (problems.length > 0 && sheetUsers.length === 0) {
    return {
      ok: false,
      error: `Could not parse sheet: ${problems[0]?.reason ?? 'Unknown error'}`,
      at,
    };
  }

  // Fetch all roles from DB
  const roles = await prisma.role.findMany({ select: { id: true, name: true } });
  const roleMap = new Map(roles.map((r) => [r.name, r.id]));

  // Fetch current users in DB
  const existingUsers = await prisma.user.findMany({
    where: { organizationId },
    select: {
      id: true,
      email: true,
      name: true,
      roleId: true,
      phone: true,
      isActive: true,
    },
  });
  const existingByEmail = new Map(existingUsers.map((u) => [u.email.toLowerCase(), u]));

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let deactivated = 0;

  type Action =
    | { type: 'CREATE'; user: SheetUser; roleId: string }
    | { type: 'UPDATE'; id: string; user: SheetUser; roleId: string }
    | { type: 'DEACTIVATE'; id: string; email: string };

  const actions: Action[] = [];

  for (const sheetUser of sheetUsers) {
    const roleId = roleMap.get(sheetUser.roleName);
    if (!roleId) {
      problems.push({
        sourceRow: sheetUser.sourceRow,
        reason: `Role ${sheetUser.roleName} not found in database.`,
      });
      continue;
    }

    const existing = existingByEmail.get(sheetUser.email);
    if (!existing) {
      if (sheetUser.isActive) {
        actions.push({ type: 'CREATE', user: sheetUser, roleId });
        created++;
      }
    } else {
      const needsUpdate =
        existing.name !== sheetUser.name ||
        existing.roleId !== roleId ||
        existing.phone !== sheetUser.phone ||
        existing.isActive !== sheetUser.isActive;

      if (needsUpdate) {
        actions.push({ type: 'UPDATE', id: existing.id, user: sheetUser, roleId });
        if (!sheetUser.isActive && existing.isActive) {
          deactivated++;
        } else {
          updated++;
        }
      } else {
        unchanged++;
      }
    }
  }

  if (dryRun) {
    return {
      ok: true,
      created,
      updated,
      unchanged,
      deactivated,
      problems,
      sheetLink: sheetUrl(config),
      at,
    };
  }

  // Execute database writes in a transaction
  await prisma.$transaction(async (tx) => {
    for (const action of actions) {
      if (action.type === 'CREATE') {
        // Cryptographically secure random decoy hash so password login is disabled
        // Staff authenticate via Google Workspace OAuth (@dacdevelopers.com)
        const randomSecret = randomBytes(32).toString('hex');
        const dummyHash = await hashPassword(randomSecret);

        await tx.user.create({
          data: {
            organizationId,
            email: action.user.email,
            name: action.user.name,
            roleId: action.roleId,
            phone: action.user.phone,
            passwordHash: dummyHash,
            isActive: action.user.isActive,
          },
        });
      } else if (action.type === 'UPDATE') {
        await tx.user.update({
          where: { id: action.id },
          data: {
            name: action.user.name,
            roleId: action.roleId,
            phone: action.user.phone,
            isActive: action.user.isActive,
          },
        });

        // If deactivated, revoke active sessions
        if (!action.user.isActive) {
          await tx.session.deleteMany({ where: { userId: action.id } });
        }
      }
    }
  });

  // Audit log
  await audit({
    organizationId,
    userId,
    action: 'SYNC',
    detail: `User sync: ${created} created, ${updated} updated, ${unchanged} unchanged, ${deactivated} deactivated.`,
  });

  return {
    ok: true,
    created,
    updated,
    unchanged,
    deactivated,
    problems,
    sheetLink: sheetUrl(config),
    at,
  };
}
