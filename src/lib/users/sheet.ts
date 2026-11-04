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

export function parseUserSheet(rows: string[][]): ParsedUserSheet {
  if (rows.length === 0 || !rows[0]) {
    return {
      users: [],
      problems: [{ sourceRow: 1, reason: 'Sheet is empty — no rows found.' }],
      columns: { email: null, name: null, role: null, phone: null, status: null },
    };
  }

  const [headerRow, ...dataRows] = rows;
  const colIndices: {
    email: number;
    name: number;
    role: number;
    phone: number;
    status: number;
  } = { email: -1, name: -1, role: -1, phone: -1, status: -1 };

  const columns = { email: null as string | null, name: null as string | null, role: null as string | null, phone: null as string | null, status: null as string | null };

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
    const rawName = (row[colIndices.name] || '').trim();
    const rawRole = (row[colIndices.role] || '').trim();
    const rawPhone = colIndices.phone !== -1 ? (row[colIndices.phone] || '').trim() : '';
    const rawStatus = colIndices.status !== -1 ? (row[colIndices.status] || '').trim() : '';

    // Ignore completely empty row
    if (!rawEmail && !rawName && !rawRole) return;

    if (!rawEmail || !rawEmail.includes('@')) {
      problems.push({ sourceRow, reason: `Row ${sourceRow}: Invalid or missing email address (${rawEmail || 'empty'}).` });
      return;
    }

    if (seenEmails.has(rawEmail)) {
      problems.push({ sourceRow, reason: `Row ${sourceRow}: Duplicate email "${rawEmail}" in sheet.` });
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

    const isInactive = ['inactive', 'no', 'false', '0', 'disabled', 'blocked'].includes(rawStatus.toLowerCase());

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
