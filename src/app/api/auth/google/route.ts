import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { env, isProduction } from '@/lib/env';
import {
  buildGoogleAuthorizeUrl,
  generatePkcePair,
  isGoogleOAuthConfigured,
  OAUTH_STATE_COOKIE,
} from '@/lib/auth/google';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isSafeNext(value: string | null): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

export async function GET(request: Request): Promise<NextResponse> {
  const reqUrl = new URL(request.url);
  const nextParam = reqUrl.searchParams.get('next');
  const nextPath = isSafeNext(nextParam) ? nextParam : '';

  if (!isGoogleOAuthConfigured()) {
    const loginUrl = new URL('/login', env.APP_URL);
    loginUrl.searchParams.set(
      'error',
      'Google OAuth is not yet configured in .env (missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).',
    );
    if (nextPath) loginUrl.searchParams.set('next', nextPath);
    return NextResponse.redirect(loginUrl);
  }

  const { state, codeVerifier, codeChallenge } = generatePkcePair();
  const payload = JSON.stringify({ state, codeVerifier, next: nextPath });

  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE, Buffer.from(payload, 'utf8').toString('base64url'), {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  });

  const authorizeUrl = buildGoogleAuthorizeUrl({ state, codeChallenge });
  return NextResponse.redirect(authorizeUrl);
}

