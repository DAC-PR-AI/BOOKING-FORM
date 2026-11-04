import { describe, expect, it } from 'vitest';
import {
  firstApplicableOrder,
  isApplicable,
  isCompleted,
  nextApplicableOrder,
  planFlow,
  planResume,
  resumeWrites,
  type ExistingRecord,
  type FlowContext,
  type FlowStepConfig,
} from './plan';

const CREATOR = 'creator-1';

/** The nine seeded steps, reduced to what planning reads. */
const NINE_STEPS: FlowStepConfig[] = [
  { id: 's1', orderIndex: 1, label: '1st Applicant', roleId: 'r-exec', action: 'SIGN', skipIfNoSecondApplicant: false, actsOnCreatorDevice: true, pdfSignatureSlot: 'applicant_1' },
  { id: 's2', orderIndex: 2, label: '2nd Applicant', roleId: 'r-exec', action: 'SIGN', skipIfNoSecondApplicant: true, actsOnCreatorDevice: true, pdfSignatureSlot: 'applicant_2' },
  { id: 's3', orderIndex: 3, label: 'AGM', roleId: 'r-agm', action: 'SIGN', skipIfNoSecondApplicant: false, actsOnCreatorDevice: false, pdfSignatureSlot: 'agm' },
  { id: 's4', orderIndex: 4, label: 'DGM / GM', roleId: 'r-gm', action: 'SIGN', skipIfNoSecondApplicant: false, actsOnCreatorDevice: false, pdfSignatureSlot: 'dgm_gm' },
  { id: 's5', orderIndex: 5, label: 'VP Sales', roleId: 'r-vp', action: 'SIGN', skipIfNoSecondApplicant: false, actsOnCreatorDevice: false, pdfSignatureSlot: 'vp_sales' },
  { id: 's6', orderIndex: 6, label: 'Sales Co-ordinator', roleId: 'r-coord', action: 'VALIDATE_AND_SIGN', skipIfNoSecondApplicant: false, actsOnCreatorDevice: false, pdfSignatureSlot: 'sales_coordinator' },
  { id: 's7', orderIndex: 7, label: 'MIS', roleId: 'r-mis', action: 'SIGN', skipIfNoSecondApplicant: false, actsOnCreatorDevice: false, pdfSignatureSlot: 'mis' },
  { id: 's8', orderIndex: 8, label: 'Director', roleId: 'r-dir', action: 'SIGN', skipIfNoSecondApplicant: false, actsOnCreatorDevice: false, pdfSignatureSlot: 'director' },
  { id: 's9', orderIndex: 9, label: 'CRM', roleId: 'r-crm', action: 'SIGN', skipIfNoSecondApplicant: false, actsOnCreatorDevice: false, pdfSignatureSlot: 'crm' },
];

const SOLE: FlowContext = { hasSecondApplicant: false, creatorId: CREATOR };
const JOINT: FlowContext = { hasSecondApplicant: true, creatorId: CREATOR };

function statuses(context: FlowContext): Record<number, string> {
  return Object.fromEntries(
    planFlow(NINE_STEPS, context).map((entry) => [entry.step.orderIndex, entry.status]),
  );
}

describe('isApplicable', () => {
  it('skips the second-applicant step for a sole applicant', () => {
    expect(isApplicable(NINE_STEPS[1] as FlowStepConfig, SOLE)).toBe(false);
    expect(isApplicable(NINE_STEPS[1] as FlowStepConfig, JOINT)).toBe(true);
  });

  it('leaves every other step applicable either way', () => {
    for (const step of NINE_STEPS.filter((s) => !s.skipIfNoSecondApplicant)) {
      expect(isApplicable(step, SOLE)).toBe(true);
      expect(isApplicable(step, JOINT)).toBe(true);
    }
  });
});

