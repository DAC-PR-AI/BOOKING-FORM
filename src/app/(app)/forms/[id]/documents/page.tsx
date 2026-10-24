import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/rbac';
import { authoriseFormAccess } from '@/lib/documents/access';
import { buildChecklist, checklistProgress } from '@/lib/documents/checklist';
import { PageHeader } from '@/components/ui/page-header';
import { DocumentChecklist } from './document-checklist';

export const metadata: Metadata = { title: 'Supporting documents' };
export const dynamic = 'force-dynamic';

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  // 404 rather than 403 — do not confirm that someone else's booking exists.
  const access = await authoriseFormAccess(user, id);
  if (!access) notFound();

  const [form, types, documents] = await Promise.all([
    prisma.bookingForm.findUniqueOrThrow({
      where: { id: access.bookingFormId },
      select: {
        id: true,
        bookingId: true,
        status: true,
        applicants: { select: { applicantType: true, fullName: true } },
      },
    }),
    prisma.documentType.findMany({
      where: { organizationId: user.organizationId, isActive: true },
      include: { requirement: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.formDocument.findMany({
      where: { bookingFormId: access.bookingFormId },
      select: {
        id: true,
        documentTypeId: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        uploadedAt: true,
      },
      orderBy: { uploadedAt: 'asc' },
    }),
  ]);

  const hasSecondApplicant = form.applicants.some((a) => a.applicantType === 'SECONDARY');

  const slots = buildChecklist({
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
    documents,
    hasSecondApplicant,
  });

  const progress = checklistProgress(slots);
  const primaryName = form.applicants.find((a) => a.applicantType === 'PRIMARY')?.fullName;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Supporting Documents"
          description={
            primaryName
              ? `Attachments for ${primaryName}${form.bookingId ? ` — ${form.bookingId}` : ''}.`
              : 'Attachments for this booking.'
          }
        />
        <div className="flex gap-2">
          {access.editable ? (
            <Link
              href={`/forms/${form.id}/edit`}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Back to the form
            </Link>
          ) : null}
          <Link
            href="/forms"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            My forms
          </Link>
        </div>
      </div>

      {!access.editable ? (
        <p className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This booking is no longer a draft, so its documents are locked. You can still open
          them.
        </p>
      ) : null}

      {!hasSecondApplicant ? (
        <p className="mb-6 text-sm text-gray-600">
          Second-applicant documents are not listed because this booking has one applicant.
          Add a second applicant on the form and they will appear here.
        </p>
      ) : null}

      <DocumentChecklist
        bookingFormId={form.id}
        editable={access.editable}
        slots={slots.map((slot) => ({
          typeId: slot.type.id,
          typeKey: slot.type.key,
          label: slot.type.label,
          helpText: slot.type.helpText,
          appliesTo: slot.type.appliesTo,
          acceptedMimeTypes: slot.type.acceptedMimeTypes,
          maxBytes: slot.type.maxBytes,
          required: slot.required,
          document: slot.document
            ? {
                id: slot.document.id,
                originalName: slot.document.originalName,
                mimeType: slot.document.mimeType,
                sizeBytes: slot.document.sizeBytes,
                uploadedAt: slot.document.uploadedAt.toISOString(),
              }
            : null,
        }))}
        progress={progress}
      />
    </>
  );
}
