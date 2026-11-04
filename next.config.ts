import type { NextConfig } from 'next';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Content-Security-Policy.
 *
 * ## Why there is no nonce
 *
 * The strict, nonce-based CSP that Next documents is generated in middleware —
 * and `src/proxy.ts` is forbidden from doing anything beyond checking for a
 * cookie, because Vercel may run it outside India (PLAN.md §3). Generating a
 * per-request nonce there is harmless in itself, but the rule is deliberately
 * absolute: no logic in the proxy, so nobody later adds logic that reads a
 * name or a booking field. A weaker CSP is the price, and it is the right way
 * round — residency is a legal obligation, this is defence in depth.
 *
 * So `'unsafe-inline'` stays for scripts and styles (Next's hydration bootstrap
 * and Tailwind's injected styles both need it). What the policy still buys is
 * the part that actually blocks the common attacks: no framing, no base-tag
 * hijack, no form posting off-site, no plugins, and a closed list of origins
 * anything may be loaded from or sent to.
 *
 * ## The storage host
 *
 * Documents and signatures are served by redirecting to a short-lived signed
 * URL on the storage provider, so the browser ends up loading an image from
 * `*.supabase.co`, not from this origin. Omitting it would silently blank
 * every photograph and signature in production while working perfectly in
 * development, where the local driver serves them from `/api`.
 */
function contentSecurityPolicy(): string {
  const supabaseHost = (() => {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return null;
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  })();

  const imgSources = ["'self'", 'data:', 'blob:', supabaseHost].filter(Boolean);
  const connectSources = ["'self'", supabaseHost].filter(Boolean);

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `img-src ${imgSources.join(' ')}`,
    `connect-src ${connectSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // 'unsafe-eval' is only needed by the development React refresh runtime.
    isProduction
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    ...(isProduction ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/**
 * Security headers applied to every response.
 * Note: personal data must never be cached by the CDN — authenticated routes
 * additionally set `Cache-Control: private, no-store` in their handlers.
 * See PLAN.md §3 (data residency).
 */
const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ...((isProduction ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }] : [])),
  // Belt and braces with frame-ancestors above, for anything that still reads
  // the older header.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Fail the production build on type errors rather than shipping them.
  // (Next 16 removed the `eslint` config key along with built-in `next lint`;
  // linting runs as its own CI step — `npm run lint`.)
  typescript: { ignoreBuildErrors: false },

  // Keep the native argon2 binding out of the client/webpack bundle.
  serverExternalPackages: ['@node-rs/argon2'],

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
