'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * The error boundary for the whole app.
 *
 * Deliberately says nothing about what went wrong. An error message from a
 * booking system can carry a Booking ID, an applicant's name, a database
 * constraint — and this page is reachable by anyone with a session, including
 * the wrong one. The `digest` is the server's own hash of the error, which is
 * what ties a report to the server log without putting anything in the browser.
 *
 * Giving people a way out matters more than diagnosis here: a dead end on a
 * half-finished booking is what makes someone start again and create a
 * duplicate.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server errors are already logged server-side with their full detail;
    // this catches the client-side ones. Deliberately not sent anywhere: the
    // brief forbids personal data reaching a third-party error tracker, and an
    // error object from this app can carry it.
    console.error('[app] unhandled error', { digest: error.digest });
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-12 text-center">
      <h1 className="text-xl font-semibold tracking-tight text-gray-900">
        Something went wrong
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        The page could not be shown. Nothing you had saved is lost — booking forms save as
        you type, and a signature is only recorded once it is confirmed.
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-dac-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-dac-navy-900"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Back to the dashboard
        </Link>
      </div>

      {error.digest ? (
        <p className="mt-6 font-mono text-xs text-gray-400">
          Reference {error.digest}
        </p>
      ) : null}
    </div>
  );
}
