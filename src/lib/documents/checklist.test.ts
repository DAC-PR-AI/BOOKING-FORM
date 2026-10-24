import { describe, expect, it } from 'vitest';
import {
  buildChecklist,
  checklistProgress,
  isAcceptedMimeType,
  labelFor,
  type ChecklistDocument,
  type ChecklistType,
} from './checklist';

const IMAGE = ['image/jpeg', 'image/png'];
const SCAN = ['image/jpeg', 'image/png', 'application/pdf'];

function type(overrides: Partial<ChecklistType> & Pick<ChecklistType, 'id' | 'key'>): ChecklistType {
  return {
    label: overrides.key,
    helpText: null,
    scope: 'FORM',
    appliesTo: null,
    acceptedMimeTypes: SCAN,
    maxBytes: 10 * 1024 * 1024,
    sortOrder: 0,
    requirement: null,
    ...overrides,
  };
}

function uploaded(
  documentTypeId: string,
  overrides: Partial<ChecklistDocument> = {},
): ChecklistDocument {
  return {
    id: `doc-${documentTypeId}`,
    documentTypeId,
    originalName: 'scan.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 123_456,
    uploadedAt: new Date('2026-10-20T10:00:00Z'),
    ...overrides,
  };
}

/** The seeded set, reduced to what the rules actually turn on. */
const TYPES: ChecklistType[] = [
  type({
    id: 'photo1',
    key: 'photo_applicant_1',
    label: 'Passport-size photo',
    scope: 'APPLICANT',
    appliesTo: 'PRIMARY',
    acceptedMimeTypes: IMAGE,
    sortOrder: 10,
    requirement: { isMandatory: true, requiredIfSecondApplicant: false },
  }),
  type({
    id: 'photo2',
    key: 'photo_applicant_2',
    label: 'Passport-size photo',
    scope: 'APPLICANT',
    appliesTo: 'SECONDARY',
    acceptedMimeTypes: IMAGE,
    sortOrder: 20,
    requirement: { isMandatory: false, requiredIfSecondApplicant: true },
  }),
  type({
    id: 'pan1',
    key: 'pan_applicant_1',
    label: 'PAN card',
    scope: 'APPLICANT',
    appliesTo: 'PRIMARY',
    sortOrder: 30,
    requirement: { isMandatory: true, requiredIfSecondApplicant: false },
  }),
  type({
    id: 'mail',
    key: 'mail',
    label: 'Mail',
    sortOrder: 90,
    requirement: { isMandatory: true, requiredIfSecondApplicant: false },
  }),
  type({
    id: 'discount',
    key: 'discount_cost_sheet',
    label: 'Discount cost sheet',
    sortOrder: 100,
    requirement: { isMandatory: false, requiredIfSecondApplicant: false },
  }),
];

describe('buildChecklist', () => {
  it('hides second-applicant rows for a sole applicant', () => {
    const slots = buildChecklist({ types: TYPES, documents: [], hasSecondApplicant: false });
    expect(slots.map((s) => s.type.key)).not.toContain('photo_applicant_2');
  });

  it('shows them once there is a second applicant', () => {
    const slots = buildChecklist({ types: TYPES, documents: [], hasSecondApplicant: true });
    expect(slots.map((s) => s.type.key)).toContain('photo_applicant_2');
  });

  it('keeps the printed order of the paper tick-list', () => {
    const slots = buildChecklist({ types: TYPES, documents: [], hasSecondApplicant: true });
    expect(slots.map((s) => s.type.key)).toEqual([
      'photo_applicant_1',
      'photo_applicant_2',
      'pan_applicant_1',
      'mail',
      'discount_cost_sheet',
    ]);
  });

  it('orders deterministically when two types share a sort order', () => {
    const tied = [
      type({ id: 'b', key: 'bravo', sortOrder: 5 }),
      type({ id: 'a', key: 'alpha', sortOrder: 5 }),
    ];
    const slots = buildChecklist({ types: tied, documents: [], hasSecondApplicant: false });
    expect(slots.map((s) => s.type.key)).toEqual(['alpha', 'bravo']);
  });

  it('does not mutate the array it was given', () => {
    const input = [...TYPES];
    buildChecklist({ types: input, documents: [], hasSecondApplicant: true });
    expect(input.map((t) => t.id)).toEqual(TYPES.map((t) => t.id));
  });

  it('attaches an uploaded document to its slot', () => {
    const slots = buildChecklist({
      types: TYPES,
      documents: [uploaded('pan1')],
      hasSecondApplicant: false,
    });
    expect(slots.find((s) => s.type.id === 'pan1')?.document?.id).toBe('doc-pan1');
    expect(slots.find((s) => s.type.id === 'mail')?.document).toBeNull();
  });

  it('shows the most recent upload when a slot has more than one', () => {
    const slots = buildChecklist({
      types: TYPES,
      documents: [
        uploaded('mail', { id: 'old', uploadedAt: new Date('2026-10-01T00:00:00Z') }),
        uploaded('mail', { id: 'new', uploadedAt: new Date('2026-10-22T00:00:00Z') }),
      ],
      hasSecondApplicant: false,
    });
    expect(slots.find((s) => s.type.id === 'mail')?.document?.id).toBe('new');
  });
});

