'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { burnPasswordTime, verifyPassword } from '@/lib/auth/password';
import { createSession, destroySession } from '@/lib/auth/session';
import { homePathFor } from '@/lib/auth/rbac';
import { audit } from '@/lib/audit/log';
import { allowedAuthDomain, isAllowedStaffEmail } from '@/lib/auth/google';

export type LoginState = { error?: string | undefined };

/** Account lockout — blunt but effective against credential stuffing. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/**
 * One generic message for every failure mode. Distinguishing "no such user"
 * from "wrong password" would let anyone enumerate staff email addresses.
 */
const GENERIC_ERROR = 'Invalid email or password.';

function isSafeNext(value: string | undefined): value is string {
  // Only same-site absolute paths — never an off-site redirect.
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');
  const next = formData.get('next');
  const nextPath = typeof next === 'string' ? next : undefined;

  if (!email || !email.includes('@') || !password) {
    return { error: GENERIC_ERROR };
  }

  // Enforce @dacdevelopers.com domain (plus @dac.test in local development)
  if (!isAllowedStaffEmail(email, { allowDevSeedDomain: true })) {
    await burnPasswordTime(password);
    return {
      error: `Access is restricted to @${allowedAuthDomain()} accounts only.`,
    };
  }

  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? undefined;
  const userAgent = h.get('user-agent') ?? undefined;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: true },
  });

  if (!user || !user.isActive) {
    // Spend the same time Argon2 would have spent on a real account. Returning
    // straight away here would make an unknown address answer in a millisecond
    // and a known one in ~100ms — a timing oracle that enumerates staff email
    // addresses just as well as a distinct message, defeating GENERIC_ERROR.
    await burnPasswordTime(password);
    return { error: GENERIC_ERROR };
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    return {
      error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    };
  }

  const ok = await verifyPassword(user.passwordHash, password);

  if (!ok) {
    const failed = user.failedLoginCount + 1;
    const shouldLock = failed >= MAX_FAILED_ATTEMPTS;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: shouldLock ? 0 : failed,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });

    await audit({
      organizationId: user.organizationId,
      userId: user.id,
      action: 'LOGIN_FAILED',
      detail: shouldLock
        ? `Locked for ${LOCKOUT_MINUTES} minutes after ${MAX_FAILED_ATTEMPTS} failed attempts.`
        : `Failed attempt ${failed} of ${MAX_FAILED_ATTEMPTS}.`,
    });

    if (shouldLock) {
      return {
        error: `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
      };
    }
    return { error: GENERIC_ERROR };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  await createSession(user.id, { ip, userAgent });

  await audit({
    organizationId: user.organizationId,
    userId: user.id,
    action: 'LOGIN',
    detail: `Signed in as ${user.role.label} [Role ID: ${user.roleId}].`,
  });

  // redirect() throws to unwind — must be outside any try/catch.
  redirect(isSafeNext(nextPath) ? nextPath : homePathFor(user.role.name));
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect('/login');
}
