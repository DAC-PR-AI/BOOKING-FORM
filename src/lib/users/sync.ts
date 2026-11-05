import 'server-only';
import { randomBytes } from 'node:crypto';
import { RoleName } from '@prisma/client';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit/log';
import { allowedAuthDomain } from '@/lib/auth/google';
import { hashPassword } from '@/lib/auth/password';
import { googleUsersConfig, readUsersRows, sheetUrl } from '@/lib/google/sheets';
import {
  parseUserSheet,
  planUserSync,
  type ExistingUserForSync,
  type PlanUserSyncResult,
  type SheetUser,
  type UserRoleForSync,
  type UserSheetProblem,
  type UserSyncAction,
} from './sheet';

export {
  planUserSync,
  type ExistingUserForSync,
  type PlanUserSyncResult,
  type UserRoleForSync,
  type UserSyncAction,
};

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

  const { users: sheetUsers, problems } = parseUserSheet(rows, {
    allowedDomain: allowedAuthDomain(),
  });

  if (problems.length > 0 && sheetUsers.length === 0) {
    return {
      ok: false,
      error: `Could not parse sheet: ${problems[0]?.reason ?? 'Unknown error'}`,
      at,
    };
  }

  // Fetch all roles from DB
  const roles = await prisma.role.findMany({ select: { id: true, name: true } });

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

  const {
    actions,
    problems: syncProblems,
    created,
    updated,
    unchanged,
    deactivated,
  } = planUserSync({
    sheetUsers,
    roles,
    existingUsers,
    initialProblems: problems,
  });

  if (dryRun) {
    return {
      ok: true,
      created,
      updated,
      unchanged,
      deactivated,
      problems: syncProblems,
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

        // If deactivated or role changed, revoke active sessions
        if (action.revokeSessions) {
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
    problems: syncProblems,
    sheetLink: sheetUrl(config),
    at,
  };
}
