import 'server-only';
import { notFound, redirect } from 'next/navigation';
import type { RoleName } from '@prisma/client';
import { getSessionUser, type SessionUser } from './session';

export { SIGNATORY_ROLES, isSignatory, homePathFor } from './roles';
import { SIGNATORY_ROLES } from './roles';

/**
 * Server-side authorisation. Every Server Action and Route Handler that touches
 * data calls one of these — hidden buttons are not security (PLAN.md §9).
 *
 * Denials use notFound() (404), not a 403. A signatory who is not on step N
 * must not be able to learn that a given booking exists, so "forbidden" and
 * "does not exist" have to be indistinguishable.
 */

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireRole(...allowed: RoleName[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!allowed.includes(user.role.name)) notFound();
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  return requireRole('ADMIN');
}

/** Convenience guard for the signatory area. */
export async function requireSignatory(): Promise<SessionUser> {
  return requireRole(...SIGNATORY_ROLES);
}
