import { z } from 'zod';
import {
  storedSubmitSchema,
  type StoredSubmitInput,
} from '@/lib/validation/booking-form';
import {
  checklistProgress,
  type ChecklistSlot,
} from '@/lib/documents/checklist';
import {
  SECTION_ORDER,
  type GateIssue,
  type GateSection,
} from './gate-issues';

/**
 * The submit gate.
 *
 * Submitting is the one irreversible step a sales executive takes: a Booking
 * ID is allocated, the fields lock, and nine people start signing. So the gate
 * does not merely say "no" — it reports **everything** that is outstanding, in
 * the order the paper form prints it, so the form can be finished in one pass
 * rather than discovered one error at a time.
 *
 * Pure and unit tested. It is the function that decides whether a booking can
 * exist, and it must be possible to assert on its answers without a database.
 *
 * Note what it does *not* check: whether the T&C were accepted. Acceptance is
 * an act performed on the review page, not a property of the stored form, so
 * it is the caller's business (`submitBookingForm`) and is recorded in the same
 * transaction as the submit.
 */

export type { GateSection, GateIssue } from './gate-issues';
export { SECTION_TITLES, SECTION_ORDER, sectionHref, groupIssues } from './gate-issues';

export type SubmitReadiness = {
  ready: boolean;
  issues: GateIssue[];
  /** Counts for the summary line, so the page need not re-derive them. */
  fieldIssueCount: number;
  documentIssueCount: number;
};

/**
 * Field labels as printed on the paper, keyed by the schema path. Zod's own
 * messages already read well for most fields; this covers the ones where the
 * schema key and the printed label differ, so the gate never shows a user a
 * camelCase property name.
 */
const FIELD_LABELS: Record<string, string> = {
  bookingDate: 'Booking Date',
  projectId: 'Project Name',
  propertyType: 'Property type',
  apartmentNo: 'Apartment No',
  salesExecutive: 'Sales Executive',
  salesHead: 'Sales Head',
  telecaller: 'Telecaller',
  leadId: 'Lead ID',
  source: 'Source',

  salutation: 'Mr./Mrs./Ms.',
  fullName: 'Name',
  relationType: 'Son / Daughter / Wife of',
  guardianSalutation: 'Mr./Mrs./Ms.',
  guardianName: 'Father / Husband name',
  mobileNo: 'Mobile No',
  altMobileNo: 'Alternate Mobile No',
  email: 'Mail ID',
  panLast4: 'PAN card number',
  aadhaarLast4: 'Adhaar number',
  dob: 'D.O.B',
  occupation: 'Occupation',
  companyName: 'Company name',
  designation: 'Designation',
  location: 'Location',

  line1: 'Address line 1',
  line2: 'Address line 2',
  line3: 'Address line 3',
  line4: 'Address line 4',

  builtUpAreaSqft: 'Built-up Area (sq.ft)',
  udsSqft: 'UDS (sq.ft)',
  floor: 'Floor',

  bookingAdvance: 'Booking Advance',
  paymentMode: 'Mode of payment',
  paymentRefNo: 'Ref. No.',
  paymentDate: 'Payment Date',
  bank: 'Bank',
  paymentSource: 'Source of payment',
  salePrice: 'Sale Price',
};

/** Sections the schema can produce a path for; 'documents' comes from the checklist. */
const SCHEMA_SECTIONS = new Set<string>(
  SECTION_ORDER.filter((section) => section !== 'documents'),
);

function labelFor(path: readonly (string | number | symbol)[]): string {
  // The last string segment is the field; a `.refine` on a whole object has
  // no field segment at all, which is why this can legitimately be empty.
  for (let i = path.length - 1; i >= 1; i -= 1) {
    const segment = path[i];
    if (typeof segment === 'string') return FIELD_LABELS[segment] ?? segment;
  }
  return '';
}

function sectionFor(path: readonly (string | number | symbol)[]): GateSection {
  const head = path[0];
  // An unrecognised path would be a schema change this map has not caught up
  // with. Attributing it to the header is wrong but visible; dropping it would
  // block submission with nothing shown, which is far worse.
  return typeof head === 'string' && SCHEMA_SECTIONS.has(head)
    ? (head as GateSection)
    : 'header';
}

/**
 * One complaint per field, keeping the first.
 *
 * A single empty field can fail several rules at once — an empty area string
 * trips both "must be a number" and "must be greater than zero" — and listing
 * both makes the form look more broken than it is while saying nothing extra.
 * Section-level issues (a `.refine` across a whole block, which has no field
 * segment) are never collapsed, because two of those genuinely are two
 * different problems.
 */
function issuesFromZod(error: z.ZodError): GateIssue[] {
  const seen = new Set<string>();
  const issues: GateIssue[] = [];

  for (const issue of error.issues) {
    const section = sectionFor(issue.path);
    const field = labelFor(issue.path);

    if (field !== '') {
      const key = `${section}\u0000${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }

    issues.push({ section, field, message: issue.message });
  }

  return issues;
}

export type GateInput = {
  form: StoredSubmitInput;
  /** The checklist for this form, from `buildChecklist`. */
  documents: ChecklistSlot[];
};

export function evaluateSubmitReadiness(input: GateInput): SubmitReadiness {
  const parsed = storedSubmitSchema.safeParse(input.form);
  const fieldIssues = parsed.success ? [] : issuesFromZod(parsed.error);

  const progress = checklistProgress(input.documents);
  const documentIssues: GateIssue[] = progress.missing.map((label) => ({
    section: 'documents' as const,
    field: label,
    message: `${label} has not been attached.`,
  }));

  const issues = [...fieldIssues, ...documentIssues].sort(
    (a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section),
  );

  return {
    ready: issues.length === 0,
    issues,
    fieldIssueCount: fieldIssues.length,
    documentIssueCount: documentIssues.length,
  };
}
