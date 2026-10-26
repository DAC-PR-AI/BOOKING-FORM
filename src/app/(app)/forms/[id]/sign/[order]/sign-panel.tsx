'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SignaturePad, type SignaturePadHandle } from '@/components/signature/signature-pad';
import { MIN_RETURN_COMMENT } from '@/lib/flow/act';
import { returnCurrentStep, signCurrentStep } from './actions';

/**
 * Sign, or send it back.
 *
 * Both actions live on one screen because they are the same decision seen from
 * two sides, and splitting them would invite signing-by-default. Returning is
 * deliberately not styled as a destructive action either: it is a normal,
 * expected part of the process, and a reviewer who feels they are doing
 * something drastic signs instead.
 *
 * The comment on a return is mandatory and the server enforces it too — the
 * creator sees only that note, so a return without one is a form that comes
 * back with no idea what to fix.
 */
export function SignPanel({
  formId,
  orderIndex,
  stepLabel,
  isApplicantStep,
  requiresValidation,
  applicantName,
  isLastStep,
  nextLabel,
}: {
  formId: string;
  orderIndex: number;
  stepLabel: string;
  isApplicantStep: boolean;
  requiresValidation: boolean;
  /** For applicant steps, pre-fills the name from the form. */
  applicantName: string | null;
  isLastStep: boolean;
  nextLabel: string | null;
}) {
  const router = useRouter();
  const padRef = useRef<SignaturePadHandle | null>(null);

  const [hasStroke, setHasStroke] = useState(false);
  const [signerName, setSignerName] = useState(applicantName ?? '');
  const [validated, setValidated] = useState(false);
  const [confirmedIdentity, setConfirmedIdentity] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [showReturn, setShowReturn] = useState(false);
  const [comment, setComment] = useState('');

  const [isPending, startTransition] = useTransition();

  const canSign =
    hasStroke &&
    !isPending &&
    (!requiresValidation || validated) &&
    (!isApplicantStep || (signerName.trim().length >= 2 && confirmedIdentity));

  function handleSign(): void {
    setError(null);
    const dataUrl = padRef.current?.toDataUrl();
    if (!dataUrl) {
      setError('Please sign in the box above.');
      return;
    }

    startTransition(async () => {
      const result = await signCurrentStep({
        formId,
        orderIndex,
        signatureDataUrl: dataUrl,
        ...(isApplicantStep ? { signerName } : {}),
        ...(requiresValidation ? { validated } : {}),
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setDone(
        result.completed
          ? `Signed. This booking is now complete${result.bookingId ? ` — ${result.bookingId}` : ''}.`
          : `Signed. Now waiting on ${result.nextLabel ?? `step ${result.nextOrder}`}.`,
      );
      router.push(`/forms/${formId}`);
    });
  }

  function handleReturn(): void {
    setError(null);

    startTransition(async () => {
      const result = await returnCurrentStep({ formId, orderIndex, comment });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setDone(`Returned to ${result.returnedToCreator}.`);
      router.push(`/forms/${formId}`);
    });
  }

  if (done) {
    return (
      <p className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
        {done}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* --- the applicant's name, in place of a login -------------------- */}
      {isApplicantStep ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-900">Hand the device to the applicant</h3>
          <p className="mt-1 text-xs text-amber-900">
            The applicant signs here themselves. You are recorded as the witness, and your name
            is stored against this signature alongside theirs.
          </p>

          <label className="mt-3 block text-xs font-medium text-amber-900">
            Applicant’s name, as on the form
            <input
              type="text"
              value={signerName}
              onChange={(event) => setSignerName(event.target.value.toUpperCase())}
              disabled={isPending}
              className="mt-1 block w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-gray-900 uppercase focus:border-dac-navy-500 focus:ring-1 focus:ring-dac-navy-500 disabled:opacity-50"
              placeholder="RAVI KUMAR"
            />
          </label>
        </div>
      ) : null}

      {/* --- the pad ------------------------------------------------------ */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <label className="text-sm font-medium text-gray-900">
            {isApplicantStep ? 'Applicant’s signature' : `Signature — ${stepLabel}`}
          </label>
          <button
            type="button"
            onClick={() => {
              padRef.current?.clear();
              setError(null);
            }}
            disabled={!hasStroke || isPending}
            className="text-xs font-medium text-gray-600 underline underline-offset-2 disabled:opacity-40"
          >
            Clear
          </button>
        </div>

        <SignaturePad
          label={isApplicantStep ? 'Applicant signature box' : `Signature box for ${stepLabel}`}
          onChange={setHasStroke}
          disabled={isPending}
          padRef={padRef}
        />
        <p className="mt-1 text-xs text-gray-500">
          Sign with a finger, a stylus or the mouse.
        </p>
      </div>

      {/* --- the Co-ordinator's explicit assertion ------------------------ */}
      {requiresValidation ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-950">
          <input
            type="checkbox"
            checked={validated}
            onChange={(event) => setValidated(event.target.checked)}
            disabled={isPending}
            className="mt-0.5 h-4 w-4 shrink-0 border-indigo-400 text-dac-navy-700 focus:ring-dac-navy-500"
          />
          <span>
            <strong className="font-semibold">I have validated this form.</strong> The applicant
            details, property, payment figures and attached documents have been checked against
            the booking.
          </span>
        </label>
      ) : null}

      {isApplicantStep ? (
        <label className="flex cursor-pointer items-start gap-3 text-sm text-gray-900">
          <input
            type="checkbox"
            checked={confirmedIdentity}
            onChange={(event) => setConfirmedIdentity(event.target.checked)}
            disabled={isPending}
            className="mt-0.5 h-4 w-4 shrink-0 border-gray-500 text-dac-navy-700 focus:ring-dac-navy-500"
          />
          <span>
            I confirm the named applicant signed this themselves, in my presence.
          </span>
        </label>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4">
        <button
          type="button"
          onClick={handleSign}
          disabled={!canSign}
          className="rounded-md bg-dac-navy-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-dac-navy-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending
            ? 'Signing…'
            : isLastStep
              ? 'Sign and complete this booking'
              : 'Sign and send on'}
        </button>

        {!showReturn ? (
          <button
            type="button"
            onClick={() => setShowReturn(true)}
            disabled={isPending}
            className="rounded-md border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            Send back for changes
          </button>
        ) : null}

        <p className="text-xs text-gray-500">
          {isLastStep
            ? 'Signing here completes the booking.'
            : nextLabel
              ? `Next: ${nextLabel}.`
              : null}
        </p>
      </div>

      {/* --- returning --------------------------------------------------- */}
      {showReturn ? (
        <div className="rounded-lg border border-gray-300 bg-gray-50 p-4">
          <h3 className="text-sm font-semibold text-gray-900">Send back for changes</h3>
          <p className="mt-1 text-xs text-gray-600">
            This note is the only thing the creator sees, so say what needs changing. The
            signatures already collected are kept, and the booking returns to this step once it
            is resubmitted.
          </p>

          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={isPending}
            rows={3}
            className="mt-3 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-dac-navy-500 focus:ring-1 focus:ring-dac-navy-500 disabled:opacity-50"
            placeholder="The bank name on the payment details does not match the cheque."
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleReturn}
              disabled={isPending || comment.trim().length < MIN_RETURN_COMMENT}
              className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? 'Sending back…' : 'Send back'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowReturn(false);
                setComment('');
              }}
              disabled={isPending}
              className="text-sm font-medium text-gray-600 underline underline-offset-2 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
