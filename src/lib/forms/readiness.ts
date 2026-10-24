import 'server-only';
import { prisma } from '@/lib/db';
import { paiseToInputValue } from '@/lib/format/money';
import { buildChecklist, type ChecklistSlot } from '@/lib/documents/checklist';
import type { StoredSubmitInput } from '@/lib/validation/booking-form';
import { evaluateSubmitReadiness, type SubmitReadiness } from './submit-gate';

/**
 * Reads a booking form out of the database and asks the gate whether it can be
 * submitted.
 *
 * The mapping below is the only place where stored columns become gate input,
 * which is the point: the gate is pure and knows nothing about Prisma, and this
 * file knows nothing about validation rules. A null column becomes `''` rather
 * than being dropped, so an unfilled field reports as "required" instead of
 * silently passing an `.optional()` check.
 */

function isoDate(value: Date | null): string {
  // Stored as DATE, so the UTC slice is the calendar day that was entered.
  return value ? value.toISOString().slice(0, 10) : '';
}

type ApplicantRow = {
  salutation: string | null;
  fullName: string | null;
  relationType: string | null;
  guardianSalutation: string | null;
  guardianName: string | null;
  mobileNo: string | null;
  altMobileNo: string | null;
  email: string | null;
  panLast4: string | null;
  aadhaarLast4: string | null;
  dob: Date | null;
  occupation: string | null;
  companyName: string | null;
  designation: string | null;
  location: string | null;
};

function applicantInput(row: ApplicantRow): StoredSubmitInput['firstApplicant'] {
  return {
    salutation: row.salutation ?? '',
    fullName: row.fullName ?? '',
    relationType: row.relationType ?? '',
    guardianSalutation: row.guardianSalutation ?? '',
    guardianName: row.guardianName ?? '',
    mobileNo: row.mobileNo ?? '',
    altMobileNo: row.altMobileNo ?? '',
    email: row.email ?? '',
    panLast4: row.panLast4 ?? '',
    aadhaarLast4: row.aadhaarLast4 ?? '',
    dob: isoDate(row.dob),
    occupation: row.occupation ?? '',
    companyName: row.companyName ?? '',
    designation: row.designation ?? '',
    location: row.location ?? '',
  } as StoredSubmitInput['firstApplicant'];
}

export type FormForGate = NonNullable<Awaited<ReturnType<typeof loadFormForGate>>>;

export async function loadFormForGate(formId: string, organizationId: string) {
  return prisma.bookingForm.findFirst({
    where: { id: formId, organizationId },
    include: {
      applicants: true,
      addresses: true,
      project: { select: { id: true, name: true, isActive: true } },
      documents: {
        select: {
          id: true,
          documentTypeId: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          uploadedAt: true,
        },
      },
    },
  });
}

/** The document checklist for a form, with its requirement rules applied. */
export async function loadChecklist(
  form: FormForGate,
  organizationId: string,
): Promise<ChecklistSlot[]> {
  const types = await prisma.documentType.findMany({
    where: { organizationId, isActive: true },
    include: { requirement: true },
    orderBy: { sortOrder: 'asc' },
  });

  return buildChecklist({
    types: types.map((t) => ({
      id: t.id,
      key: t.key,
      label: t.label,
      helpText: t.helpText,
      scope: t.scope,
      appliesTo: t.appliesTo,
      acceptedMimeTypes: t.acceptedMimeTypes,
      maxBytes: t.maxBytes,
      sortOrder: t.sortOrder,
      requirement: t.requirement
        ? {
            isMandatory: t.requirement.isMandatory,
            requiredIfSecondApplicant: t.requirement.requiredIfSecondApplicant,
          }
        : null,
    })),
    documents: form.documents,
    hasSecondApplicant: form.applicants.some((a) => a.applicantType === 'SECONDARY'),
  });
}

export function toGateInput(form: FormForGate): StoredSubmitInput {
  const primary = form.applicants.find((a) => a.applicantType === 'PRIMARY');
  const secondary = form.applicants.find((a) => a.applicantType === 'SECONDARY');
  const communication = form.addresses.find((a) => a.type === 'COMMUNICATION');
  const permanent = form.addresses.find((a) => a.type === 'PERMANENT');

  const address = (row: typeof communication): StoredSubmitInput['communicationAddress'] => ({
    line1: row?.line1 ?? '',
    line2: row?.line2 ?? '',
    line3: row?.line3 ?? '',
    line4: row?.line4 ?? '',
  });

  return {
    header: {
      bookingDate: isoDate(form.bookingDate),
      // An inactive project must not pass the gate: it would print a project
      // name the company no longer sells.
      projectId: form.project?.isActive ? form.project.id : '',
      propertyType: form.propertyType ?? '',
      apartmentNo: form.apartmentNo ?? '',
      salesExecutive: form.salesExecutive ?? '',
      salesHead: form.salesHead ?? '',
      telecaller: form.telecaller ?? '',
      leadId: form.leadId ?? '',
      source: form.source ?? '',
    } as StoredSubmitInput['header'],
    firstApplicant: primary
      ? applicantInput(primary)
      : applicantInput({} as ApplicantRow),
    secondApplicant: secondary ? applicantInput(secondary) : null,
    communicationAddress: address(communication),
    permanentAddress: address(permanent),
    property: {
      builtUpAreaSqft: form.builtUpAreaSqft?.toString() ?? '',
      udsSqft: form.udsSqft?.toString() ?? '',
      floor: form.floor ?? '',
    },
    payment: {
      bookingAdvance: form.bookingAdvancePaise
        ? paiseToInputValue(form.bookingAdvancePaise)
        : '',
      paymentMode: form.paymentMode ?? '',
      paymentRefNo: form.paymentRefNo ?? '',
      paymentDate: isoDate(form.paymentDate),
      bank: form.bank ?? '',
      paymentSource: form.paymentSource ?? '',
      salePrice: form.salePricePaise ? paiseToInputValue(form.salePricePaise) : '',
    } as StoredSubmitInput['payment'],
    remarks: form.remarks ?? '',
  };
}

export async function assessForm(
  form: FormForGate,
  organizationId: string,
): Promise<{ readiness: SubmitReadiness; documents: ChecklistSlot[] }> {
  const documents = await loadChecklist(form, organizationId);
  const readiness = evaluateSubmitReadiness({ form: toGateInput(form), documents });
  return { readiness, documents };
}