describe('required', () => {
  it('marks mandatory types required', () => {
    const slots = buildChecklist({ types: TYPES, documents: [], hasSecondApplicant: false });
    expect(slots.find((s) => s.type.id === 'pan1')?.required).toBe(true);
  });

  it('leaves optional types optional', () => {
    const slots = buildChecklist({ types: TYPES, documents: [], hasSecondApplicant: false });
    expect(slots.find((s) => s.type.id === 'discount')?.required).toBe(false);
  });

  it('makes a second-applicant document required only when one exists', () => {
    const withSecond = buildChecklist({
      types: TYPES,
      documents: [],
      hasSecondApplicant: true,
    });
    expect(withSecond.find((s) => s.type.id === 'photo2')?.required).toBe(true);
  });

  it('treats a type with no requirement row as optional', () => {
    const slots = buildChecklist({
      types: [type({ id: 'x', key: 'extra' })],
      documents: [],
      hasSecondApplicant: false,
    });
    expect(slots[0]?.required).toBe(false);
  });
});

describe('checklistProgress', () => {
  it('counts only required slots in the denominator', () => {
    const slots = buildChecklist({ types: TYPES, documents: [], hasSecondApplicant: false });
    const progress = checklistProgress(slots);

    // photo_applicant_1, pan_applicant_1, mail.
    expect(progress.requiredTotal).toBe(3);
    expect(progress.requiredSatisfied).toBe(0);
    expect(progress.complete).toBe(false);
  });

  it('names what is still missing, disambiguated by applicant', () => {
    const slots = buildChecklist({
      types: TYPES,
      documents: [uploaded('mail'), uploaded('photo1')],
      hasSecondApplicant: false,
    });
    const progress = checklistProgress(slots);

    expect(progress.requiredSatisfied).toBe(2);
    expect(progress.missing).toEqual(['PAN card (1st applicant)']);
  });

  it('is complete once every required slot is filled', () => {
    const slots = buildChecklist({
      types: TYPES,
      documents: [uploaded('photo1'), uploaded('pan1'), uploaded('mail')],
      hasSecondApplicant: false,
    });
    const progress = checklistProgress(slots);

    expect(progress.complete).toBe(true);
    expect(progress.missing).toEqual([]);
  });

  it('does not let an optional upload satisfy the gate', () => {
    const slots = buildChecklist({
      types: TYPES,
      documents: [uploaded('discount')],
      hasSecondApplicant: false,
    });
    const progress = checklistProgress(slots);

    expect(progress.complete).toBe(false);
    expect(progress.requiredSatisfied).toBe(0);
    expect(progress.optionalUploaded).toBe(1);
  });

  it('becomes incomplete again when a second applicant is added', () => {
    const documents = [uploaded('photo1'), uploaded('pan1'), uploaded('mail')];

    expect(
      checklistProgress(buildChecklist({ types: TYPES, documents, hasSecondApplicant: false }))
        .complete,
    ).toBe(true);

    const withSecond = checklistProgress(
      buildChecklist({ types: TYPES, documents, hasSecondApplicant: true }),
    );
    expect(withSecond.complete).toBe(false);
    expect(withSecond.missing).toEqual(['Passport-size photo (2nd applicant)']);
  });
});

describe('labelFor', () => {
  it('leaves a form-scoped label alone', () => {
    expect(labelFor(TYPES[3] as ChecklistType)).toBe('Mail');
  });

  it('distinguishes the two rows that share a printed label', () => {
    expect(labelFor(TYPES[0] as ChecklistType)).toBe('Passport-size photo (1st applicant)');
    expect(labelFor(TYPES[1] as ChecklistType)).toBe('Passport-size photo (2nd applicant)');
  });
});

describe('isAcceptedMimeType', () => {
  it('accepts a listed type', () => {
    expect(isAcceptedMimeType(TYPES[2] as ChecklistType, 'application/pdf')).toBe(true);
  });

  it('rejects a PDF where only a photograph makes sense', () => {
    expect(isAcceptedMimeType(TYPES[0] as ChecklistType, 'application/pdf')).toBe(false);
  });

  it('ignores the case the browser reported', () => {
    expect(isAcceptedMimeType(TYPES[0] as ChecklistType, 'IMAGE/JPEG')).toBe(true);
  });
});
