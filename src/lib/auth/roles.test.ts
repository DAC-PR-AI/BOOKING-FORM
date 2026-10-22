import { describe, expect, it } from 'vitest';
import type { RoleName } from '@prisma/client';
import { SIGNATORY_ROLES, homePathFor, isSignatory } from './roles';

describe('signatory roles', () => {
  it('contains the seven pipeline signatories', () => {
    expect(SIGNATORY_ROLES).toEqual([
      'AGM',
      'DGM_GM',
      'VP_SALES',
      'SALES_COORDINATOR',
      'MIS',
      'DIRECTOR',
      'CRM',
    ]);
  });

  it('excludes Admin and Sales Executive', () => {
    expect(isSignatory('ADMIN')).toBe(false);
    expect(isSignatory('SALES_EXECUTIVE')).toBe(false);
  });

  it('includes the Sales Co-ordinator, who validates AND signs', () => {
    expect(isSignatory('SALES_COORDINATOR')).toBe(true);
  });
});

describe('homePathFor', () => {
  const cases: Array<[RoleName, string]> = [
    ['ADMIN', '/admin/users'],
    ['SALES_EXECUTIVE', '/forms'],
    ['SALES_COORDINATOR', '/coordinator/queue'],
    ['AGM', '/signatory/queue'],
    ['DGM_GM', '/signatory/queue'],
    ['VP_SALES', '/signatory/queue'],
    ['MIS', '/signatory/queue'],
    ['DIRECTOR', '/signatory/queue'],
    ['CRM', '/signatory/queue'],
  ];

  it.each(cases)('sends %s to %s', (role, expected) => {
    expect(homePathFor(role)).toBe(expected);
  });

  it('always returns a same-site absolute path', () => {
    for (const [role] of cases) {
      const path = homePathFor(role);
      expect(path.startsWith('/')).toBe(true);
      expect(path.startsWith('//')).toBe(false);
    }
  });
});
