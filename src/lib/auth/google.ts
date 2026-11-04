import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { env, isProduction } from '@/lib/env';

/**
 * Google Workspace OAuth 2.0 (OpenID Connect) with PKCE and strict domain
 * enforcement (`@dacdevelopers.com`).
 *
 * Authentication validates identity with Google (`hd=dacdevelopers.com`),
 * then looks up the user's mapped Role in our Postgres `users` <-> `roles`
 * Role Master and creates an opaque database session (`sessions` table).
 */

export const OAUTH_STATE_COOKIE = 'dac_google_oauth';

export function allowedAuthDomain(): string {
  return (env.ALLOWED_AUTH_DOMAIN || 'dacdevelopers.com').trim().toLowerCase();
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_ID.trim().length > 0 &&
      env.GOOGLE_CLIENT_SECRET &&
      env.GOOGLE_CLIENT_SECRET.trim().length > 0,
  );
}

/**
 * Checks whether an email address belongs to the allowed Google Workspace
 * domain (`@dacdevelopers.com`).
 *
 * In local development, `.test` seed accounts are also permitted for password
 * sign-in so developers can log in and configure the Role Master before OAuth
 * credentials are provisioned.
 */
export function isAllowedStaffEmail(
  email: string,
  options: { allowDevSeedDomain?: boolean } = {},
): boolean {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex <= 0) return false;

  const domain = normalized.slice(atIndex + 1);
  if (domain === allowedAuthDomain()) return true;

  if (options.allowDevSeedDomain && !isProduction && domain === 'dac.test') {
    return true;
  }

  return false;
}

export function generatePkcePair(): {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
} {
  const state = randomBytes(24).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { state, codeVerifier, codeChallenge };
}

export function googleCallbackUrl(): string {
  const base = env.APP_URL.replace(/\/+$/, '');
  return `${base}/api/auth/google/callback`;
}

export function buildGoogleAuthorizeUrl(params: {
  state: string;
  codeChallenge: string;
}): string {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured.');
  }

  const domain = allowedAuthDomain();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', googleCallbackUrl());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('hd', domain);
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');

  return url.toString();
}

export type GoogleUserProfile = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  hd?: string;
  picture?: string;
};

export async function exchangeCodeForGoogleProfile(
  code: string,
  codeVerifier: string,
): Promise<GoogleUserProfile> {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials are not configured.');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleCallbackUrl(),
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`Google token exchange failed (${tokenRes.status}).`);
  }

  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    throw new Error('Google token response did not include an access_token.');
  }

  const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) {
    throw new Error(`Google userinfo request failed (${userRes.status}).`);
  }

  const profile = (await userRes.json()) as GoogleUserProfile;
  return profile;
}

