import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { FormStatus, StepStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/rbac';
import { authoriseFormAccess } from '@/lib/documents/access';
import { formatPaise } from '@/lib/format/money';
// Aliased: @prisma/client already exports a FormStatus in this file.
import { canActOnStep, type FormStatus as FlowFormStatus } from '@/lib/flow/act';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'Booking status' };
export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<FormStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SUBMITTED: 'bg-blue-50 text-blue-700',
  IN_REVIEW: 'bg-amber-50 text-amber-800',
  RETURNED: 'bg-red-50 text-red-700',
  COMPLETED: 'bg-green-50 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

const STATUS_LABEL: Record<FormStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  IN_REVIEW: 'In review',
  RETURNED: 'Returned for changes',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/** How each step reads in the timeline. */
const STEP_PRESENTATION: Record<
  StepStatus,
  { label: string; dot: string; text: string }
> = {
  LOCKED: { label: 'Not yet open', dot: 'border-gray-300 bg-white', text: 'text-gray-400' },
  PENDING: { label: 'Waiting', dot: 'border-amber-500 bg-amber-400', text: 'text-amber-900' },
  SIGNED: { label: 'Signed', dot: 'border-green-600 bg-green-500', text: 'text-gray-900' },
  VALIDATED: {
    label: 'Validated and signed',
    dot: 'border-green-600 bg-green-500',
    text: 'text-gray-900',
  },
  RETURNED: { label: 'Returned', dot: 'border-red-600 bg-red-500', text: 'text-red-900' },
  SKIPPED: {
    label: 'Not applicable',
    dot: 'border-gray-200 bg-gray-100',
    text: 'text-gray-400',
  },
  REASSIGNED: {
    label: 'Reassigned',
    dot: 'border-gray-400 bg-gray-300',
    text: 'text-gray-600',
  },
};

function formatIst(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(d);
}

