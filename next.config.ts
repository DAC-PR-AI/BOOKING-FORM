import type { NextConfig } from 'next';

/**
 * Security headers applied to every response.
 * Note: personal data must never be cached by the CDN — authenticated routes
 * additionally set `Cache-Control: private, no-store` in their handlers.
 * See PLAN.md §3 (data residency).
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
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
