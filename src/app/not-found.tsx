import Link from 'next/link';

/**
 * 404.
 *
 * This page is shown for genuinely missing pages **and** for everything the
 * RBAC layer refuses — `requireRole` and `authoriseFormAccess` call
 * `notFound()` rather than returning 403, so a signatory cannot learn that a
 * booking exists by probing for it (PLAN.md §9).
 *
 * The wording has to work for both. "You do not have permission" would undo
 * the whole point by confirming that something is there; "this does not exist"
 * would be a flat lie to someone who simply mistyped. So it says what is true
 * in both cases — it is not here *for you* — and offers the way back.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-lg text-center">
        <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase">
          404
        </p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-gray-900">
          That page isn’t available
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          It may have been moved, or it may not be yours to open. Booking forms are visible
          to the person who raised them and to whoever the flow is currently waiting on.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-md bg-dac-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-dac-navy-900"
          >
            Back to the dashboard
          </Link>
          <Link
            href="/forms"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            My forms
          </Link>
        </div>
      </div>
    </div>
  );
}
