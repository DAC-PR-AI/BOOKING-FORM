/**
 * The shape of a submit-gate problem, and how to present it.
 *
 * Deliberately separate from `submit-gate.ts`, which owns the Zod schema that
 * *produces* these issues. The review panel is a client component and needs
 * only to render a list; importing the gate itself would pull the whole
 * validation schema into the browser bundle and put one module on both sides
 * of the `'use client'` boundary — which in Turbopack leaves the server import
 * resolving to the client proxy, where the schema is undefined.
 *
 * So the rule is: anything the browser needs lives here, and the schema stays
 * on the server. No Zod import in this file.
 */

/** Which block of the paper form an issue belongs to. */
export type GateSection =
  | 'header'
  | 'firstApplicant'
  | 'secondApplicant'
  | 'communicationAddress'
  | 'permanentAddress'
  | 'property'
  | 'payment'
  | 'remarks'
  | 'documents';

export type GateIssue = {
  section: GateSection;
  /** The field, as the paper form labels it. Empty for a whole-section rule. */
  field: string;
  message: string;
};

export const SECTION_TITLES: Record<GateSection, string> = {
  header: 'Booking details',
  firstApplicant: 'Sole / First Applicant',
  secondApplicant: 'Co / Second Applicant',
  communicationAddress: 'Communication Address',
  permanentAddress: 'Permanent Address',
  property: 'Property Details',
  payment: 'Payment Details',
  remarks: 'Remarks',
  documents: 'Supporting Documents',
};

/** Paper order, so the list reads top to bottom like the printed sheet. */
export const SECTION_ORDER: GateSection[] = [
  'header',
  'firstApplicant',
  'secondApplicant',
  'communicationAddress',
  'permanentAddress',
  'property',
  'payment',
  'remarks',
  'documents',
];

/** Where the user has to go to fix an issue in this section. */
export function sectionHref(formId: string, section: GateSection): string {
  return section === 'documents'
    ? `/forms/${formId}/documents`
    : `/forms/${formId}/edit`;
}

/** Groups issues for rendering, dropping sections that are clean. */
export function groupIssues(issues: GateIssue[]): Array<{
  section: GateSection;
  title: string;
  issues: GateIssue[];
}> {
  return SECTION_ORDER.map((section) => ({
    section,
    title: SECTION_TITLES[section],
    issues: issues.filter((issue) => issue.section === section),
  })).filter((group) => group.issues.length > 0);
}
