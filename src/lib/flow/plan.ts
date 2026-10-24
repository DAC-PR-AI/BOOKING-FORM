/**
 * The signature pipeline, as arithmetic.
 *
 * The order, the roles and the actions live in `flow_steps` rows, not here —
 * adding a step is a data change (README, "Changing the signature flow"). What
 * lives here is the part that cannot be expressed as a row: which step is
 * actionable *now*, which are skipped for this particular booking, and where a
 * returned form resumes.
 *
 * Pure and unit tested, because every one of those answers is a thing that
 * must not be wrong. A form that resumes at the wrong step either asks someone
 * to sign twice or ships without a signature it needed.
 */

export type StepAction = 'SIGN' | 'VALIDATE_AND_SIGN';

export type StepStatus =
  | 'LOCKED'
  | 'PENDING'
  | 'SIGNED'
  | 'VALIDATED'
  | 'RETURNED'
  | 'SKIPPED'
  | 'REASSIGNED';

/** A `flow_steps` row, reduced to what planning depends on. */
export type FlowStepConfig = {
  id: string;
  orderIndex: number;
  label: string;
  roleId: string;
  action: StepAction;
  skipIfNoSecondApplicant: boolean;
  actsOnCreatorDevice: boolean;
  pdfSignatureSlot: string;
};

export type FlowContext = {
  hasSecondApplicant: boolean;
  /** Applicant steps happen in person on this user's device. */
  creatorId: string;
};

export type PlannedStep = {
  step: FlowStepConfig;
  status: Extract<StepStatus, 'PENDING' | 'LOCKED' | 'SKIPPED'>;
  /**
   * Set only where the person is known in advance — the creator, for the
   * in-person applicant steps. Left null for staff steps so that any active
   * holder of the role can pick the form up; pinning it to one named person
   * would stall every booking behind one absence.
   */
  assigneeId: string | null;
};

/** Statuses that mean the step is finished and must not be reopened. */
const COMPLETED: ReadonlySet<StepStatus> = new Set<StepStatus>(['SIGNED', 'VALIDATED']);

export function isCompleted(status: StepStatus): boolean {
  return COMPLETED.has(status);
}

/** Whether this step applies to this booking at all. */
export function isApplicable(step: FlowStepConfig, context: FlowContext): boolean {
  return !(step.skipIfNoSecondApplicant && !context.hasSecondApplicant);
}

function assigneeFor(step: FlowStepConfig, context: FlowContext): string | null {
  return step.actsOnCreatorDevice ? context.creatorId : null;
}

function byOrder(a: { orderIndex: number }, b: { orderIndex: number }): number {
  return a.orderIndex - b.orderIndex;
}

/**
 * The plan for a form entering the flow for the first time.
 *
 * Exactly one step comes back PENDING: the lowest-numbered applicable one.
 * Everything after it is LOCKED, which is what makes the pipeline sequential
 * rather than a free-for-all — a Director cannot sign before the AGM, because
 * their step is not open yet.
 */
export function planFlow(steps: FlowStepConfig[], context: FlowContext): PlannedStep[] {
  const ordered = [...steps].sort(byOrder);
  let pendingAssigned = false;

  return ordered.map((step) => {
    if (!isApplicable(step, context)) {
      return { step, status: 'SKIPPED' as const, assigneeId: null };
    }
    if (!pendingAssigned) {
      pendingAssigned = true;
      return { step, status: 'PENDING' as const, assigneeId: assigneeFor(step, context) };
    }
    return { step, status: 'LOCKED' as const, assigneeId: assigneeFor(step, context) };
  });
}

/**
 * The next step to open after `fromOrder` has been completed, or null when the
 * form is finished. Skipped steps are stepped over, not stopped at.
 */
export function nextApplicableOrder(
  steps: FlowStepConfig[],
  context: FlowContext,
  fromOrder: number,
): number | null {
  const next = [...steps]
    .sort(byOrder)
    .find((step) => step.orderIndex > fromOrder && isApplicable(step, context));
  return next?.orderIndex ?? null;
}

/** The first step of a fresh flow — the one `planFlow` marks PENDING. */
export function firstApplicableOrder(
  steps: FlowStepConfig[],
  context: FlowContext,
): number | null {
  const first = [...steps].sort(byOrder).find((step) => isApplicable(step, context));
  return first?.orderIndex ?? null;
}

export type ExistingRecord = {
  orderIndex: number;
  status: StepStatus;
};

