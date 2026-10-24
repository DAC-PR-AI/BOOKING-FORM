/**
 * The supporting-document checklist.
 *
 * Pure, and unit tested, because this is the function that decides whether a
 * booking may be submitted (Phase 4 calls it as part of the submit gate). The
 * paper form lists the attachments as a fixed tick-list, but which ones are
 * *mandatory* is a business rule DAC can change, so the rule lives in
 * `document_requirements` rows rather than in this file — see PLAN.md §2.
 *
 * Two kinds of conditionality, both from the brief:
 *
 *   * A second-applicant document is only asked for when there is a second
 *     applicant (OPEN_QUESTIONS Q11). It is hidden, not merely optional —
 *     showing an eternally empty "Photo (2nd applicant)" row would read as an
 *     outstanding task.
 *   * Everything else is mandatory or optional outright.
 */

export type ApplicantScope = 'PRIMARY' | 'SECONDARY';

export type ChecklistType = {
  id: string;
  key: string;
  label: string;
  helpText: string | null;
  scope: 'FORM' | 'APPLICANT';
  appliesTo: ApplicantScope | null;
  acceptedMimeTypes: string[];
  maxBytes: number;
  sortOrder: number;
  requirement: {
    isMandatory: boolean;
    requiredIfSecondApplicant: boolean;
  } | null;
};

export type ChecklistDocument = {
  id: string;
  documentTypeId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
};

export type ChecklistSlot = {
  type: ChecklistType;
  /** Must be present before the form can be submitted. */
  required: boolean;
  /** The uploaded file, or null while the slot is empty. */
  document: ChecklistDocument | null;
};

export type ChecklistInput = {
  types: ChecklistType[];
  documents: ChecklistDocument[];
  hasSecondApplicant: boolean;
};

/** A second-applicant row is not shown at all until there is one. */
function isApplicable(type: ChecklistType, hasSecondApplicant: boolean): boolean {
  if (type.scope === 'APPLICANT' && type.appliesTo === 'SECONDARY') {
    return hasSecondApplicant;
  }
  return true;
}

function isRequired(type: ChecklistType, hasSecondApplicant: boolean): boolean {
  const requirement = type.requirement;
  if (!requirement) return false;
  if (requirement.isMandatory) return true;
  if (requirement.requiredIfSecondApplicant) return hasSecondApplicant;
  return false;
}

export function buildChecklist(input: ChecklistInput): ChecklistSlot[] {
  // Most recent upload wins, so a replaced document shows the new file even
  // if the old row has not been cleaned up yet.
  const latestByType = new Map<string, ChecklistDocument>();
  for (const document of input.documents) {
    const existing = latestByType.get(document.documentTypeId);
    if (!existing || document.uploadedAt > existing.uploadedAt) {
      latestByType.set(document.documentTypeId, document);
    }
  }

  return input.types
    .filter((type) => isApplicable(type, input.hasSecondApplicant))
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
    .map((type) => ({
      type,
      required: isRequired(type, input.hasSecondApplicant),
      document: latestByType.get(type.id) ?? null,
    }));
}

export type ChecklistProgress = {
  /** Required slots only — the denominator a user cares about. */
  requiredTotal: number;
  requiredSatisfied: number;
  /** Optional documents that were uploaded anyway. */
  optionalUploaded: number;
  /** Labels of the required slots still empty, for the submit-blocked message. */
  missing: string[];
  complete: boolean;
};

export function checklistProgress(slots: ChecklistSlot[]): ChecklistProgress {
  const required = slots.filter((slot) => slot.required);
  const satisfied = required.filter((slot) => slot.document !== null);
  const missing = required.filter((slot) => slot.document === null);

  return {
    requiredTotal: required.length,
    requiredSatisfied: satisfied.length,
    optionalUploaded: slots.filter((slot) => !slot.required && slot.document !== null).length,
    missing: missing.map((slot) => labelFor(slot.type)),
    complete: missing.length === 0,
  };
}

/**
 * Disambiguates the two rows that share a label on the paper form — "PAN card"
 * and "Adhaar card" each appear once per applicant.
 */
export function labelFor(type: ChecklistType): string {
  if (type.scope !== 'APPLICANT' || type.appliesTo === null) return type.label;
  const which = type.appliesTo === 'PRIMARY' ? '1st applicant' : '2nd applicant';
  return `${type.label} (${which})`;
}

/** Shared by the picker's `accept` attribute and the server-side check. */
export function isAcceptedMimeType(type: ChecklistType, mimeType: string): boolean {
  return type.acceptedMimeTypes.includes(mimeType.toLowerCase());
}
