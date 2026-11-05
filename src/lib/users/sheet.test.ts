import { describe, expect, it } from 'vitest';
import { RoleName } from '@prisma/client';
import { parseUserSheet, normalizeRole } from './sheet';

describe('normalizeRole', () => {
  it('recognizes exact role names', () => {
    expect(normalizeRole('ADMIN')).toBe(RoleName.ADMIN);
    expect(normalizeRole('SALES_EXECUTIVE')).toBe(RoleName.SALES_EXECUTIVE);
    expect(normalizeRole('CRM')).toBe(RoleName.CRM);
  });

  it('handles spaces, dashes, slashes, and case insensitivity', () => {
    expect(normalizeRole('sales executive')).toBe(RoleName.SALES_EXECUTIVE);
    expect(normalizeRole('DGM/GM')).toBe(RoleName.DGM_GM);
    expect(normalizeRole('dgm-gm')).toBe(RoleName.DGM_GM);
    expect(normalizeRole('vp sales')).toBe(RoleName.VP_SALES);
  });

  it('recognizes common shortcuts', () => {
    expect(normalizeRole('se')).toBe(RoleName.SALES_EXECUTIVE);
    expect(normalizeRole('coordinator')).toBe(RoleName.SALES_COORDINATOR);
    expect(normalizeRole('dir')).toBe(RoleName.DIRECTOR);
  });

  it('rejects unknown roles', () => {
    expect(normalizeRole('CHIEF_MAGIC_OFFICER')).toBeNull();
    expect(normalizeRole('')).toBeNull();
  });
});

describe('parseUserSheet', () => {
  it('handles empty sheet', () => {
    const res = parseUserSheet([]);
    expect(res.problems.length).toBeGreaterThan(0);
    expect(res.users.length).toBe(0);
  });

  it('flags missing required header columns', () => {
    const res = parseUserSheet([['Some', 'Random', 'Header']]);
    expect(res.problems.length).toBe(3); // missing email, name, role
  });

  it('parses valid user rows belonging to @dacdevelopers.com', () => {
    const rows = [
      ['Email', 'Name', 'Role', 'Phone', 'Status'],
      ['ragil@dacdevelopers.com', 'Ragil Immanuvel', 'ADMIN', '9876543210', 'ACTIVE'],
      ['sales1@dacdevelopers.com', 'Sales One', 'Sales Executive', '9876543211', 'ACTIVE'],
      ['old@dacdevelopers.com', 'Old Staff', 'CRM', '', 'INACTIVE'],
    ];

    const res = parseUserSheet(rows, { allowedDomain: 'dacdevelopers.com' });
    expect(res.problems.length).toBe(0);
    expect(res.users.length).toBe(3);

    expect(res.users[0]).toMatchObject({
      email: 'ragil@dacdevelopers.com',
      name: 'Ragil Immanuvel',
      roleName: RoleName.ADMIN,
      phone: '9876543210',
      isActive: true,
    });

    expect(res.users[1]).toMatchObject({
      email: 'sales1@dacdevelopers.com',
      name: 'Sales One',
      roleName: RoleName.SALES_EXECUTIVE,
      isActive: true,
    });

    expect(res.users[2]).toMatchObject({
      email: 'old@dacdevelopers.com',
      name: 'Old Staff',
      roleName: RoleName.CRM,
      isActive: false,
    });
  });

  it('flags invalid rows, external email domains, and duplicates', () => {
    const rows = [
      ['Email', 'Name', 'Role'],
      ['not-an-email', 'John', 'ADMIN'],
      ['attacker@gmail.com', 'External User', 'ADMIN'],
      ['valid@dacdevelopers.com', 'Jane', 'INVALID_ROLE'],
      ['valid@dacdevelopers.com', 'Duplicate Jane', 'ADMIN'],
    ];

    const res = parseUserSheet(rows, { allowedDomain: 'dacdevelopers.com' });
    expect(res.problems.length).toBe(4);
    expect(res.problems[1]?.reason).toContain('must belong to @dacdevelopers.com');
    expect(res.users.length).toBe(0);
  });
});
