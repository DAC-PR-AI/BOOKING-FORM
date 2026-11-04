import type { Metadata } from 'next';
import Link from 'next/link';
import { allowedAuthDomain, isGoogleOAuthConfigured } from '@/lib/auth/google';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in — DAC Developers' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error: oauthError } = await searchParams;
  const domain = allowedAuthDomain();
  const googleConfigured = isGoogleOAuthConfigured();
  const googleHref = next
    ? `/api/auth/google?next=${encodeURIComponent(next)}`
    : '/api/auth/google';

  return (
    <main className="flex min-h-screen flex-col lg:flex-row bg-slate-50">
      {/* Left Architectural Brand Showcase Panel */}
      <div className="relative hidden lg:flex lg:w-5/12 xl:w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-dac-navy-900 via-dac-navy-800 to-dac-navy-700 p-12 text-white">
        {/* Subtle decorative background accents */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -left-24 h-96 w-96 rounded-full bg-dac-orange-500/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 bottom-0 h-96 w-96 rounded-full bg-dac-navy-500/25 blur-3xl"
        />

        <div className="relative z-10">
          <div className="inline-flex items-center gap-3 rounded-xl bg-white/95 px-4 py-2.5 shadow-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/dac-logo.png"
              alt="DAC Developers"
              className="h-9 w-auto object-contain"
            />
            <div className="h-5 w-px bg-slate-200" />
            <span className="text-xs font-bold tracking-wider text-dac-navy-900 uppercase">
              Booking Portal
            </span>
          </div>

          <div className="mt-14 max-w-lg">
            <div className="mb-4 flex items-center gap-2">
              <span className="h-1.5 w-12 rounded-full bg-dac-orange-500" />
              <span className="text-xs font-semibold tracking-widest text-dac-orange-400 uppercase">
                DAC Developers Pvt Ltd
              </span>
            </div>
            <h2 className="text-3xl xl:text-4xl font-bold tracking-tight text-white leading-tight">
              Digital Booking &amp; Multi-Stage Approval Suite
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              End-to-end paperless allotment capture with Verhoeff Aadhaar validation, AES-256-GCM
              field encryption, 9-stage role-mapped signatures, and write-once A4 PDF generation.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-2 gap-4 max-w-lg">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-xs">
              <p className="text-xs font-semibold tracking-wider text-dac-orange-400 uppercase">
                9-Stage Pipeline
              </p>
              <p className="mt-1 text-xs text-slate-300">
                In-person Applicant capture through AGM, GM, VP Sales, Co-ordinator, MIS, Director
                &amp; CRM.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-xs">
              <p className="text-xs font-semibold tracking-wider text-dac-orange-400 uppercase">
                DPDP Compliant
              </p>
              <p className="mt-1 text-xs text-slate-300">
                Encrypted PAN &amp; Aadhaar storage with strict role-master access &amp; audit trail.
              </p>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between border-t border-white/15 pt-6 text-xs text-slate-300">
          <span>Restricted to @{domain} Google Workspace</span>
          <span className="rounded-full bg-white/10 px-3 py-1 font-medium text-white">
            India Region (IST)
          </span>
        </div>
      </div>

      {/* Right Sign-In Column */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-8 lg:px-12">
        <div className="w-full max-w-md">
          {/* Brand header (visible on all screens, compact on desktop) */}
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/dac-logo.png"
                alt="DAC Developers"
                className="h-12 w-auto object-contain"
              />
            </div>
            <div className="mb-3 flex items-center gap-1.5" aria-hidden="true">
              <span className="h-1.5 w-10 rounded-full bg-dac-navy-700" />
              <span className="h-1.5 w-4 rounded-full bg-dac-orange-500" />
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              DAC Booking Portal
            </h1>
            <p className="mt-1.5 text-sm text-slate-600">
              Sign in with your authorized{' '}
              <span className="rounded bg-dac-navy-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-dac-navy-800">
                @{domain}
              </span>{' '}
              account mapped in the Role Master.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xl shadow-slate-900/5">
            {oauthError ? (
              <div
                role="alert"
                className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-xs font-medium text-red-800"
              >
                <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-red-600" />
                <span>{oauthError}</span>
              </div>
            ) : null}

            {/* Primary Google Workspace OAuth Sign-In */}
            <a
              href={googleHref}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-xs transition hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-50 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-dac-navy-500"
            >
              <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              <span>Continue with Google (@{domain})</span>
            </a>

            {!googleConfigured ? (
              <p className="mt-2.5 rounded-lg bg-amber-50 px-3 py-1.5 text-center text-[11px] text-amber-800 border border-amber-200/70">
                Set <code className="font-mono font-semibold">GOOGLE_CLIENT_ID</code> &amp;{' '}
                <code className="font-mono font-semibold">GOOGLE_CLIENT_SECRET</code> in{' '}
                <code className="font-mono">.env</code> to enable Google OAuth.
              </p>
            ) : null}

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-[11px] font-semibold tracking-wider uppercase">
                <span className="bg-white px-3 text-slate-400">Or sign in with credentials</span>
              </div>
            </div>

            <LoginForm next={next} domain={domain} />
          </div>

          <div className="mt-6 flex items-center justify-between px-1 text-xs text-slate-500">
            <span>DAC Developers Pvt Ltd</span>
            <Link
              href="/forgot-password"
              className="font-semibold text-dac-navy-700 underline-offset-4 hover:text-dac-orange-600 hover:underline"
            >
              Forgot your password?
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
