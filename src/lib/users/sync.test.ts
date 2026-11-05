import { describe, expect, it } from 'vitest';
import { RoleName } from '@prisma/client';
import {
  planUserSync,
  type ExistingUserForSync,
  type SheetUser,
  type UserRoleForSync,
} from './sheet';

const ROLES: UserRoleForSync[] = [
  { id: 'role-admin', name: RoleName.ADMIN },
  { id: 'role-se', name: RoleName.SALES_EXECUTIVE },
  { id: 'role-crm', name: RoleName.CRM },
];

function sheetUser(overrides: Partial<SheetUser> = {}): SheetUser {
  return {
    email: 'newuser@dacdevelopers.com',
    name: 'New User',
    roleName: RoleName.SALES_EXECUTIVE,
    phone: '9876543210',
    isActive: true,
    sourceRow: 2,
    ...overrides,
  };
}

function existingUser(overrides: Partial<ExistingUserForSync> = {}): ExistingUserForSync {
  return {
    id: 'user-1',
    email: 'admin@dacdevelopers.com',
    name: 'Existing Admin',
    roleId: 'role-admin',
    phone: '9876543200',
    isActive: true,
    ...overrides,
  };
}

describe('planUserSync — Sheet privilege escalation guards', () => {
  it('refuses to create a brand-new user with role ADMIN from the sheet and reports a problem, while allowing valid non-admin rows', () => {
    const existing = [existingUser()];
    const sheet = [
      sheetUser({
        email: 'attacker@dacdevelopers.com',
        name: 'Attacker Admin',
        roleName: RoleName.ADMIN,
        sourceRow: 2,
      }),
      sheetUser({
        email: 'sales@dacdevelopers.com',
        name: 'Sales Person',
        roleName: RoleName.SALES_EXECUTIVE,
        sourceRow: 3,
      }),
    ];

    const plan = planUserSync({
      sheetUsers: sheet,
      roles: ROLES,
      existingUsers: existing,
    });

    expect(plan.created).toBe(1);
    expect(plan.actions).toEqual([
      {
        type: 'CREATE',
        user: sheet[1],
        roleId: 'role-se',
      },
    ]);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0]).toEqual({
      sourceRow: 2,
      reason:
        'Row 2: Refused to create a new ADMIN ("attacker@dacdevelopers.com") from the sheet. Add administrators through the admin UI.',
    });
  });

  it('still allows promoting an existing non-admin user to ADMIN via the sheet', () => {
    const existing = [
      existingUser({ id: 'user-admin', email: 'admin@dacdevelopers.com' }),
      existingUser({
        id: 'user-staff',
        email: 'staff@dacdevelopers.com',
        name: 'Staff Member',
        roleId: 'role-se',
      }),
    ];

    const sheet = [
      sheetUser({
        email: 'staff@dacdevelopers.com',
        name: 'Staff Member',
        roleName: RoleName.ADMIN,
        sourceRow: 3,
      }),
    ];

    const plan = planUserSync({
      sheetUsers: sheet,
      roles: ROLES,
      existingUsers: existing,
    });

    expect(plan.problems).toHaveLength(0);
    expect(plan.updated).toBe(1);
    expect(plan.actions).toEqual([
      {
        type: 'UPDATE',
        id: 'user-staff',
        user: sheet[0],
        roleId: 'role-admin',
        revokeSessions: true,
      },
    ]);
  });

  it('prevents demoting the last existing admin even when a new-admin row is in the sheet (phantom replacement cannot mask last-admin guard)', () => {
    const existing = [
      existingUser({
        id: 'user-only-admin',
        email: 'lastadmin@dacdevelopers.com',
        roleId: 'role-admin',
        isActive: true,
      }),
    ];

    const sheet = [
      // New admin row (which must be rejected)
      sheetUser({
        email: 'newadmin@dacdevelopers.com',
        roleName: RoleName.ADMIN,
        sourceRow: 2,
      }),
      // Row attempting to demote the sole existing admin to SALES_EXECUTIVE
      sheetUser({
        email: 'lastadmin@dacdevelopers.com',
        roleName: RoleName.SALES_EXECUTIVE,
        sourceRow: 3,
      }),
    ];

    const plan = planUserSync({
      sheetUsers: sheet,
      roles: ROLES,
      existingUsers: existing,
    });

    expect(plan.created).toBe(0);
    expect(plan.updated).toBe(0);
    expect(plan.actions).toHaveLength(0);

    // Both rows must be flagged as problems
    expect(plan.problems).toHaveLength(2);
    expect(plan.problems[0]?.reason).toContain('Refused to create a new ADMIN');
    expect(plan.problems[1]?.reason).toContain(
      'Refused to demote or deactivate "lastadmin@dacdevelopers.com" because they are the last active ADMIN',
    );
  });
});
