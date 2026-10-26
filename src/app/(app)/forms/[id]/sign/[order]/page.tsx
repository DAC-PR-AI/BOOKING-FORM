import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/rbac';
import { authoriseFormAccess } from '@/lib/documents/access';
import { formatPaise } from '@/lib/format/money';
import { canActOnStep, planAdvance, DENIAL_MESSAGES, type FormStatus } from '@/lib/flow/act';
import { PageHeader } from '@/components/ui/page-header';
import { SignPanel } from './sign-panel';

export const metadata: Metadata = { title: 'Sign' };
export const dynamic = 'force-dynamic';

/**
 * The signing screen, shared by all nine steps.
 *
 * One screen rather than one per role, because the decision is the same in
 * every case: read the booking, then sign it or send it back. What differs is
 * data — whether the step is an in-person applicant capture, and whether it
 * carries the Co-ordinator's validation tick — and that comes from the
 * `flow_steps` row, so a tenth step needs no new page.
 *
 * Everything needed to make the decision is on the page: the figures, the
 * attachments, the terms, and who has signed already. A reviewer should not
 * have to open three tabs to approve a booking.
 */
export default async function SignStepPage({
  params,
}: {
  params: Promise<{ id: string; order: string }>;
}) {
  const { id, order } = await params;
  const orderIndex = Number.parseInt(order, 10);
  if (!Number.isInteger(orderIndex) || orderIndex < 1) notFound();

  const user = await requireUser();

  // 404 rather than 403 — do not confirm that someone else's booking exists.
  const access = await authoriseFormAccess(user, id);
  if (!access) notFound();

  const record = await prisma.formStepRecord.findFirst({
    where: { orderIndex, flowInstance: { bookingFormId: access.bookingFormId } },
    include: {
      flowStep: {
        select: {
          label: true,
          roleId: true,
          action: true,
          actsOnCreatorDevice: true,
          role: { select: { label: true } },
        },
      },
      assignee: { select: { name: true } },
      flowInstance: {
        include: {
          bookingForm: {
            include: {
              project: { select: { name: true } },
              applicants: { select: { applicantType: true, fullName: true } },
              tncVersion: { select: { version: true } },
              _count: { select: { documents: true } },
            },
          },
          stepRecords: {
            orderBy: { orderIndex: 'asc' },
            include: {
              flowStep: { select: { label: true } },
              assignee: { select: { name: true } },
              signatureAsset: { select: { id: true, signerName: true } },
            },
          },
        },
      },
    },
  });
  if (!record) notFound();

  const form = record.flowInstance.bookingForm;

  const check = canActOnStep(
    {
      userId: user.id,
      roleId: user.roleId,
      isCreator: form.createdById === user.id,
    },
    {
      orderIndex: record.orderIndex,
      status: record.status,
      assigneeId: record.assigneeId,
      roleId: record.flowStep.roleId,
      action: record.flowStep.action,
      actsOnCreatorDevice: record.flowStep.actsOnCreatorDevice,
    },
    form.status as FormStatus,
  );

  const steps = await prisma.flowStep.findMany({
    where: { flowTemplate: { instances: { some: { id: record.flowInstance.id } } } },
    orderBy: { orderIndex: 'asc' },
    select: {
      id: true,
      orderIndex: true,
      label: true,
      roleId: true,
      action: true,
      skipIfNoSecondApplicant: true,
      actsOnCreatorDevice: true,
      pdfSignatureSlot: true,
    },
  });

  const hasSecondApplicant = form.applicants.some((a) => a.applicantType === 'SECONDARY');
  const advance = planAdvance(
    steps,
    { hasSecondApplicant, creatorId: form.createdById },
    record.orderIndex,
  );

  const primary = form.applicants.find((a) => a.applicantType === 'PRIMARY');
  const secondary = form.applicants.find((a) => a.applicantType === 'SECONDARY');
  const isApplicantStep = record.flowStep.actsOnCreatorDevice;
  const applicantName = isApplicantStep
    ? (record.orderIndex === 1 ? primary?.fullName : secondary?.fullName) ?? null
    : null;

  const alreadySigned = record.flowInstance.stepRecords.filter(
    (r) => r.status === 'SIGNED' || r.status === 'VALIDATED',
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title={`Step ${record.orderIndex} — ${record.flowStep.label}`}
          description={`${form.bookingId ?? 'Booking form'} · ${primary?.fullName ?? 'No applicant name'}`}
        />
        <Link
          href={`/forms/${form.id}`}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Full booking
        </Link>
      </div>

      {/* --- the figures being approved ----------------------------------- */}
      <section className="mb-5 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">What you are approving</h2>
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Sole / First Applicant" value={primary?.fullName ?? '—'} />
          <Row label="Co / Second Applicant" value={secondary?.fullName ?? 'None'} />
          <Row label="Project" value={form.project?.name ?? '—'} />
          <Row
            label="Property"
            value={
              form.propertyType
                ? `${form.propertyType[0]}${form.propertyType.slice(1).toLowerCase()}${
                    form.apartmentNo ? ` ${form.apartmentNo}` : ''
                  }`
                : '—'
            }
          />
          <Row
            label="Sale Price"
            value={form.salePricePaise ? formatPaise(form.salePricePaise) : '—'}
          />
          <Row
            label="Booking Advance"
            value={form.bookingAdvancePaise ? formatPaise(form.bookingAdvancePaise) : '—'}
          />
        </dl>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
          <Link
            href={`/forms/${form.id}/documents`}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Documents ({form._count.documents})
          </Link>
          {form.tncVersion ? (
            <Link
              href={`/forms/${form.id}/terms`}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Terms accepted ({form.tncVersion.version})
            </Link>
          ) : null}
        </div>
      </section>

      {/* --- who has signed already --------------------------------------- */}
      {alreadySigned.length > 0 ? (
        <section className="mb-5 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            Signed so far ({alreadySigned.length})
          </h2>
          <ul className="space-y-2 text-sm">
            {alreadySigned.map((signed) => (
              <li key={signed.id} className="flex items-center gap-3">
                {signed.signatureAsset ? (
                  // Plain <img>, never next/image: the optimiser would cache a
                  // signature on a CDN outside India (brief §3).
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/signatures/${signed.signatureAsset.id}`}
                    alt={`Signature for ${signed.flowStep.label}`}
                    className="h-8 w-24 shrink-0 object-contain"
                  />
                ) : null}
                <span className="text-gray-700">
                  <span className="tabular-nums text-gray-400">{signed.orderIndex}.</span>{' '}
                  {signed.flowStep.label}
                  <span className="text-gray-500">
                    {' — '}
                    {signed.signatureAsset?.signerName ?? signed.assignee?.name ?? 'signed'}
                    {signed.status === 'VALIDATED' ? ' (validated)' : null}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* --- sign, or explain why not ------------------------------------ */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        {check.allowed ? (
          <SignPanel
            formId={form.id}
            orderIndex={record.orderIndex}
            stepLabel={record.flowStep.label}
            isApplicantStep={isApplicantStep}
            requiresValidation={record.flowStep.action === 'VALIDATE_AND_SIGN'}
            applicantName={applicantName}
            isLastStep={advance.completed}
            nextLabel={
              advance.nextOrder === null
                ? null
                : (steps.find((s) => s.orderIndex === advance.nextOrder)?.label ?? null)
            }
          />
        ) : (
          <>
            <p className="text-sm text-gray-700">{DENIAL_MESSAGES[check.reason]}</p>
            {record.status === 'SIGNED' || record.status === 'VALIDATED' ? (
              <p className="mt-2 text-xs text-gray-500">
                This step was already completed
                {record.assignee ? ` by ${record.assignee.name}` : null}
                {record.actedAt
                  ? ` on ${new Intl.DateTimeFormat('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'Asia/Kolkata',
                    }).format(record.actedAt)}`
                  : null}
                .
              </p>
            ) : null}
            {record.status === 'RETURNED' && record.comment ? (
              <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-900">
                {record.comment}
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-100 pb-1">
      <dt className="text-gray-600">{label}</dt>
      <dd className="text-right font-medium text-gray-900">{value}</dd>
    </div>
  );
}
