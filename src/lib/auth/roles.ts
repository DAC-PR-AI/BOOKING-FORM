import type { RoleName } from '@prisma/client';

/**
 * Pure role helpers — no database, no `server-only`, so they can be unit
 * tested and imported from anywhere. The enforcing wrappers live in rbac.ts.
 */

/** Roles that act as signatories in the pipeline. */
export const SIGNATORY_ROLES: RoleName[] = [
  'AGM',
  'DGM_GM',
  'VP_SALES',
  'SALES_COORDINATOR',
  'MIS',
  'DIRECTOR',
  'CRM',
];

export function isSignatory(role: RoleName): boolean {
  return SIGNATORY_ROLES.includes(role);
}

/** Where each role lands after signing in. */
export function homePathFor(role: RoleName): string {
  switch (role) {
    case 'ADMIN':
      return '/admin/users';
    case 'SALES_EXECUTIVE':
      return '/forms';
    case 'SALES_COORDINATOR':
      return '/coordinator/queue';
    default:
      return '/signatory/queue';
  }
}
