import { describe, expect, it } from 'vitest';
import {
  canActOnStep,
  completedStatusFor,
  isWaitingOn,
  planAdvance,
  planReturn,
  validateReturnComment,
  type Actor,
  type FormStatus,
  type StepForAction,
} from './act';
import type { FlowContext, FlowStepConfig } from './plan';

const CREATOR = 'user-creator';
const AGM_USER = 'user-agm';
const ROLE_AGM = 'role-agm';
const ROLE_EXEC = 'role-exec';

function actor(overrides: Partial<Actor> = {}): Actor {
  return { userId: AGM_USER, roleId: ROLE_AGM, isCreator: false, ...overrides };
}

function step(overrides: Partial<StepForAction> = {}): StepForAction {
  return {
    orderIndex: 3,
    status: 'PENDING',
    assigneeId: null,
    roleId: ROLE_AGM,
    action: 'SIGN',
    actsOnCreatorDevice: false,
    ...overrides,
  };
}

const STEPS: FlowStepConfig[] = [
  { id: 's1', orderIndex: 1, label: '1st Applicant', roleId: ROLE_EXEC, action: 'SIGN', skipIfNoSecondApplicant: false, actsOnCreatorDevice: true, pdfSignatureSlot: 'applicant_1' },
  { id: 's2', orderIndex: 2, label: '2nd Applicant', roleId: ROLE_EXEC, action: 'SIGN', skipIfNoSecondApplicant: true, actsOnCreatorDevice: true, pdfSignatureSlot: 'applicant_2' },
  { id: 's3', orderIndex: 3, label: 'AGM', roleId: ROLE_AGM, action: 'SIGN', skipIfNoSecondApplicant: false, actsOnCreatorDevice: false, pdfSignatureSlot: 'agm' },
  { id: 's6', orderIndex: 6, label: 'Co-ordinator', roleId: 'role-coord', action: 'VALIDATE_AND_SIGN', skipIfNoSecondApplicant: false, actsOnCreatorDevice: false, pdfSignatureSlot: 'sales_coordinator' },
  { id: 's9', orderIndex: 9, label: 'CRM', roleId: 'role-crm', action: 'SIGN', skipIfNoSecondApplicant: false, actsOnCreatorDevice: false, pdfSignatureSlot: 'crm' },
];

const SOLE: FlowContext = { hasSecondApplicant: false, creatorId: CREATOR };
const JOINT: FlowContext = { hasSecondApplicant: true, creatorId: CREATOR };

describe('canActOnStep — the form must be in the flow', () => {
  it.each<FormStatus>(['SUBMITTED', 'IN_REVIEW'])('allows it while %s', (status) => {
    expect(canActOnStep(actor(), step(), status).allowed).toBe(true);
  });

  it.each<FormStatus>(['DRAFT', 'RETURNED', 'COMPLETED', 'CANCELLED'])(
    'refuses it while %s',
    (status) => {
      expect(canActOnStep(actor(), step(), status)).toEqual({
        allowed: false,
        reason: 'form-not-in-flow',
      });
    },
  );
});

describe('canActOnStep — only the open step', () => {
  it('allows a PENDING step', () => {
    expect(canActOnStep(actor(), step({ status: 'PENDING' }), 'IN_REVIEW').allowed).toBe(true);
  });

  it.each(['LOCKED', 'SIGNED', 'VALIDATED', 'RETURNED', 'SKIPPED', 'REASSIGNED'] as const)(
    'refuses a %s step, so the order cannot be jumped',
    (status) => {
      expect(canActOnStep(actor(), step({ status }), 'IN_REVIEW')).toEqual({
        allowed: false,
        reason: 'step-not-open',
      });
    },
  );
});

describe('canActOnStep — staff steps are claimed by role', () => {
  it('allows any holder of the step’s role', () => {
    expect(canActOnStep(actor({ userId: 'someone-else' }), step(), 'IN_REVIEW').allowed).toBe(
      true,
    );
  });

  it('refuses the wrong role', () => {
    expect(canActOnStep(actor({ roleId: 'role-mis' }), step(), 'IN_REVIEW')).toEqual({
      allowed: false,
      reason: 'not-your-step',
    });
  });

  it('lets the person who already claimed it finish', () => {
    const claimed = step({ assigneeId: AGM_USER });
    expect(canActOnStep(actor({ userId: AGM_USER }), claimed, 'IN_REVIEW').allowed).toBe(true);
  });

  it('refuses a colleague once it is claimed', () => {
    const claimed = step({ assigneeId: 'another-agm' });
    expect(canActOnStep(actor({ userId: AGM_USER }), claimed, 'IN_REVIEW')).toEqual({
      allowed: false,
      reason: 'not-your-step',
    });
  });
});