export default async function BookingStatusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  // 404 rather than 403 — a signatory must not learn that a booking exists.
  const access = await authoriseFormAccess(user, id);
  if (!access) notFound();

  const form = await prisma.bookingForm.findUniqueOrThrow({
    where: { id: access.bookingFormId },
    include: {
      project: { select: { name: true } },
      tncVersion: { select: { id: true, version: true, isApproved: true } },
      applicants: { select: { applicantType: true, fullName: true } },
      _count: { select: { documents: true } },
      flowInstance: {
        include: {
          stepRecords: {
            orderBy: { orderIndex: 'asc' },
            include: {
              flowStep: {
                select: {
                  label: true,
                  action: true,
                  roleId: true,
                  actsOnCreatorDevice: true,
                  role: { select: { label: true } },
                },
              },
              assignee: { select: { name: true } },
              witnessUser: { select: { name: true } },
              signatureAsset: { select: { id: true, signerName: true } },
            },
          },
        },
      },
    },
  });

  const primary = form.applicants.find((a) => a.applicantType === 'PRIMARY');
  const secondary = form.applicants.find((a) => a.applicantType === 'SECONDARY');
  const records = form.flowInstance?.stepRecords ?? [];
  const pending = records.find((r) => r.status === 'PENDING');
  const signedCount = records.filter(
    (r) => r.status === 'SIGNED' || r.status === 'VALIDATED',
  ).length;
  const applicableCount = records.filter((r) => r.status !== 'SKIPPED').length;

  // Which step, if any, this viewer can act on right now. Same function the
  // signing page and the queue use, so the three cannot disagree.
  const actor = {
    userId: user.id,
    roleId: user.roleId,
    isCreator: form.createdById === user.id,
  };
  const actionable = records.find(
    (record) =>
      canActOnStep(
        actor,
        {
          orderIndex: record.orderIndex,
          status: record.status,
          assigneeId: record.assigneeId,
          roleId: record.flowStep.roleId,
          action: record.flowStep.action,
          actsOnCreatorDevice: record.flowStep.actsOnCreatorDevice,
        },
        form.status as FlowFormStatus,
      ).allowed,
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title={form.bookingId ?? 'Booking Form (draft)'}
          description={primary?.fullName ?? 'No applicant name entered yet.'}
        />
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[form.status]}`}
        >
          {STATUS_LABEL[form.status]}
        </span>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {actionable ? (
          <Link
            href={`/forms/${form.id}/sign/${actionable.orderIndex}`}
            className="rounded-md bg-dac-navy-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-dac-navy-900"
          >
            {actionable.flowStep.actsOnCreatorDevice
              ? `Capture ${actionable.flowStep.label} signature`
              : actionable.flowStep.action === 'VALIDATE_AND_SIGN'
                ? 'Validate and sign'
                : 'Review and sign'}
          </Link>
        ) : null}
        {access.editable ? (
          <>
            <Link
              href={`/forms/${form.id}/edit`}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Edit the form
            </Link>
            <Link
              href={`/forms/${form.id}/review`}
              className="rounded-md bg-dac-navy-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-dac-navy-900"
            >
              {form.status === 'RETURNED' ? 'Review and resubmit' : 'Review and submit'}
            </Link>
          </>
        ) : null}
        <Link
          href={`/forms/${form.id}/documents`}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Documents ({form._count.documents})
        </Link>
        {form.tncVersion ? (
          <Link
            href={`/forms/${form.id}/terms`}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Terms accepted ({form.tncVersion.version})
          </Link>
        ) : null}
        <Link
          href="/forms"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          My forms
        </Link>
      </div>

      {form.status === 'RETURNED' ? (
        <p className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          This booking was returned for changes
          {form.returnToStepOrder ? ` at step ${form.returnToStepOrder}` : null}. Make the
          changes, then resubmit — the flow resumes from the step that returned it, not from
          the beginning.
        </p>
      ) : null}

      {/* --- Facts -------------------------------------------------------- */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
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
          <Row label="Co / Second Applicant" value={secondary?.fullName ?? 'None'} />
          <Row label="Lead ID" value={form.leadId ?? '—'} />
          <Row
            label="Sale Price"
            value={form.salePricePaise ? formatPaise(form.salePricePaise) : '—'}
          />
          <Row
            label="Booking Advance"
            value={form.bookingAdvancePaise ? formatPaise(form.bookingAdvancePaise) : '—'}
          />
          <Row
            label="Submitted"
            value={form.submittedAt ? formatIst(form.submittedAt) : 'Not yet'}
          />
          <Row
            label="Terms accepted"
            value={form.tncAcceptedAt ? formatIst(form.tncAcceptedAt) : 'Not yet'}
          />
        </dl>
      </section>

      {/* --- The signature pipeline --------------------------------------- */}
      <section className="rounded-lg border border-gray-200 bg-white">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Signature flow</h2>
          {records.length > 0 ? (
            <span className="text-xs text-gray-500">
              {signedCount} of {applicableCount} signed
              {pending ? ` · waiting on ${pending.flowStep.label}` : null}
            </span>
          ) : null}
        </header>

        {records.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-600">
            The signature flow starts when this booking is submitted. All nine steps are created
            at that point, and the second-applicant step is skipped automatically when there is
            only one applicant.
          </p>
        ) : (
          <ol className="divide-y divide-gray-100">
            {records.map((record) => {
              const presentation = STEP_PRESENTATION[record.status];
              const isApplicantStep = record.flowStep.actsOnCreatorDevice;
              const isActionable = actionable?.id === record.id;

              return (
                <li key={record.id} className="flex gap-3 px-4 py-3">
                  <div className="flex flex-col items-center pt-1">
                    <span
                      aria-hidden
                      className={`h-3 w-3 shrink-0 rounded-full border-2 ${presentation.dot}`}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${presentation.text}`}>
                      <span className="tabular-nums text-gray-400">{record.orderIndex}.</span>{' '}
                      {record.flowStep.label}
                      {record.flowStep.action === 'VALIDATE_AND_SIGN' ? (
                        <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                          Validate + sign
                        </span>
                      ) : null}
                    </p>

                    <p className="mt-0.5 text-xs text-gray-500">
                      {presentation.label}
                      {record.actedAt ? ` · ${formatIst(record.actedAt)}` : null}
                      {record.signatureAsset?.signerName
                        ? ` · ${record.signatureAsset.signerName}`
                        : record.assignee
                          ? ` · ${record.assignee.name}`
                          : null}
                      {!record.assignee && record.status === 'PENDING'
                        ? ` · any ${record.flowStep.role.label}`
                        : null}
                      {isApplicantStep && record.witnessUser
                        ? ` · witnessed by ${record.witnessUser.name}`
                        : null}
                    </p>

                    {record.comment ? (
                      <p className="mt-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-900">
                        {record.comment}
                      </p>
                    ) : null}
                  </div>

                  {record.signatureAsset ? (
                    /*
                      Plain <img>, never next/image: the optimiser would fetch
                      and cache a signature on a CDN outside India (brief §3).
                    */
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/api/signatures/${record.signatureAsset.id}`}
                      alt={`Signature for ${record.flowStep.label}`}
                      className="h-8 w-24 shrink-0 self-center object-contain"
                    />
                  ) : null}

                  {isActionable ? (
                    <Link
                      href={`/forms/${form.id}/sign/${record.orderIndex}`}
                      className="shrink-0 self-center rounded-md bg-dac-navy-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-dac-navy-900"
                    >
                      {record.flowStep.actsOnCreatorDevice ? 'Capture' : 'Sign'}
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ol>
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
