import 'server-only';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/auth/session';
import { audit } from '@/lib/audit/log';
import { assessForm, loadFormForGate } from './readiness';
import { activeTermsVersion } from './terms';
import { resumeFlow, startFlow } from '@/lib/flow/engine';
import { notifyStepOpened } from '@/lib/notify/dispatch';
import { allocateBookingId as allocate } from './allocate';
import type { GateIssue } from './gate-issues';

/**
 * Submitting a booking form.
 *
 * This is the irreversible step: a Booking ID is allocated, the fields lock,
 * and the signature pipeline opens. Everything it depends on is therefore
 * re-checked here against the database, never taken from the request — the
 * creator may be submitting from a tab that has been open since yesterday.
 *
 * All of it happens in one transaction. A form with a Booking ID but no flow
 * instance, or a flow instance but a DRAFT status, is a booking no screen
 * knows how to show and no one can rescue without SQL.
 *
 * The acting user is a parameter rather than being read from the session here,
 * so this — the part with the transaction, the race guard and the two
 * submission paths — can be exercised end to end by
 * `scripts/verify-submit.ts`. The Server Action in
 * `app/(app)/forms/[id]/review/actions.ts` is the thin shim that supplies it.
 */

/** Statuses from which a form may be submitted. */
const SUBMITTABLE = ['DRAFT', 'RETURNED'] as const;

export type SubmitResult =
  | {
      ok: true;
      bookingId: string;
      /** Where the flow now waits. Null only if the pipeline has no steps. */
      currentStepOrder: number | null;
      /** A newly added second applicant pulled the flow back behind the return point. */
      rewoundForNewApplicant: boolean;
    }
  | { ok: false; error: string; issues?: GateIssue[] };

export async function performSubmit(
  user: SessionUser,
  formId: string,
  input: { tncAccepted: boolean },
): Promise<SubmitResult> {
  const form = await loadFormForGate(formId, user.organizationId);
  if (!form) return { ok: false, error: 'Form not found.' };

  // An admin may rescue a form; otherwise only its creator may submit it.
  if (user.role.name !== 'ADMIN' && form.createdById !== user.id) {
    return { ok: false, error: 'Form not found.' };
  }

  if (!(SUBMITTABLE as readonly string[]).includes(form.status)) {
    return {
      ok: false,
      error:
        form.status === 'CANCELLED'
          ? 'This booking has been cancelled.'
          : 'This booking has already been submitted.',
    };
  }

  const { readiness } = await assessForm(form, user.organizationId);
  if (!readiness.ready) {
    return {
      ok: false,
      error: 'This form is not complete yet.',
      issues: readiness.issues,
    };
  }

  if (!input.tncAccepted) {
    return { ok: false, error: 'The Terms & Conditions must be accepted to submit.' };
  }

  const terms = await activeTermsVersion(user.organizationId);
  if (!terms) {
    return {
      ok: false,
      error:
        'No approved Terms & Conditions version is available, so this booking cannot be ' +
        'submitted. An administrator must approve a version first.',
    };
  }

  const hasSecondApplicant = form.applicants.some((a) => a.applicantType === 'SECONDARY');
  const isResubmission = form.status === 'RETURNED';

  const result = await prisma.$transaction(async (tx) => {
    // Re-read the status inside the transaction. Two submits racing from two
    // tabs would otherwise both pass the check above and both allocate an ID.
    const locked = await tx.bookingForm.findUniqueOrThrow({
      where: { id: form.id },
      select: { status: true, bookingId: true, returnToStepOrder: true },
    });
    if (!(SUBMITTABLE as readonly string[]).includes(locked.status)) {
      return { raced: true as const };
    }

    // A resubmission keeps the Booking ID it was given the first time: the
    // number is already on paperwork and in people's inboxes.
    const bookingId =
      locked.bookingId ?? (await allocate(tx, user.organizationId));

    const flow = isResubmission
      ? await resumeFlow(
          tx,
          {
            id: form.id,
            formTemplateId: form.formTemplateId,
            createdById: form.createdById,
            returnToStepOrder: locked.returnToStepOrder,
          },
          { hasSecondApplicant },
        )
      : {
          resumeAtOrder: await startFlow(
            tx,
            {
              id: form.id,
              formTemplateId: form.formTemplateId,
              createdById: form.createdById,
            },
            { hasSecondApplicant },
          ),
          rewoundForNewApplicant: false,
        };

    await tx.bookingForm.update({
      where: { id: form.id },
      data: {
        bookingId,
        // SUBMITTED means "in the pipeline, nothing signed yet". It becomes
        // IN_REVIEW on the first signature, in Phase 5.
        status: 'SUBMITTED',
        currentStepOrder: flow.resumeAtOrder,
        returnToStepOrder: null,
        tncVersionId: terms.id,
        tncAcceptedAt: new Date(),
        submittedAt: form.submittedAt ?? new Date(),
      },
    });

    return {
      raced: false as const,
      bookingId,
      currentStepOrder: flow.resumeAtOrder,
      rewoundForNewApplicant: flow.rewoundForNewApplicant,
    };
  });

  if (result.raced) {
    return { ok: false, error: 'This booking has already been submitted.' };
  }

  await audit({
    organizationId: user.organizationId,
    userId: user.id,
    bookingFormId: form.id,
    action: 'SUBMIT',
    detail: isResubmission
      ? `Resubmitted ${result.bookingId} after a return; flow resumes at step ${result.currentStepOrder ?? '—'}.`
      : `Submitted ${result.bookingId}; T&C ${terms.version} accepted (${terms.bodySha256.slice(0, 12)}…).`,
  });

  // Best-effort, after the commit — see the note in `sign.ts`.
  if (result.currentStepOrder !== null) {
    await notifyStepOpened(form.id, result.currentStepOrder);
  }

  // Cache revalidation is a Next concern and belongs to the Server Action, not
  // here: this function has already committed, and a failed revalidate must
  // not look like a failed submit.
  return {
    ok: true,
    bookingId: result.bookingId,
    currentStepOrder: result.currentStepOrder,
    rewoundForNewApplicant: result.rewoundForNewApplicant,
  };
}
