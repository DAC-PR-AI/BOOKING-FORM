import { NextResponse, type NextRequest } from 'next/server';
import { PUBLIC_PATHS, SESSION_COOKIE } from '@/lib/auth/constants';

/**
 * ⚠️ DATA RESIDENCY BOUNDARY — read before editing.
 *
 * Vercel deploys Routing Middleware to ALL regions regardless of the `regions`
 * setting in vercel.json. Pinning the project to `bom1` (Mumbai) does NOT pin
 * middleware, so any code here may execute outside India.
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

export function middleware(request: NextRequest): NextResponse {
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
