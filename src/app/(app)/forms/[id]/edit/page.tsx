import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { Applicant } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/rbac';
import { paiseToInputValue } from '@/lib/format/money';
import { BookingFormEditor, type EditorState } from './booking-form-editor';

export const metadata: Metadata = { title: 'Edit booking form' };
export const dynamic = 'force-dynamic';

function isoOrEmpty(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : '';
}

function applicantToState(a: Applicant | undefined) {
  return {
    salutation: a?.salutation ?? '',
    fullName: a?.fullName ?? '',
    relationType: a?.relationType ?? '',
    guardianSalutation: a?.guardianSalutation ?? '',
    guardianName: a?.guardianName ?? '',
    mobileNo: a?.mobileNo ?? '',
    altMobileNo: a?.altMobileNo ?? '',
    email: a?.email ?? '',
    // Encrypted at rest and NOT decrypted for the editor. Re-entry is required
    // if the value needs changing; the last-4 is shown as a reminder only.
    pan: '',
    aadhaar: '',
    dob: isoOrEmpty(a?.dob ?? null),
    occupation: a?.occupation ?? '',
    companyName: a?.companyName ?? '',
    designation: a?.designation ?? '',
    location: a?.location ?? '',
  };
}

export default async function EditBookingFormPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireRole('SALES_EXECUTIVE', 'ADMIN');

  const form = await prisma.bookingForm.findFirst({
    where: {
      id,
      organizationId: user.organizationId,
      ...(user.role.name === 'ADMIN' ? {} : { createdById: user.id }),
    },
    include: { applicants: true, addresses: true },
  });

  // 404 rather than 403 — do not confirm that someone else's form exists.
  if (!form) notFound();

  if (form.status !== 'DRAFT' && form.status !== 'RETURNED') {
    notFound();
  }

  const [projects, sources, photos] = await Promise.all([
    prisma.project.findMany({
      where: { organizationId: user.organizationId, isActive: true },
      orderBy: { name: 'asc' },
    }),
    prisma.sourceOption.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    }),
    // The passport photographs, so the printed photo boxes are not empty in
    // the editor. Matched on the type key, which the admin screen cannot
    // rename, rather than on the label, which it can.
    prisma.formDocument.findMany({
      where: {
        bookingFormId: id,
        documentType: { key: { in: ['photo_applicant_1', 'photo_applicant_2'] } },
      },
      select: { id: true, documentType: { select: { key: true } } },
      orderBy: { uploadedAt: 'desc' },
    }),
  ]);

  const photoIdFor = (key: string): string | null =>
    photos.find((d) => d.documentType.key === key)?.id ?? null;

  const primary = form.applicants.find((a) => a.applicantType === 'PRIMARY');
  const secondary = form.applicants.find((a) => a.applicantType === 'SECONDARY');
  const communication = form.addresses.find((a) => a.type === 'COMMUNICATION');
  const permanent = form.addresses.find((a) => a.type === 'PERMANENT');

  const initial: EditorState = {
    bookingDate: isoOrEmpty(form.bookingDate),
    projectId: form.projectId ?? '',
    propertyType: form.propertyType ?? '',
    apartmentNo: form.apartmentNo ?? '',
    salesExecutive: form.salesExecutive ?? '',
    salesHead: form.salesHead ?? '',
    telecaller: form.telecaller ?? '',
    leadId: form.leadId ?? '',
    source: form.source ?? '',
    builtUpAreaSqft: form.builtUpAreaSqft?.toString() ?? '',
    udsSqft: form.udsSqft?.toString() ?? '',
    floor: form.floor ?? '',
    bookingAdvance: form.bookingAdvancePaise
      ? paiseToInputValue(form.bookingAdvancePaise)
      : '',
    paymentMode: form.paymentMode ?? '',
    paymentRefNo: form.paymentRefNo ?? '',
    paymentDate: isoOrEmpty(form.paymentDate),
    bank: form.bank ?? '',
    paymentSource: form.paymentSource ?? '',
    salePrice: form.salePricePaise ? paiseToInputValue(form.salePricePaise) : '',
    remarks: form.remarks ?? '',
    hasSecondApplicant: Boolean(secondary),
    sameAsCommunication: false,
    firstApplicant: applicantToState(primary),
    secondApplicant: applicantToState(secondary),
    communicationAddress: {
      line1: communication?.line1 ?? '',
      line2: communication?.line2 ?? '',
      line3: communication?.line3 ?? '',
      line4: communication?.line4 ?? '',
    },
    permanentAddress: {
      line1: permanent?.line1 ?? '',
      line2: permanent?.line2 ?? '',
      line3: permanent?.line3 ?? '',
      line4: permanent?.line4 ?? '',
    },
  };

  return (
    <BookingFormEditor
      formId={form.id}
      initial={initial}
      projects={projects.map((p) => ({ value: p.id, label: p.name }))}
      sources={sources.map((s) => ({ value: s.value, label: s.label }))}
      photoDocumentIds={{
        primary: photoIdFor('photo_applicant_1'),
        secondary: photoIdFor('photo_applicant_2'),
      }}
      existingLast4={{
        primary: { pan: primary?.panLast4 ?? null, aadhaar: primary?.aadhaarLast4 ?? null },
        secondary: { pan: secondary?.panLast4 ?? null, aadhaar: secondary?.aadhaarLast4 ?? null },
      }}
    />
  );
}
