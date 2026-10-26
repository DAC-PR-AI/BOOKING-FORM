import {
  isApplicable,
  nextApplicableOrder,
  type FlowContext,
  type FlowStepConfig,
  type StepAction,
  type StepStatus,
} from './plan';

/**
 * Who may act on a step, and what happens when they do.
 *
 * Pure and unit tested. These are the rules that decide whether a signature
 * counts, so they must be assertable without a database and without a browser.
 * `sign.ts` does the writing; it makes no decisions of its own.
 */

export type FormStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'RETURNED'
  | 'COMPLETED'
  | 'CANCELLED';

/** Statuses in which the pipeline is live and a step can be acted on. */
const IN_FLOW: ReadonlySet<FormStatus> = new Set<FormStatus>(['SUBMITTED', 'IN_REVIEW']);

export type Actor = {
  userId: string;
  roleId: string;
  /** The form's creator, who supervises the in-person applicant steps. */
  isCreator: boolean;
};

export type StepForAction = {
  orderIndex: number;
  status: StepStatus;
  assigneeId: string | null;
  roleId: string;
  action: StepAction;
  actsOnCreatorDevice: boolean;
};

export type DenialReason =
  | 'form-not-in-flow'
  | 'step-not-open'
  | 'not-your-step'
  | 'not-the-creator';

export type ActionCheck =
  | { allowed: true }
  | { allowed: false; reason: DenialReason };

export const DENIAL_MESSAGES: Record<DenialReason, string> = {
  'form-not-in-flow':
    'This booking is not currently in the signature flow, so it cannot be signed.',
  'step-not-open': 'This step is not open. The flow may have moved on, or been returned.',
  'not-your-step': 'This step is waiting on somebody else.',
  'not-the-creator':
    'Applicant signatures are captured in person by the booking’s creator, on their device.',
};

/**
 * Whether this actor may sign or return this step, right now.
 *
 * Deliberately has **no admin override**. An admin can rescue a form, view it
 * and reassign a step, but signing is a personal act: letting an admin sign as
 * somebody else would put a name on a legal document that never agreed to it,
 * and would make the audit trail a record of who clicked rather than who
 * approved.
 *
 * Two shapes of step:
 *
 *   * `actsOnCreatorDevice` (the applicant steps) — only the form's creator,
 *     who hands over the tablet and is recorded as witness. The applicant has
 *     no login, so there is nobody else it could be.
 *   * everything else — any active holder of the step's role. The step is
 *     claimed by whoever acts; pinning it to one named person in advance would
 *     stall every booking behind one absence.
 */
export function canActOnStep(
  actor: Actor,
  step: StepForAction,
  formStatus: FormStatus,
): ActionCheck {
  if (!IN_FLOW.has(formStatus)) {
    return { allowed: false, reason: 'form-not-in-flow' };
  }

  if (step.status !== 'PENDING') {
    return { allowed: false, reason: 'step-not-open' };
  }

  if (step.actsOnCreatorDevice) {
    return actor.isCreator
      ? { allowed: true }
      : { allowed: false, reason: 'not-the-creator' };
  }

  // Already claimed by someone: only they may finish it.
  if (step.assigneeId !== null && step.assigneeId !== actor.userId) {
    return { allowed: false, reason: 'not-your-step' };
  }

  if (step.roleId !== actor.roleId) {
    return { allowed: false, reason: 'not-your-step' };
  }

  return { allowed: true };
}

/**
 * What a completed step's status becomes.
 *
 * The Sales Co-ordinator's step is VALIDATE_AND_SIGN, and lands on VALIDATED
 * rather than SIGNED so the distinction survives in the record — it is the one
 * step that asserts the form was checked, not merely approved.
 */
export function completedStatusFor(action: StepAction): Extract<StepStatus, 'SIGNED' | 'VALIDATED'> {
  return action === 'VALIDATE_AND_SIGN' ? 'VALIDATED' : 'SIGNED';
}

export type AdvancePlan = {
  /** The step that opens next, or null when the booking is finished. */
  nextOrder: number | null;
  /** The form's status after this signature. */
  formStatus: Extract<FormStatus, 'IN_REVIEW' | 'COMPLETED'>;
  /** True when this signature completed the booking. */
  completed: boolean;
};

/**
 * Where the flow goes after `signedOrder` is completed.
 *
 * The form becomes IN_REVIEW on the first signature and COMPLETED when the
 * last applicable step is done — which is the CRM in the configured pipeline,
 * but this does not know that: it asks the configuration, so adding a tenth
 * step needs no change here.
 */
export function planAdvance(
  steps: FlowStepConfig[],
  context: FlowContext,
  signedOrder: number,
): AdvancePlan {
  const nextOrder = nextApplicableOrder(steps, context, signedOrder);

  return {
    nextOrder,
    formStatus: nextOrder === null ? 'COMPLETED' : 'IN_REVIEW',
    completed: nextOrder === null,
  };
}

export type ReturnPlan = {
  /** The step the form is returned from, and where it will resume. */
  returnToOrder: number;
  formStatus: Extract<FormStatus, 'RETURNED'>;
};

/**
 * Returning a form to its creator.
 *
 * The returning step's order is recorded so resubmission resumes there rather
 * than at step 1 — see `planResume`. Steps already signed are untouched; the
 * creator fixes the form and it comes back to whoever sent it back.
 */
export function planReturn(returningOrder: number): ReturnPlan {
  return { returnToOrder: returningOrder, formStatus: 'RETURNED' };
}

/** A return must say why. An empty comment makes the return unactionable. */
export const MIN_RETURN_COMMENT = 10;
export const MAX_RETURN_COMMENT = 2000;

export type CommentCheck = { ok: true; comment: string } | { ok: false; error: string };

export function validateReturnComment(raw: string): CommentCheck {
  const comment = raw.trim().replace(/\s+/g, ' ');

  if (comment.length === 0) {
    return { ok: false, error: 'Say what needs changing — the creator only sees this note.' };
  }
  if (comment.length < MIN_RETURN_COMMENT) {
    return {
      ok: false,
      error: `Please be a little more specific (at least ${MIN_RETURN_COMMENT} characters).`,
    };
  }
  if (comment.length > MAX_RETURN_COMMENT) {
    return {
      ok: false,
      error: `Please keep this under ${MAX_RETURN_COMMENT} characters.`,
    };
  }

  return { ok: true, comment };
}

/**
 * The steps a given user could act on across a set of forms — the queue query
 * expressed as a predicate, so the page and the tests agree on what "mine"
 * means.
 */
export function isWaitingOn(actor: Actor, step: StepForAction, formStatus: FormStatus): boolean {
  return canActOnStep(actor, step, formStatus).allowed;
}

/** Whether a step would be skipped for this booking — re-exported for callers. */
export { isApplicable };
