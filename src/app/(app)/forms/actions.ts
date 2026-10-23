'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/rbac';
import { audit } from '@/lib/audit/log';
import { draftSchema, type DraftInput } from '@/lib/validation/booking-form';
import { parseRupeesToPaise } from '@/lib/format/money';
import { encryptField, last4, toDbBytes } from '@/lib/crypto/field-encryption';
import { isValidAadhaar, isValidPan } from '@/lib/validation/aadhaar';

/** Statuses in which the creator may still edit. */
const EDITABLE = ['DRAFT', 'RETURNED'] as const;

/**
 * Creates an empty draft and sends the user into the editor.
 *
 * No Booking ID is allocated here — that happens at submit, so abandoned
 * drafts do not burn numbers and leave gaps finance would read as missing
 * bookings (FIELD_MAP.md §1).
 */
export async function createDraft(): Promise<void> {
  const user = await requireRole('SALES_EXECUTIVE', 'ADMIN');

  const template = await prisma.formTemplate.findFirst({
    where: { organizationId: user.organizationId, key: 'booking_form', isActive: true },
  });
  if (!template) throw new Error('Booking form template is missing. Run `npm run db:seed`.');

  const form = await prisma.bookingForm.create({
    data: {
      organizationId: user.organizationId,
      formTemplateId: template.id,
      createdById: user.id,
      bookingDate: new Date(),
      salesExecutive: user.name,
      status: 'DRAFT',
      applicants: { create: [{ applicantType: 'PRIMARY' }] },
      addresses: {
        create: [{ type: 'COMMUNICATION' }, { type: 'PERMANENT' }],
      },
    },
  });

  await audit({
    organizationId: user.organizationId,
    userId: user.id,
    bookingFormId: form.id,
    action: 'CREATE',
    detail: 'Created a booking form draft.',
  });

  redirect(`/forms/${form.id}/edit`);
}

export type SaveResult =
  | { ok: true; savedAt: string }
  | { ok: false; error: string };

/**
 * Autosave. Deliberately forgiving — a draft may be incomplete or wrong, and
 * rejecting a half-typed field would lose the user's work. Only submit is a
 * gate (Phase 4).
 *
 * Sensitive values are encrypted on the way in; nothing here writes a raw PAN
 * or Aadhaar to the database or to the audit trail.
 */