describe('planFlow', () => {
  it('opens exactly one step', () => {
    const pending = planFlow(NINE_STEPS, JOINT).filter((e) => e.status === 'PENDING');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.step.orderIndex).toBe(1);
  });

  it('locks everything after the open step, so the order cannot be jumped', () => {
    const plan = statuses(JOINT);
    expect(plan[1]).toBe('PENDING');
    for (const order of [2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(plan[order]).toBe('LOCKED');
    }
  });

  it('marks the second-applicant step SKIPPED for a sole applicant', () => {
    expect(statuses(SOLE)[2]).toBe('SKIPPED');
  });

  it('still opens step 1 for a sole applicant', () => {
    expect(statuses(SOLE)[1]).toBe('PENDING');
  });

  it('assigns the in-person applicant steps to the creator', () => {
    const plan = planFlow(NINE_STEPS, JOINT);
    expect(plan.find((e) => e.step.orderIndex === 1)?.assigneeId).toBe(CREATOR);
    expect(plan.find((e) => e.step.orderIndex === 2)?.assigneeId).toBe(CREATOR);
  });

  it('leaves staff steps unassigned, so any holder of the role can act', () => {
    const plan = planFlow(NINE_STEPS, JOINT);
    for (const order of [3, 4, 5, 6, 7, 8, 9]) {
      expect(plan.find((e) => e.step.orderIndex === order)?.assigneeId).toBeNull();
    }
  });

  it('never assigns a skipped step to anyone', () => {
    const skipped = planFlow(NINE_STEPS, SOLE).find((e) => e.status === 'SKIPPED');
    expect(skipped?.assigneeId).toBeNull();
  });

  it('sorts out-of-order configuration rather than trusting the caller', () => {
    const shuffled = [NINE_STEPS[4], NINE_STEPS[0], NINE_STEPS[8], NINE_STEPS[2]] as FlowStepConfig[];
    const plan = planFlow(shuffled, SOLE);
    expect(plan.map((e) => e.step.orderIndex)).toEqual([1, 3, 5, 9]);
    expect(plan[0]?.status).toBe('PENDING');
  });

  it('does not mutate the configuration it was given', () => {
    const input = [...NINE_STEPS];
    planFlow(input, SOLE);
    expect(input.map((s) => s.orderIndex)).toEqual(NINE_STEPS.map((s) => s.orderIndex));
  });
});

describe('firstApplicableOrder / nextApplicableOrder', () => {
  it('starts at step 1', () => {
    expect(firstApplicableOrder(NINE_STEPS, SOLE)).toBe(1);
  });

  it('steps over a skipped step instead of stopping at it', () => {
    expect(nextApplicableOrder(NINE_STEPS, SOLE, 1)).toBe(3);
    expect(nextApplicableOrder(NINE_STEPS, JOINT, 1)).toBe(2);
  });

  it('returns null after the last step, which is what completes a booking', () => {
    expect(nextApplicableOrder(NINE_STEPS, SOLE, 9)).toBeNull();
  });

  it('returns null when no step applies at all', () => {
    expect(firstApplicableOrder([NINE_STEPS[1] as FlowStepConfig], SOLE)).toBeNull();
  });
});

describe('isCompleted', () => {
  it('counts SIGNED and VALIDATED as done, and nothing else', () => {
    expect(isCompleted('SIGNED')).toBe(true);
    expect(isCompleted('VALIDATED')).toBe(true);
    expect(isCompleted('PENDING')).toBe(false);
    expect(isCompleted('LOCKED')).toBe(false);
    expect(isCompleted('SKIPPED')).toBe(false);
    expect(isCompleted('RETURNED')).toBe(false);
    expect(isCompleted('REASSIGNED')).toBe(false);
  });
});

/** A sole-applicant form returned from step 6 with 1,3,4,5 signed. */
function returnedFromSix(): ExistingRecord[] {
  return [
    { orderIndex: 1, status: 'SIGNED' },
    { orderIndex: 2, status: 'SKIPPED' },
    { orderIndex: 3, status: 'SIGNED' },
    { orderIndex: 4, status: 'SIGNED' },
    { orderIndex: 5, status: 'SIGNED' },
    { orderIndex: 6, status: 'RETURNED' },
    { orderIndex: 7, status: 'LOCKED' },
    { orderIndex: 8, status: 'LOCKED' },
    { orderIndex: 9, status: 'LOCKED' },
  ];
}

