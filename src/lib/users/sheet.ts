import { RoleName } from '@prisma/client';

export type SheetUser = {
  email: string;
  name: string;
  roleName: RoleName;
  phone: string | null;
  isActive: boolean;
  sourceRow: number;
};

export type UserSheetProblem = {
  sourceRow: number;
  reason: string;
};

export type ParsedUserSheet = {
  users: SheetUser[];
  problems: UserSheetProblem[];
  columns: {
    email: string | null;
    name: string | null;
    role: string | null;
    phone: string | null;
    status: string | null;
  };
};

const HEADERS = {
  email: ['email', 'user email', 'mail', 'email address'],
  name: ['name', 'full name', 'fullname', 'staff name', 'employee name'],
  role: ['role', 'designation', 'user role', 'role code', 'system role'],
  phone: ['phone', 'mobile', 'contact', 'phone number', 'mobile number'],
  status: ['status', 'active', 'is active', 'state'],
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeHeader(cell: string): string {
  return cell.toLowerCase().trim().replace(/[^a-z0-9]/g, ' ');
}

export function normalizeRole(raw: string): RoleName | null {
  const clean = raw.toUpperCase().trim().replace(/[\/\s-]+/g, '_');

  if (clean in RoleName) {
    return clean as RoleName;
  }

  // Common aliases
  if (clean === 'DGM' || clean === 'GM' || clean === 'DGM_GM') return RoleName.DGM_GM;
  if (clean === 'SALES_EXEC' || clean === 'SE' || clean === 'EXECUTIVE') return RoleName.SALES_EXECUTIVE;
  if (clean === 'COORDINATOR' || clean === 'SC') return RoleName.SALES_COORDINATOR;
  if (clean === 'VP' || clean === 'VICE_PRESIDENT') return RoleName.VP_SALES;
  if (clean === 'DIR') return RoleName.DIRECTOR;
  if (clean === 'ADMINISTRATOR') return RoleName.ADMIN;

  return null;
}

export function parseUserSheet(
  rows: string[][],
  options?: { allowedDomain?: string },
): ParsedUserSheet {
  if (rows.length === 0 || !rows[0]) {
    return {
      users: [],
      problems: [{ sourceRow: 1, reason: 'Sheet is empty — no rows found.' }],
      columns: { email: null, name: null, role: null, phone: null, status: null },
    };
  }

  const allowedDomain = (
    options?.allowedDomain ??
    process.env.ALLOWED_AUTH_DOMAIN ??
    'dacdevelopers.com'
  )
    .trim()
    .toLowerCase();

  const [headerRow, ...dataRows] = rows;
  const colIndices: {
    email: number;
    name: number;
    role: number;
    phone: number;
    status: number;
  } = { email: -1, name: -1, role: -1, phone: -1, status: -1 };

  const columns = {
    email: null as string | null,
    name: null as string | null,
    role: null as string | null,
    phone: null as string | null,
    status: null as string | null,
  };

  headerRow.forEach((cell, idx) => {
    const norm = normalizeHeader(cell);
    for (const [key, aliases] of Object.entries(HEADERS)) {
      if (aliases.some((alias) => norm === alias || norm.includes(alias))) {
        if (colIndices[key as keyof typeof colIndices] === -1) {
          colIndices[key as keyof typeof colIndices] = idx;
          columns[key as keyof typeof columns] = cell.trim();
        }
      }
    }
  });

  const problems: UserSheetProblem[] = [];

  if (colIndices.email === -1) {
    problems.push({ sourceRow: 1, reason: 'Missing required "Email" column in header.' });
  }
  if (colIndices.name === -1) {
    problems.push({ sourceRow: 1, reason: 'Missing required "Name" column in header.' });
  }
  if (colIndices.role === -1) {
    problems.push({ sourceRow: 1, reason: 'Missing required "Role" column in header.' });
  }

  if (problems.length > 0) {
    return { users: [], problems, columns };
  }

  const users: SheetUser[] = [];
  const seenEmails = new Set<string>();

  dataRows.forEach((row, rowIdx) => {
    const sourceRow = rowIdx + 2; // 1-based, skipping header
    const rawEmail = (row[colIndices.email] || '').trim().toLowerCase();
    const rawName = (row[colIndices.name] || '').trim().slice(0, 120);
    const rawRole = (row[colIndices.role] || '').trim();
    const rawPhone = colIndices.phone !== -1 ? (row[colIndices.phone] || '').trim().slice(0, 20) : '';
    const rawStatus = colIndices.status !== -1 ? (row[colIndices.status] || '').trim() : '';

    // Ignore completely empty row
    if (!rawEmail && !rawName && !rawRole) return;

    if (!rawEmail || !EMAIL_PATTERN.test(rawEmail)) {
      problems.push({
        sourceRow,
        reason: `Row ${sourceRow}: Invalid or missing email address (${rawEmail || 'empty'}).`,
      });
      return;
    }

    if (allowedDomain && !rawEmail.endsWith(`@${allowedDomain}`)) {
      problems.push({
        sourceRow,
        reason: `Row ${sourceRow}: Email "${rawEmail}" must belong to @${allowedDomain}.`,
      });
      return;
    }

    if (seenEmails.has(rawEmail)) {
      problems.push({
        sourceRow,
        reason: `Row ${sourceRow}: Duplicate email "${rawEmail}" in sheet.`,
      });
      return;
    }
    seenEmails.add(rawEmail);

    if (!rawName) {
      problems.push({ sourceRow, reason: `Row ${sourceRow}: Missing staff name.` });
      return;
    }

    const roleName = normalizeRole(rawRole);
    if (!roleName) {
      problems.push({
        sourceRow,
        reason: `Row ${sourceRow}: Invalid role "${rawRole}". Valid roles are: ${Object.values(RoleName).join(', ')}.`,
      });
      return;
    }

    const isInactive = ['inactive', 'no', 'false', '0', 'disabled', 'blocked'].includes(
      rawStatus.toLowerCase(),
    );

    users.push({
      email: rawEmail,
      name: rawName,
      roleName,
      phone: rawPhone || null,
      isActive: !isInactive,
      sourceRow,
    });
  });

  return { users, problems, columns };
}

export interface ExistingUserForSync {
  id: string;
  email: string;
  name: string;
  roleId: string;
  phone: string | null;
  isActive: boolean;
}

export interface UserRoleForSync {
  id: string;
  name: RoleName;
}

export type UserSyncAction =
  | { type: 'CREATE'; user: SheetUser; roleId: string }
  | {
      type: 'UPDATE';
      id: string;
      user: SheetUser;
      roleId: string;
      revokeSessions: boolean;
    };

export interface PlanUserSyncResult {
  actions: UserSyncAction[];
  problems: UserSheetProblem[];
  created: number;
  updated: number;
  unchanged: number;
  deactivated: number;
}

export function planUserSync({
  sheetUsers,
  roles,
  existingUsers,
  initialProblems = [],
}: {
  sheetUsers: SheetUser[];
  roles: UserRoleForSync[];
  existingUsers: ExistingUserForSync[];
  initialProblems?: UserSheetProblem[];
}): PlanUserSyncResult {
  const problems: UserSheetProblem[] = [...initialProblems];
  const roleMap = new Map(roles.map((r) => [r.name, r.id]));
  const adminRoleId = roleMap.get(RoleName.ADMIN);

  const existingByEmail = new Map(existingUsers.map((u) => [u.email.toLowerCase(), u]));

  // Track active admins so a sheet typo cannot accidentally demote or deactivate
  // the last active Administrator and lock out the entire organization.
  let remainingActiveAdmins = existingUsers.filter(
    (u) => u.isActive && u.roleId === adminRoleId,
  ).length;

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let deactivated = 0;

  const actions: UserSyncAction[] = [];

  for (const sheetUser of sheetUsers) {
    const roleId = roleMap.get(sheetUser.roleName);
    if (!roleId) {
      problems.push({
        sourceRow: sheetUser.sourceRow,
        reason: `Role ${sheetUser.roleName} not found in database.`,
      });
      continue;
    }

    const existing = existingByEmail.get(sheetUser.email.toLowerCase());
    if (!existing) {
      if (sheetUser.isActive) {
        // A new ADMIN must not be mintable by editing the spreadsheet. Promoting an
        // already-existing user to ADMIN via the sheet is still allowed (the UPDATE
        // branch); creating one from nothing is not — do it through the admin UI.
        if (roleId === adminRoleId) {
          problems.push({
            sourceRow: sheetUser.sourceRow,
            reason: `Row ${sheetUser.sourceRow}: Refused to create a new ADMIN ("${sheetUser.email}") from the sheet. Add administrators through the admin UI.`,
          });
          continue;
        }
        actions.push({ type: 'CREATE', user: sheetUser, roleId });
        created++;
      }
    } else {
      const wasActiveAdmin = existing.isActive && existing.roleId === adminRoleId;
      const willBeActiveAdmin = sheetUser.isActive && roleId === adminRoleId;

      if (wasActiveAdmin && !willBeActiveAdmin && remainingActiveAdmins <= 1) {
        problems.push({
          sourceRow: sheetUser.sourceRow,
          reason: `Row ${sheetUser.sourceRow}: Refused to demote or deactivate "${sheetUser.email}" because they are the last active ADMIN.`,
        });
        continue;
      }

      if (wasActiveAdmin && !willBeActiveAdmin) {
        remainingActiveAdmins--;
      } else if (!wasActiveAdmin && willBeActiveAdmin) {
        remainingActiveAdmins++;
      }

      const roleChanged = existing.roleId !== roleId;
      const needsUpdate =
        existing.name !== sheetUser.name ||
        roleChanged ||
        existing.phone !== sheetUser.phone ||
        existing.isActive !== sheetUser.isActive;

      if (needsUpdate) {
        actions.push({
          type: 'UPDATE',
          id: existing.id,
          user: sheetUser,
          roleId,
          revokeSessions: !sheetUser.isActive || roleChanged,
        });
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

  return {
    actions,
    problems,
    created,
    updated,
    unchanged,
    deactivated,
  };
}
