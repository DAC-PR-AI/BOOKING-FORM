import { timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { createSession } from '@/lib/auth/session';
import { homePathFor } from '@/lib/auth/rbac';
import { audit } from '@/lib/audit/log';
import {
  allowedAuthDomain,
  exchangeCodeForGoogleProfile,
  isAllowedStaffEmail,
  OAUTH_STATE_COOKIE,
} from '@/lib/auth/google';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeStateEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function loginRedirect(errorMessage: string, nextPath?: string): NextResponse {
  const url = new URL('/login', env.APP_URL);
  url.searchParams.set('error', errorMessage);
  if (nextPath) url.searchParams.set('next', nextPath);
  return NextResponse.redirect(url);
}

export async function GET(request: Request): Promise<NextResponse> {
  const reqUrl = new URL(request.url);
  const code = reqUrl.searchParams.get('code');
  const state = reqUrl.searchParams.get('state');
  const oauthError = reqUrl.searchParams.get('error');


  const cookieStore = await cookies();
  const rawStateCookie = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);

  if (oauthError) {
    return loginRedirect('Google sign-in was cancelled or denied.');
  }

  if (!code || !state || !rawStateCookie) {
    return loginRedirect('Invalid or expired Google sign-in session. Please try again.');
  }

  let storedState: { state?: string; codeVerifier?: string; next?: string } = {};
  try {
    storedState = JSON.parse(Buffer.from(rawStateCookie, 'base64url').toString('utf8'));
  } catch {
    return loginRedirect('Invalid Google OAuth state cookie.');
  }

  if (!storedState.state || !safeStateEquals(storedState.state, state) || !storedState.codeVerifier) {
    return loginRedirect('Google OAuth state mismatch. Please try again.');
  }

  const nextPath = storedState.next || undefined;

  let profile;
  try {
    profile = await exchangeCodeForGoogleProfile(code, storedState.codeVerifier);
  } catch {
    return loginRedirect('Could not verify your Google account. Please try again.', nextPath);
  }

  const email = (profile.email || '').trim().toLowerCase();
  const domain = allowedAuthDomain();

  // Strict domain enforcement: ONLY verified @dacdevelopers.com Google Workspace
  // accounts with a matching `hd` (hosted domain) claim are permitted.
  if (
    profile.email_verified !== true ||
    !isAllowedStaffEmail(email, { allowDevSeedDomain: false }) ||
    profile.hd?.toLowerCase() !== domain
  ) {
    return loginRedirect(
      `Access denied: Only @${domain} Google Workspace accounts are permitted.`,
      nextPath,
    );
  }

  // Look up the user and their mapped Role from the Role Master
  // Retry once on transient connection drops (e.g. first query after laptop sleep).
  let user;
  try {
    user = await prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });
  } catch {
    try {
      user = await prisma.user.findUnique({
        where: { email },
        include: { role: true },
      });
    } catch (retryError) {
      console.error('[auth/google] database lookup failed after retry', retryError);
      return loginRedirect(
        'Database connection timed out. Please try signing in again.',
        nextPath,
      );
    }
  }

  if (!user) {
    return loginRedirect(
      `Your account (${email}) is not yet mapped to a role in the Role Master. Please contact an Administrator.`,
      nextPath,
    );
  }

  if (!user.isActive) {
    await audit({
      organizationId: user.organizationId,
      userId: user.id,
      action: 'LOGIN_FAILED',
      detail: `Deactivated Google account (${email}) attempted to sign in.`,
    });
    return loginRedirect(
      'Your account has been deactivated. Please contact an Administrator.',
      nextPath,
    );
  }

  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? undefined;
  const userAgent = h.get('user-agent') ?? undefined;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      ...(profile.name && !user.name ? { name: profile.name } : {}),
    },
  });

  await createSession(user.id, { ip, userAgent });

  await audit({
    organizationId: user.organizationId,
    userId: user.id,
    action: 'LOGIN',
    detail: `Signed in via Google Workspace (${email}) as ${user.role.label} [Role ID: ${user.roleId}].`,
  });

  const destination =
    nextPath && nextPath.startsWith('/') && !nextPath.startsWith('//')
      ? nextPath
      : homePathFor(user.role.name);

  return NextResponse.redirect(new URL(destination, env.APP_URL));
}
