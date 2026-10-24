'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { groupIssues, type GateIssue } from '@/lib/forms/gate-issues';
import { submitBookingForm } from './actions';

/**
 * The accept-and-submit panel.
 *
 * Two deliberate frictions, both because submitting is irreversible:
 *
 *   * The T&C box must be ticked. It is unticked on every load — a remembered
 *     tick would mean nobody read anything.
 *   * The button says what will happen ("Submit and start the signature
 *     flow"), not "Submit". The consequence belongs on the control.
 *
 * The server re-runs the whole gate on submit, so anything that changed since
 * the page rendered comes back here as a fresh issue list rather than being
 * accepted on the strength of a stale render.
 */
export function ReviewPanel({
  formId,
  ready,
  isResubmission,
  termsVersion,
}: {
  formId: string;
  ready: boolean;
  isResubmission: boolean;
  termsVersion: string | null;
}) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleIssues, setStaleIssues] = useState<GateIssue[]>([]);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(): void {
    setError(null);
    setStaleIssues([]);

    startTransition(async () => {
      const result = await submitBookingForm(formId, { tncAccepted: accepted });

      if (!result.ok) {
        setError(result.error);
        setStaleIssues(result.issues ?? []);
        // Something changed underneath this page; show the truth.
        if (result.issues && result.issues.length > 0) router.refresh();
        return;
      }

      router.push(`/forms/${formId}`);
    });
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <label className="flex cursor-pointer items-start gap-3 text-sm text-gray-900">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          disabled={!ready || isPending}
          className="mt-0.5 h-4 w-4 shrink-0 border-gray-500 text-dac-navy-700 focus:ring-dac-navy-500 disabled:opacity-50"
        />
        <span>
          I confirm the applicant{'’'}s details above are correct, and that the Terms
          &amp; Conditions
          {termsVersion ? ` (version ${termsVersion})` : null} have been read and accepted by the
          applicant.
        </span>
      </label>

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      {staleIssues.length > 0 ? (
        <div className="mt-2 space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-xs text-red-800">
            This changed while the page was open:
          </p>
          {groupIssues(staleIssues).map((group) => (
            <div key={group.section}>
              <h3 className="text-xs font-semibold text-red-900">{group.title}</h3>
              <ul className="text-xs text-red-900">
                {group.issues.map((issue, index) => (
                  <li key={`${issue.field}-${index}`}>
                    {issue.field ? `${issue.field} — ` : null}
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!ready || !accepted || isPending}
          className="rounded-md bg-dac-navy-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-dac-navy-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending
            ? 'Submitting…'
            : isResubmission
              ? 'Resubmit and resume the signature flow'
              : 'Submit and start the signature flow'}
        </button>

        <p className="text-xs text-gray-500">
          {ready
            ? isResubmission
              ? 'The Booking ID stays the same, and the flow resumes where it was returned from.'
              : 'A Booking ID is allocated now, and the form can no longer be edited.'
            : 'Finish the outstanding items above first.'}
        </p>
      </div>
    </section>
  );
}
