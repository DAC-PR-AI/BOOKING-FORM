import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { FormStatus, StepStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/rbac';
import { authoriseFormAccess } from '@/lib/documents/access';
import { formatPaise } from '@/lib/format/money';
import { canActOnStep, type FormStatus as FlowFormStatus } from '@/lib/flow/act';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'Booking status' };
export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<FormStatus, string> = {
  DRAFT: 'border-slate-200 bg-slate-100 text-slate-700',
  SUBMITTED: 'border-blue-200 bg-blue-50 text-blue-700',
  IN_REVIEW: 'border-amber-200 bg-amber-50 text-amber-800',
  RETURNED: 'border-red-200 bg-red-50 text-red-700',
  COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  CANCELLED: 'border-slate-200 bg-slate-100 text-slate-500',
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
  { label: string; dot: string; text: string; rowBg: string }
> = {
  LOCKED: {
    label: 'Not yet open',
    dot: 'border-slate-300 bg-white',
    text: 'text-slate-400',
    rowBg: 'bg-white',
  },
  PENDING: {
    label: 'Waiting for signature',
    dot: 'border-amber-500 bg-amber-400 ring-4 ring-amber-400/20',
    text: 'text-amber-950 font-semibold',
    rowBg: 'bg-amber-50/40',
  },
  SIGNED: {
    label: 'Signed',
    dot: 'border-emerald-600 bg-emerald-500',
    text: 'text-slate-900 font-semibold',
    rowBg: 'bg-white',
  },
  VALIDATED: {
    label: 'Validated and signed',
    dot: 'border-emerald-600 bg-emerald-500',
    text: 'text-slate-900 font-semibold',
    rowBg: 'bg-white',
  },
  RETURNED: {
    label: 'Returned',
    dot: 'border-red-600 bg-red-500 ring-4 ring-red-500/20',
    text: 'text-red-900 font-semibold',
    rowBg: 'bg-red-50/30',
  },
  SKIPPED: {
    label: 'Not applicable',
    dot: 'border-slate-200 bg-slate-100',
    text: 'text-slate-400',
    rowBg: 'bg-slate-50/40',
  },
  REASSIGNED: {
    label: 'Reassigned',
    dot: 'border-slate-400 bg-slate-300',
    text: 'text-slate-600',
    rowBg: 'bg-white',
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
  const progressPercent =
    applicableCount > 0 ? Math.min(100, Math.round((signedCount / applicableCount) * 100)) : 0;

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
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title={form.bookingId ?? 'Booking Form (draft)'}
          description={primary?.fullName ?? 'No applicant name entered yet.'}
        />
        <span
          className={`rounded-full border px-3.5 py-1 text-xs font-bold ${STATUS_STYLE[form.status]}`}
        >
          {STATUS_LABEL[form.status]}
        </span>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {actionable ? (
          <Link
            href={`/forms/${form.id}/sign/${actionable.orderIndex}`}
            className="rounded-xl bg-gradient-to-r from-dac-navy-800 to-dac-navy-700 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:from-dac-navy-900 hover:to-dac-navy-800"
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
              className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
            >
              Edit the form
            </Link>
            <Link
              href={`/forms/${form.id}/review`}
              className="rounded-xl bg-dac-navy-700 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-dac-navy-900"
            >
              {form.status === 'RETURNED' ? 'Review and resubmit' : 'Review and submit'}
            </Link>
          </>
        ) : null}
        {form.status === 'COMPLETED' ? (
          <a
            href={`/forms/${form.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800"
          >
            Download the signed PDF
          </a>
        ) : null}
        <Link
          href={`/forms/${form.id}/documents`}
          className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
        >
          Documents ({form._count.documents})
        </Link>
        {form.tncVersion ? (
          <Link
            href={`/forms/${form.id}/terms`}
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
          >
            Terms accepted ({form.tncVersion.version})
          </Link>
        ) : null}
        <Link
          href="/forms"
          className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
        >
          My forms
        </Link>
      </div>

      {form.status === 'COMPLETED' ? (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/90 px-5 py-4 text-sm text-emerald-950 shadow-2xs">
          All nine signatures are collected. The PDF is produced once and kept unchanged, with
          a SHA-256 recorded against it — downloading it again always returns the same document.
        </div>
      ) : null}

      {form.status === 'RETURNED' ? (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50/90 px-5 py-4 text-sm text-red-900 shadow-2xs">
          This booking was returned for changes
          {form.returnToStepOrder ? ` at step ${form.returnToStepOrder}` : null}. Make the
          changes, then resubmit — the flow resumes from the step that returned it, not from
          the beginning.
        </div>
      ) : null}

      {/* --- Facts -------------------------------------------------------- */}
      <section className="mb-6 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <h2 className="mb-3.5 text-xs font-bold tracking-wider text-dac-navy-900 uppercase">
          Booking Details
        </h2>
        <dl className="grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
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
      <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
        <header className="border-b border-slate-200 bg-slate-50/70 px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">Signature flow</h2>
            {records.length > 0 ? (
              <span className="text-xs font-semibold text-slate-600">
                {signedCount} of {applicableCount} signed
                {pending ? ` · waiting on ${pending.flowStep.label}` : null}
              </span>
            ) : null}
          </div>

          {records.length > 0 ? (
            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          ) : null}
        </header>

        {records.length === 0 ? (
          <p className="px-5 py-5 text-sm text-slate-600">
            The signature flow starts when this booking is submitted. All nine steps are created
            at that point, and the second-applicant step is skipped automatically when there is
            only one applicant.
          </p>
        ) : (
          <ol className="divide-y divide-slate-100">
            {records.map((record) => {
              const presentation = STEP_PRESENTATION[record.status];
              const isApplicantStep = record.flowStep.actsOnCreatorDevice;
              const isActionable = actionable?.id === record.id;

              return (
                <li
                  key={record.id}
                  className={`flex gap-3.5 px-5 py-4 transition ${presentation.rowBg}`}
                >
                  <div className="flex flex-col items-center pt-1">
                    <span
                      aria-hidden
                      className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${presentation.dot}`}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${presentation.text}`}>
                      <span className="tabular-nums text-slate-400">{record.orderIndex}.</span>{' '}
                      {record.flowStep.label}
                      {record.flowStep.action === 'VALIDATE_AND_SIGN' ? (
                        <span className="ml-2 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                          Validate + sign
                        </span>
                      ) : null}
                    </p>

                    <p className="mt-0.5 text-xs text-slate-500">
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
                      <p className="mt-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-900">
                        {record.comment}
                      </p>
                    ) : null}
                  </div>

                  {record.signatureAsset ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/api/signatures/${record.signatureAsset.id}`}
                      alt={`Signature for ${record.flowStep.label}`}
                      className="h-9 w-28 shrink-0 self-center rounded border border-slate-200 bg-white p-1 object-contain"
                    />
                  ) : null}

                  {isActionable ? (
                    <Link
                      href={`/forms/${form.id}/sign/${record.orderIndex}`}
                      className="shrink-0 self-center rounded-xl bg-dac-navy-700 px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs transition hover:bg-dac-navy-900"
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
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
