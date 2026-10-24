import 'server-only';
import type { Prisma } from '@prisma/client';
import {
  firstApplicableOrder,
  planFlow,
  planResume,
  resumeWrites,
  type FlowContext,
  type FlowStepConfig,
} from './plan';

/**
 * Database side of the signature pipeline.
 *
 * The decisions live in `plan.ts`, which is pure and tested. This file only
 * reads the configuration, applies a plan, and writes it — so that what gets
 * written is auditable against something that can be reasoned about on its own.
 *
 * Every function here takes a transaction client. Starting a flow is part of
 * submitting, and a form that is SUBMITTED with no step records, or has step
 * records but was never marked submitted, is a form stuck in a state no screen
 * knows how to show.
 */

export type FlowStepRow = {
  id: string;
  orderIndex: number;
  label: string;
  roleId: string;
  action: 'SIGN' | 'VALIDATE_AND_SIGN';
  skipIfNoSecondApplicant: boolean;
  actsOnCreatorDevice: boolean;
  pdfSignatureSlot: string;
};

function toConfig(rows: FlowStepRow[]): FlowStepConfig[] {
  return rows.map((row) => ({
    id: row.id,
    orderIndex: row.orderIndex,
    label: row.label,
    roleId: row.roleId,
    action: row.action,
    skipIfNoSecondApplicant: row.skipIfNoSecondApplicant,
    actsOnCreatorDevice: row.actsOnCreatorDevice,
    pdfSignatureSlot: row.pdfSignatureSlot,
  }));
}

/**
 * Loads the pipeline a form will run, from its form template.
 *
 * Read per form rather than cached globally and deliberately so: a form in
 * flight keeps the pipeline it started with (it has its own
 * `form_step_records`), while a new form picks up whatever `flow_steps` says
 * today. That is what lets the flow be edited without a deploy and without
 * disturbing bookings already moving.
 */
export async function loadFlowSteps(
  tx: Prisma.TransactionClient,
  formTemplateId: string,
): Promise<{ flowTemplateId: string; steps: FlowStepConfig[] }> {
  const template = await tx.formTemplate.findUniqueOrThrow({
    where: { id: formTemplateId },
    select: { flowTemplateId: true },
  });

  const steps = await tx.flowStep.findMany({
    where: { flowTemplateId: template.flowTemplateId },
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

  if (steps.length === 0) {
    throw new Error(
      'The flow template has no steps. Run `npm run db:seed`, or add rows to flow_steps.',
    );
  }

  return { flowTemplateId: template.flowTemplateId, steps: toConfig(steps) };
}

/**
 * Builds the flow instance for a form entering review for the first time.
 * Returns the step order the form now waits on.
 */
export async function startFlow(
  tx: Prisma.TransactionClient,
  form: { id: string; formTemplateId: string; createdById: string },
  context: Omit<FlowContext, 'creatorId'>,
): Promise<number | null> {
  const { flowTemplateId, steps } = await loadFlowSteps(tx, form.formTemplateId);
  const fullContext: FlowContext = { ...context, creatorId: form.createdById };

  const planned = planFlow(steps, fullContext);

  await tx.formFlowInstance.create({
    data: {
      bookingFormId: form.id,
      flowTemplateId,
      stepRecords: {
        create: planned.map((entry) => ({
          flowStepId: entry.step.id,
          orderIndex: entry.step.orderIndex,
          status: entry.status,
          assigneeId: entry.assigneeId,
        })),
      },
    },
  });

  return firstApplicableOrder(steps, fullContext);
}

export type ResumeResult = {
  resumeAtOrder: number | null;
  /** True when a newly added second applicant pulled the resume point back. */
  rewoundForNewApplicant: boolean;
};

/**
 * Reopens the flow on a returned form that has been resubmitted.
 *
 * Signatures already collected are left untouched — see `resumeWrites`, which
 * is where that guarantee lives.
 */
export async function resumeFlow(
  tx: Prisma.TransactionClient,
  form: {
    id: string;
    formTemplateId: string;
    createdById: string;
    returnToStepOrder: number | null;
  },
  context: Omit<FlowContext, 'creatorId'>,
): Promise<ResumeResult> {
  const { steps } = await loadFlowSteps(tx, form.formTemplateId);
  const fullContext: FlowContext = { ...context, creatorId: form.createdById };

  const instance = await tx.formFlowInstance.findUnique({
    where: { bookingFormId: form.id },
    select: {
      id: true,
      stepRecords: { select: { id: true, orderIndex: true, status: true } },
    },
  });

  if (!instance) {
    // A RETURNED form without a flow instance should be impossible, but
    // recovering is better than a 500 on the creator's resubmit.
    const resumeAtOrder = await startFlow(tx, form, context);
    return { resumeAtOrder, rewoundForNewApplicant: false };
  }

  const existing = instance.stepRecords.map((r) => ({
    orderIndex: r.orderIndex,
    status: r.status,
  }));

  const plan = planResume(steps, fullContext, existing, form.returnToStepOrder);
  const writes = resumeWrites(plan, existing);

  const idByOrder = new Map(instance.stepRecords.map((r) => [r.orderIndex, r.id] as const));

  for (const write of writes) {
    const id = idByOrder.get(write.orderIndex);
    if (!id) continue;

    await tx.formStepRecord.update({
      where: { id },
      data: {
        status: write.status,
        assigneeId: write.assigneeId,
        // Reopening a step clears the previous round's comment and timestamp,
        // so a stale "returned because X" does not hang off a live step. The
        // audit log keeps the history.
        ...(write.status === 'PENDING' ? { comment: null, actedAt: null } : {}),
      },
    });
  }

  return { resumeAtOrder: plan.resumeAtOrder, rewoundForNewApplicant: plan.rewoundForNewApplicant };
}