export type ResumePlan = {
  /** Where the flow reopens. Null means every applicable step is done. */
  resumeAtOrder: number | null;
  /** The status each step should now hold, keyed by order index. */
  statuses: Array<{ orderIndex: number; status: PlannedStep['status']; assigneeId: string | null }>;
  /**
   * True when a step that had been skipped is now applicable and sits *behind*
   * the step the form was returned from — so the flow has to rewind further
   * than the return point asked for. Surfaced so the UI can say why.
   */
  rewoundForNewApplicant: boolean;
};

/**
 * The plan for a returned form being resubmitted.
 *
 * It resumes at the step that returned it, not at step 1 — that is the whole
 * point of `return_to_step_order`, and re-collecting eight signatures because
 * the AGM wanted a typo fixed would make the feature unusable.
 *
 * One case rewinds further than that. If the creator *added a second
 * applicant* while the form was back with them, step 2 was SKIPPED and is now
 * applicable. Resuming at, say, step 5 would send the booking onward with an
 * unsigned second applicant — a defect on a legal document, discovered at the
 * end if at all. So a newly applicable step behind the return point pulls the
 * resume point back to itself, and `rewoundForNewApplicant` says so.
 */
export function planResume(
  steps: FlowStepConfig[],
  context: FlowContext,
  existing: ExistingRecord[],
  returnToOrder: number | null,
): ResumePlan {
  const ordered = [...steps].sort(byOrder);
  const statusByOrder = new Map(existing.map((r) => [r.orderIndex, r.status] as const));

  const fallback = firstApplicableOrder(steps, context);
  const requested = returnToOrder ?? fallback;

  // A step that was skipped, is applicable now, and was never acted on.
  const newlyApplicable = ordered
    .filter(
      (step) =>
        isApplicable(step, context) &&
        statusByOrder.get(step.orderIndex) === 'SKIPPED',
    )
    .map((step) => step.orderIndex);

  const earliestNew = newlyApplicable.length > 0 ? Math.min(...newlyApplicable) : null;

  let resumeAtOrder = requested;
  let rewoundForNewApplicant = false;
  if (earliestNew !== null && (requested === null || earliestNew < requested)) {
    resumeAtOrder = earliestNew;
    rewoundForNewApplicant = true;
  }

  // Make sure the resume point is itself applicable; if the second applicant
  // was *removed*, the step it was returned to may no longer exist for this
  // booking, and the flow should move on to the next real one.
  if (resumeAtOrder !== null) {
    const stepThere = ordered.find((s) => s.orderIndex === resumeAtOrder);
    if (!stepThere || !isApplicable(stepThere, context)) {
      resumeAtOrder = nextApplicableOrder(steps, context, resumeAtOrder);
    }
  }

  const statuses = ordered.map((step) => {
    const assigneeId = assigneeFor(step, context);

    if (!isApplicable(step, context)) {
      return { orderIndex: step.orderIndex, status: 'SKIPPED' as const, assigneeId: null };
    }

    if (resumeAtOrder === null) {
      // Nothing left to do; keep completed steps as they are by not touching
      // them (the caller only writes the statuses it is given).
      return { orderIndex: step.orderIndex, status: 'LOCKED' as const, assigneeId };
    }

    if (step.orderIndex < resumeAtOrder) {
      // Behind the resume point: leave whatever it holds. Expressed as LOCKED
      // here only for shape — `applyResume` skips steps already completed.
      return { orderIndex: step.orderIndex, status: 'LOCKED' as const, assigneeId };
    }

    if (step.orderIndex === resumeAtOrder) {
      return { orderIndex: step.orderIndex, status: 'PENDING' as const, assigneeId };
    }

    return { orderIndex: step.orderIndex, status: 'LOCKED' as const, assigneeId };
  });

  return { resumeAtOrder, statuses, rewoundForNewApplicant };
}

/**
 * Which steps a resume actually has to write, leaving finished work alone.
 *
 * Separated from `planResume` so the rule "a signature is never silently
 * erased" is one short, readable function rather than a condition buried in a
 * loop. Changing it is a decision; it should look like one.
 */
export function resumeWrites(
  plan: ResumePlan,
  existing: ExistingRecord[],
): Array<{ orderIndex: number; status: PlannedStep['status']; assigneeId: string | null }> {
  const statusByOrder = new Map(existing.map((r) => [r.orderIndex, r.status] as const));

  return plan.statuses.filter((entry) => {
    const current = statusByOrder.get(entry.orderIndex);
    if (current === undefined) return true;

    // Keep completed steps behind the resume point exactly as they are.
    if (isCompleted(current) && plan.resumeAtOrder !== null && entry.orderIndex < plan.resumeAtOrder) {
      return false;
    }

    return current !== entry.status;
  });
}
