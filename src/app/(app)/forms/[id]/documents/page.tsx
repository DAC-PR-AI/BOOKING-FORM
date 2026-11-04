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
    <div className="mx-auto max-w-4xl">
      {/* 3-Step Workflow Bar */}
      {access.editable ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-slate-200/90 bg-white px-4 py-3 text-xs shadow-2xs">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/forms/${form.id}/edit`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-dac-navy-700 transition hover:border-dac-navy-300 hover:bg-dac-navy-50"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-dac-navy-100 text-[10px] text-dac-navy-800">
                1
              </span>
              <span>Booking Form</span>
            </Link>
            <span className="text-slate-300" aria-hidden="true">→</span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-dac-navy-800 px-2.5 py-1 font-semibold text-white shadow-2xs">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px]">
                2
              </span>
              <span>Supporting documents</span>
            </span>
            <span className="text-slate-300" aria-hidden="true">→</span>
            <Link
              href={`/forms/${form.id}/review`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-dac-navy-700 transition hover:border-dac-navy-300 hover:bg-dac-navy-50"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-dac-navy-100 text-[10px] text-dac-navy-800">
                3
              </span>
              <span>Review and submit</span>
            </Link>
          </div>
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Supporting Documents"
          description={
            primaryName
              ? `Attachments for ${primaryName}${form.bookingId ? ` — ${form.bookingId}` : ''}.`
              : 'Attachments for this booking.'
          }
        />
        <div className="flex flex-wrap gap-2">
          {access.editable ? (
            <>
              <Link
                href={`/forms/${form.id}/edit`}
                className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
              >
                ← Back to the form
              </Link>
              <Link
                href={`/forms/${form.id}/review`}
                className="rounded-xl bg-gradient-to-r from-dac-navy-800 to-dac-navy-700 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:from-dac-navy-900 hover:to-dac-navy-800"
              >
                Review &amp; Submit →
              </Link>
            </>
          ) : null}
          <Link
            href={`/forms/${form.id}`}
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
          >
            Booking status
          </Link>
          <Link
            href="/forms"
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
          >
            My forms
          </Link>
        </div>
      </div>

      {!access.editable && access.canUploadAnytime ? (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-3.5 text-sm text-blue-900 shadow-2xs">
          Mandatory identity documents (Photo, PAN, Aadhaar) are locked once submitted. You can
          still upload or update any other supporting documents (1st payment screenshot, cost
          sheets, mail) at any time.
        </div>
      ) : null}

      {!access.canUploadAnytime ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-900 shadow-2xs">
          This booking has been cancelled, so its documents are locked. You can still open them.
        </div>
      ) : null}

      {!hasSecondApplicant ? (
        <p className="mb-5 text-xs font-medium text-slate-500">
          Second-applicant documents are not listed because this booking has one applicant. Add a
          second applicant on the form and they will appear here.
        </p>
      ) : null}

      <DocumentChecklist
        bookingFormId={form.id}
        editable={access.editable}
        canUploadAnytime={access.canUploadAnytime}
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
    </div>
  );
}