describe('canActOnStep — applicant steps', () => {
  const applicantStep = step({ orderIndex: 1, roleId: ROLE_EXEC, actsOnCreatorDevice: true });

  it('allows the form’s creator, who supervises in person', () => {
    expect(
      canActOnStep(
        actor({ userId: CREATOR, roleId: ROLE_EXEC, isCreator: true }),
        applicantStep,
        'SUBMITTED',
      ).allowed,
    ).toBe(true);
  });

  it('refuses another sales executive with the same role', () => {
    expect(
      canActOnStep(
        actor({ userId: 'other-exec', roleId: ROLE_EXEC, isCreator: false }),
        applicantStep,
        'SUBMITTED',
      ),
    ).toEqual({ allowed: false, reason: 'not-the-creator' });
  });

  it('refuses a signatory outright', () => {
    expect(canActOnStep(actor(), applicantStep, 'SUBMITTED').allowed).toBe(false);
  });
});

describe('canActOnStep — there is no admin override', () => {
  it('refuses an admin on a step that is not theirs', () => {
    // Signing is a personal act: an admin signing as someone else would put a
    // name on a legal document that never agreed to it.
    const admin = actor({ userId: 'user-admin', roleId: 'role-admin' });
    expect(canActOnStep(admin, step(), 'IN_REVIEW')).toEqual({
      allowed: false,
      reason: 'not-your-step',
    });
  });

  it('refuses an admin on an applicant step they did not create', () => {
    const admin = actor({ userId: 'user-admin', roleId: 'role-admin', isCreator: false });
    const applicantStep = step({ actsOnCreatorDevice: true });
    expect(canActOnStep(admin, applicantStep, 'IN_REVIEW').allowed).toBe(false);
  });
});

describe('completedStatusFor', () => {
  it('records a plain signature as SIGNED', () => {
    expect(completedStatusFor('SIGN')).toBe('SIGNED');
  });

  it('records the Co-ordinator’s step as VALIDATED, keeping the distinction', () => {
    expect(completedStatusFor('VALIDATE_AND_SIGN')).toBe('VALIDATED');
  });
});

describe('planAdvance', () => {
  it('opens the next step and puts the form in review', () => {
    expect(planAdvance(STEPS, JOINT, 1)).toEqual({
      nextOrder: 2,
      formStatus: 'IN_REVIEW',
      completed: false,
    });
  });

  it('steps over a skipped second applicant', () => {
    expect(planAdvance(STEPS, SOLE, 1).nextOrder).toBe(3);
  });

  it('completes the booking after the last applicable step', () => {
    expect(planAdvance(STEPS, SOLE, 9)).toEqual({
      nextOrder: null,
      formStatus: 'COMPLETED',
      completed: true,
    });
  });

  it('asks the configuration rather than assuming the CRM is last', () => {
    const shortened = STEPS.filter((s) => s.orderIndex <= 3);
    expect(planAdvance(shortened, SOLE, 3).completed).toBe(true);
  });
});

describe('planReturn', () => {
  it('records where the form must resume', () => {
    expect(planReturn(6)).toEqual({ returnToOrder: 6, formStatus: 'RETURNED' });
  });
});

describe('validateReturnComment', () => {
  it('accepts a real explanation', () => {
    expect(validateReturnComment('  The bank name is wrong,   fix it. ')).toEqual({
      ok: true,
      comment: 'The bank name is wrong, fix it.',
    });
  });

  it('collapses whitespace so the creator reads one tidy note', () => {
    const result = validateReturnComment('Sale price\n\nis  wrong entirely');
    expect(result.ok && result.comment).toBe('Sale price is wrong entirely');
  });

  it('refuses an empty comment — a return with no reason is unactionable', () => {
    expect(validateReturnComment('   ').ok).toBe(false);
  });

  it('refuses a token comment', () => {
    expect(validateReturnComment('no').ok).toBe(false);
    expect(validateReturnComment('fix it').ok).toBe(false);
  });

  it('refuses an absurdly long one', () => {
    expect(validateReturnComment('x'.repeat(2001)).ok).toBe(false);
  });
});

describe('isWaitingOn', () => {
  it('agrees with canActOnStep, so queue and page cannot disagree', () => {
    const cases: Array<[Actor, StepForAction, FormStatus]> = [
      [actor(), step(), 'IN_REVIEW'],
      [actor({ roleId: 'role-mis' }), step(), 'IN_REVIEW'],
      [actor(), step({ status: 'LOCKED' }), 'IN_REVIEW'],
      [actor(), step(), 'COMPLETED'],
    ];

    for (const [a, s, status] of cases) {
      expect(isWaitingOn(a, s, status)).toBe(canActOnStep(a, s, status).allowed);
    }
  });
});
