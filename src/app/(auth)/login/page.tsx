import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Brand bar echoing the paper form's navy/orange corner accent. */}
        <div className="mb-6 flex items-center gap-2">
          <span className="h-1.5 w-10 rounded-full bg-dac-navy-700" aria-hidden="true" />
          <span className="h-1.5 w-5 rounded-full bg-dac-orange-500" aria-hidden="true" />
        </div>

        <h1 className="text-xl font-semibold tracking-tight text-gray-900">
          DAC Booking Portal
        </h1>
        <p className="mt-1 mb-6 text-sm text-gray-600">
          Sign in to continue. Accounts are created by an administrator.
        </p>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <LoginForm next={next} />
        </div>

        <p className="mt-4 text-center text-sm text-gray-600">
          <Link
            href="/forgot-password"
            className="font-medium text-dac-navy-700 underline-offset-2 hover:underline"
          >
            Forgot your password?
          </Link>
        </p>
      </div>
    </main>
  );
}