export async function saveDraft(formId: string, payload: DraftInput): Promise<SaveResult> {
  const user = await requireRole('SALES_EXECUTIVE', 'ADMIN');

  const parsed = draftSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: 'Some values were too long to save.' };
  }
  const d = parsed.data;

  const form = await prisma.bookingForm.findFirst({
    where: {
      id: formId,
      organizationId: user.organizationId,
      // An admin may rescue a form; otherwise only the creator.
      ...(user.role.name === 'ADMIN' ? {} : { createdById: user.id }),
    },
    include: { applicants: true, addresses: true },
  });

  if (!form) return { ok: false, error: 'Form not found.' };

  if (!EDITABLE.includes(form.status as (typeof EDITABLE)[number])) {
    return {
      ok: false,
      error: 'This form has been submitted and can no longer be edited.',
    };
  }

  const money = (v: string | undefined): bigint | null => {
    if (!v) return null;
    const r = parseRupeesToPaise(v);
    return r.ok ? r.paise : null;
  };

  const decimal = (v: string | undefined): Prisma.Decimal | null =>
    v && /^\d{1,8}(\.\d{1,2})?$/.test(v) ? new Prisma.Decimal(v) : null;

  const date = (v: string | undefined): Date | null => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const parsedDate = new Date(`${v}T00:00:00Z`);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  };

  const enumOrNull = <T extends string>(v: string | undefined, allowed: readonly T[]) =>
    v && (allowed as readonly string[]).includes(v) ? (v as T) : null;

  await prisma.$transaction(async (tx) => {
    await tx.bookingForm.update({
      where: { id: form.id },
      data: {
        bookingDate: date(d.bookingDate) ?? form.bookingDate,
        projectId: d.projectId || null,
        propertyType: enumOrNull(d.propertyType, ['VILLA', 'PLOT', 'APARTMENT'] as const),
        apartmentNo: d.apartmentNo || null,
        salesExecutive: d.salesExecutive || null,
        salesHead: d.salesHead || null,
        telecaller: d.telecaller || null,
        leadId: d.leadId || null,
        source: d.source || null,

        builtUpAreaSqft: decimal(d.builtUpAreaSqft),
        udsSqft: decimal(d.udsSqft),
        floor: d.floor || null,

        bookingAdvancePaise: money(d.bookingAdvance),
        paymentMode: enumOrNull(d.paymentMode, ['CHQ', 'CARD', 'ONLINE'] as const),
        paymentRefNo: d.paymentRefNo || null,
        paymentDate: date(d.paymentDate),
        bank: d.bank || null,
        paymentSource: enumOrNull(d.paymentSource, ['OWN_FUNDS', 'HOME_LOAN'] as const),
        salePricePaise: money(d.salePrice),

        remarks: d.remarks || null,
      },
    });

    // --- applicants -------------------------------------------------------
    const writeApplicant = async (
      type: 'PRIMARY' | 'SECONDARY',
      a: NonNullable<DraftInput['firstApplicant']>,
    ) => {
      const pan = a.pan?.trim().toUpperCase();
      const aadhaarDigits = a.aadhaar?.replace(/\s/g, '');

      const data = {
        salutation: enumOrNull(a.salutation, ['MR', 'MRS', 'MS'] as const),
        fullName: a.fullName ? a.fullName.toUpperCase() : null,
        relationType: enumOrNull(a.relationType, ['SON_OF', 'DAUGHTER_OF', 'WIFE_OF'] as const),
        guardianSalutation: enumOrNull(a.guardianSalutation, ['MR', 'MRS', 'MS'] as const),
        guardianName: a.guardianName ? a.guardianName.toUpperCase() : null,
        mobileNo: a.mobileNo || null,
        altMobileNo: a.altMobileNo || null,
        email: a.email ? a.email.toLowerCase() : null,
        // Only encrypt once the value is actually well formed; a partial PAN
        // is not worth a ciphertext and would break the last-4.
        panEncrypted: pan && isValidPan(pan) ? toDbBytes(encryptField(pan)) : null,
        panLast4: pan && isValidPan(pan) ? last4(pan) : null,
        aadhaarEncrypted:
          aadhaarDigits && isValidAadhaar(aadhaarDigits)
            ? toDbBytes(encryptField(aadhaarDigits))
            : null,
        aadhaarLast4:
          aadhaarDigits && isValidAadhaar(aadhaarDigits) ? last4(aadhaarDigits) : null,
        dob: date(a.dob),
        occupation: a.occupation || null,
        companyName: a.companyName || null,
        designation: a.designation || null,
        location: a.location || null,
      };

      await tx.applicant.upsert({
        where: { bookingFormId_applicantType: { bookingFormId: form.id, applicantType: type } },
        update: data,
        create: { ...data, bookingFormId: form.id, applicantType: type },
      });
    };

    if (d.firstApplicant) await writeApplicant('PRIMARY', d.firstApplicant);

    if (d.hasSecondApplicant && d.secondApplicant) {
      await writeApplicant('SECONDARY', d.secondApplicant);
    } else if (d.hasSecondApplicant === false) {
      // Removing the second applicant removes their row and their documents.
      await tx.applicant.deleteMany({
        where: { bookingFormId: form.id, applicantType: 'SECONDARY' },
      });
    }

    // --- addresses --------------------------------------------------------
    const writeAddress = async (
      type: 'COMMUNICATION' | 'PERMANENT',
      lines: NonNullable<DraftInput['communicationAddress']>,
    ) => {
      const data = {
        line1: lines.line1 || null,
        line2: lines.line2 || null,
        line3: lines.line3 || null,
        line4: lines.line4 || null,
      };
      await tx.address.upsert({
        where: { bookingFormId_type: { bookingFormId: form.id, type } },
        update: data,
        create: { ...data, bookingFormId: form.id, type },
      });
    };

    if (d.communicationAddress) await writeAddress('COMMUNICATION', d.communicationAddress);
    if (d.permanentAddress) await writeAddress('PERMANENT', d.permanentAddress);
  });

  revalidatePath('/forms');
  return { ok: true, savedAt: new Date().toISOString() };
}
