import { NextResponse, type NextRequest } from 'next/server';
import { PUBLIC_PATHS, SESSION_COOKIE } from '@/lib/auth/constants';

/**
 * ⚠️ DATA RESIDENCY BOUNDARY — read before editing.
 *
 * This file was `middleware.ts` until Next 16, which renamed the convention to
 * `proxy.ts` and fixed its runtime to Node (the Edge runtime is not supported
 * here and cannot be configured).
 *
 * Vercel documents Routing Middleware as deploying to ALL regions regardless of
 * the `regions` setting in vercel.json — pinning the project to `bom1` (Mumbai)
 * does NOT pin it. Whether the renamed Node-runtime `proxy` still behaves that
 * way, or now runs at origin in `bom1`, is NOT settled: the Next 16 docs and
 * Vercel's region docs disagree, and we have not yet confirmed it on a real
 * deployment. Verify in Phase 8 by checking the function region in Vercel logs.
 *
 * Until that is confirmed, assume code here may execute OUTSIDE INDIA. The
 * restriction below costs us nothing and is correct either way.
 *
 * Therefore this file may ONLY:
 *   * check whether a session cookie is PRESENT, and
 *   * redirect.
 *
 * It must NEVER:
 *   * decrypt or verify the session token,
 *   * query the database,
 *   * read a name, PAN, Aadhaar, or any booking field.
 *
 * Real authentication and authorisation happen in Server Actions and Route
 * Handlers, which do run in `bom1`. A present-but-invalid cookie is caught
 * there and the user is bounced to /login.
 */

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);

  // Signed in (or at least holding a cookie) and heading for the login page.
  if (isPublic && hasSessionCookie && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  if (isPublic) return NextResponse.next();

  if (!hasSessionCookie) {
    const loginUrl = new URL('/login', request.url);
    // Preserve where they were going, so login can send them back.
    if (pathname !== '/') loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   api routes (they authorise themselves, in-region)
     *   _next static assets and image optimisation
     *   static files (favicon, brand assets, etc.)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|brand|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