describe('planResume', () => {
  it('resumes at the step that returned it, not at step 1', () => {
    const plan = planResume(NINE_STEPS, SOLE, returnedFromSix(), 6);
    expect(plan.resumeAtOrder).toBe(6);
    expect(plan.rewoundForNewApplicant).toBe(false);
  });

  it('opens that step and locks the ones after it', () => {
    const plan = planResume(NINE_STEPS, SOLE, returnedFromSix(), 6);
    const byOrder = Object.fromEntries(plan.statuses.map((s) => [s.orderIndex, s.status]));
    expect(byOrder[6]).toBe('PENDING');
    expect(byOrder[7]).toBe('LOCKED');
    expect(byOrder[9]).toBe('LOCKED');
  });

  it('falls back to the first step when nothing recorded where to resume', () => {
    const plan = planResume(NINE_STEPS, SOLE, returnedFromSix(), null);
    expect(plan.resumeAtOrder).toBe(1);
  });

  it('rewinds to the second-applicant step when one was added while returned', () => {
    const plan = planResume(NINE_STEPS, JOINT, returnedFromSix(), 6);
    expect(plan.resumeAtOrder).toBe(2);
    expect(plan.rewoundForNewApplicant).toBe(true);

    const byOrder = Object.fromEntries(plan.statuses.map((s) => [s.orderIndex, s.status]));
    expect(byOrder[2]).toBe('PENDING');
    expect(byOrder[6]).toBe('LOCKED');
  });

  it('does not rewind when the new step is already ahead of the return point', () => {
    const existing: ExistingRecord[] = [
      { orderIndex: 1, status: 'RETURNED' },
      { orderIndex: 2, status: 'SKIPPED' },
      ...[3, 4, 5, 6, 7, 8, 9].map((orderIndex) => ({ orderIndex, status: 'LOCKED' as const })),
    ];
    const plan = planResume(NINE_STEPS, JOINT, existing, 1);
    expect(plan.resumeAtOrder).toBe(1);
    expect(plan.rewoundForNewApplicant).toBe(false);
  });

  it('moves on when the step it was returned to no longer applies', () => {
    const existing: ExistingRecord[] = [
      { orderIndex: 1, status: 'SIGNED' },
      { orderIndex: 2, status: 'RETURNED' },
      ...[3, 4, 5, 6, 7, 8, 9].map((orderIndex) => ({ orderIndex, status: 'LOCKED' as const })),
    ];
    const plan = planResume(NINE_STEPS, SOLE, existing, 2);
    expect(plan.resumeAtOrder).toBe(3);
  });

  it('marks the second-applicant step SKIPPED once the applicant is removed', () => {
    const existing: ExistingRecord[] = [
      { orderIndex: 1, status: 'SIGNED' },
      { orderIndex: 2, status: 'SIGNED' },
      ...[3, 4, 5, 6, 7, 8, 9].map((orderIndex) => ({ orderIndex, status: 'LOCKED' as const })),
    ];
    const plan = planResume(NINE_STEPS, SOLE, existing, 3);
    const byOrder = Object.fromEntries(plan.statuses.map((s) => [s.orderIndex, s.status]));
    expect(byOrder[2]).toBe('SKIPPED');
  });
});

describe('resumeWrites', () => {
  it('leaves completed steps behind the resume point untouched', () => {
    const existing = returnedFromSix();
    const plan = planResume(NINE_STEPS, SOLE, existing, 6);
    const writes = resumeWrites(plan, existing);
    const touched = writes.map((w) => w.orderIndex);

    expect(touched).not.toContain(1);
    expect(touched).not.toContain(3);
    expect(touched).not.toContain(4);
    expect(touched).not.toContain(5);
  });

  it('writes only the steps whose status actually changes', () => {
    const existing = returnedFromSix();
    const plan = planResume(NINE_STEPS, SOLE, existing, 6);
    const writes = resumeWrites(plan, existing);

    expect(writes.map((w) => w.orderIndex)).toEqual([6]);
    expect(writes[0]?.status).toBe('PENDING');
  });

  it('never erases a signature when a rewind reopens an earlier step', () => {
    const existing = returnedFromSix();
    const plan = planResume(NINE_STEPS, JOINT, existing, 6);
    const writes = resumeWrites(plan, existing);
    const byOrder = Object.fromEntries(writes.map((w) => [w.orderIndex, w.status]));

    expect(byOrder[1]).toBeUndefined();
    expect(byOrder[2]).toBe('PENDING');
    expect(byOrder[3]).toBe('LOCKED');
    expect(byOrder[5]).toBe('LOCKED');
  });

  it('writes every step for a flow whose records do not exist yet', () => {
    const plan = planResume(NINE_STEPS, SOLE, [], 1);
    expect(resumeWrites(plan, [])).toHaveLength(NINE_STEPS.length);
  });
});
