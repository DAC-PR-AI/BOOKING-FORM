import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/auth/session';
import { auditWithin } from '@/lib/audit/log';
import { storage } from '@/lib/storage';
import { buildSignatureKey } from '@/lib/storage/keys';
import {
  normaliseSignerName,
  parseSignatureDataUrl,
  readPngDimensions,
  SIGNATURE_FAILURE_MESSAGES,
} from '@/lib/signature/png';
import {
  canActOnStep,
  completedStatusFor,
  planAdvance,
  planReturn,
  validateReturnComment,
  DENIAL_MESSAGES,
  type Actor,
  type FormStatus,
} from './act';
import { loadFlowSteps } from './engine';
import { notifyCompleted, notifyReturned, notifyStepOpened } from '@/lib/notify/dispatch';

/**
 * Signing and returning a step.
 *
 * The decisions are all in `act.ts`, which is pure and tested; this file loads,
 * checks and writes. It takes the acting user as a parameter rather than
 * reading the session, so the whole path — including the race guard and the
 * advance to the next step — can be exercised by `scripts/verify-sign.ts`
 * without a browser.
 *
 * Order of operations matters. The signature image is written to storage
 * **before** the database transaction, because a storage write cannot join a
 * Postgres transaction. If the transaction then fails, an unreferenced object
 * is left behind, which is recoverable and invisible; the reverse order would
 * leave a step marked SIGNED pointing at bytes that were never stored — a
 * booking that looks approved and cannot be printed.
 */

export type SignInput = {
  formId: string;
  orderIndex: number;
  /** `data:image/png;base64,…` from the signature pad. */
  signatureDataUrl: string;
  /** Applicant steps only: the name the applicant typed, in lieu of a login. */
  signerName?: string;
  /** VALIDATE_AND_SIGN steps only: the Co-ordinator's explicit tick. */
  validated?: boolean;
};

export type SignResult =
  | {
      ok: true;
      completed: boolean;
      nextOrder: number | null;
      nextLabel: string | null;
      bookingId: string | null;
    }
  | { ok: false; error: string };

export type ReturnInput = { formId: string; orderIndex: number; comment: string };

export type ReturnResult =
  | { ok: true; returnedToCreator: string; bookingId: string | null }
  | { ok: false; error: string };

/** Request metadata recorded against a signature, for the audit trail. */
async function requestMeta(): Promise<{ ip: string | null; device: string | null }> {
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    return {
      ip: forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null,
      device: h.get('user-agent')?.slice(0, 400) ?? null,
    };
  } catch {
    // Outside a request context, e.g. the verification script.
    return { ip: null, device: null };
  }
}

async function loadStep(formId: string, orderIndex: number) {
  return prisma.formStepRecord.findFirst({
    where: { orderIndex, flowInstance: { bookingFormId: formId } },
    include: {
      flowStep: { select: { id: true, label: true, roleId: true, action: true, actsOnCreatorDevice: true } },
      flowInstance: {
        select: {
          id: true,
          bookingForm: {
            select: {
              id: true,
              bookingId: true,
              status: true,
              organizationId: true,
              formTemplateId: true,
              createdById: true,
              createdBy: { select: { name: true } },
              applicants: { select: { applicantType: true, fullName: true } },
            },
          },
        },
      },
    },
  });
}

export async function signStep(user: SessionUser, input: SignInput): Promise<SignResult> {
  const record = await loadStep(input.formId, input.orderIndex);
  if (!record) return { ok: false, error: 'Step not found.' };

  const form = record.flowInstance.bookingForm;
  if (form.organizationId !== user.organizationId) {
    return { ok: false, error: 'Step not found.' };
  }

  const actor: Actor = {
    userId: user.id,
    roleId: user.roleId,
    isCreator: form.createdById === user.id,
  };

  const check = canActOnStep(
    actor,
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
  if (!check.allowed) return { ok: false, error: DENIAL_MESSAGES[check.reason] };

  // The Co-ordinator's step asserts the form was checked. Signing without
  // ticking it would make the assertion meaningless.
  if (record.flowStep.action === 'VALIDATE_AND_SIGN' && input.validated !== true) {
    return {
      ok: false,
      error: 'Tick "I have validated this form" before signing.',
    };
  }

  // Applicants have no login, so the typed name is the only record of who
  // actually signed. The creator is stored separately, as witness.
  let signerName: string | null = null;
  if (record.flowStep.actsOnCreatorDevice) {
    signerName = normaliseSignerName(input.signerName ?? '');
    if (signerName.length < 2) {
      return { ok: false, error: 'Enter the applicant’s name as it appears on the form.' };
    }
  }

  const parsed = parseSignatureDataUrl(input.signatureDataUrl);
  if (!parsed.ok) return { ok: false, error: SIGNATURE_FAILURE_MESSAGES[parsed.reason] };

  const { steps } = await prisma.$transaction((tx) => loadFlowSteps(tx, form.formTemplateId));
  const hasSecondApplicant = form.applicants.some((a) => a.applicantType === 'SECONDARY');
  const advance = planAdvance(
    steps,
    { hasSecondApplicant, creatorId: form.createdById },
    record.orderIndex,
  );

  const storageKey = buildSignatureKey({ bookingFormId: form.id, unique: randomUUID() });
  const dimensions = readPngDimensions(parsed.bytes);
  const sha256 = createHash('sha256').update(parsed.bytes).digest('hex');
  const { ip, device } = await requestMeta();

  const driver = storage();
  const upload = await driver.createSignedUpload(storageKey, 'image/png', 300, '');
  // Written server-side: the image is already in hand, and a round trip
  // through the browser would add a failure point to the one action in this
  // system that must not half-happen.
  await writeSignature(storageKey, parsed.bytes, upload);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction. Two holders of the same role opening
      // the step at once would otherwise both sign it.
      const current = await tx.formStepRecord.findUniqueOrThrow({
        where: { id: record.id },
        select: { status: true },
      });
      if (current.status !== 'PENDING') return { raced: true as const };

      const asset = await tx.signatureAsset.create({
        data: {
          storageKey,
          mimeType: 'image/png',
          widthPx: dimensions?.width ?? null,
          heightPx: dimensions?.height ?? null,
          sha256,
          // Null for an applicant: they have no account to point at.
          signedByUserId: signerName ? null : user.id,
          signerName,
        },
      });

      await tx.formStepRecord.update({
        where: { id: record.id },
        data: {
          status: completedStatusFor(record.flowStep.action),
          // Claim the step, so the queue stops offering it and the status page
          // can say who signed.
          assigneeId: user.id,
          witnessUserId: signerName ? user.id : null,
          signatureAssetId: asset.id,
          validated: record.flowStep.action === 'VALIDATE_AND_SIGN',
          comment: null,
          actedAt: new Date(),
          ip,
          device,
        },
      });

      if (advance.nextOrder !== null) {
        const next = await tx.formStepRecord.findFirst({
          where: { formFlowInstanceId: record.flowInstance.id, orderIndex: advance.nextOrder },
          select: { id: true },
        });
        if (next) {
          await tx.formStepRecord.update({
            where: { id: next.id },
            data: { status: 'PENDING' },
          });
        }
      }

      await tx.bookingForm.update({
        where: { id: form.id },
        data: {
          status: advance.formStatus,
          currentStepOrder: advance.nextOrder,
          ...(advance.completed ? { completedAt: new Date() } : {}),
        },
      });

      // Inside the transaction: a signature whose audit entry did not commit
      // is not a signature we can stand behind.
      await auditWithin(tx, {
        organizationId: form.organizationId,
        userId: user.id,
        bookingFormId: form.id,
        action: record.flowStep.action === 'VALIDATE_AND_SIGN' ? 'VALIDATE' : 'SIGN',
        detail: signerName
          ? `Step ${record.orderIndex} (${record.flowStep.label}) signed in person by ${signerName}, witnessed by ${user.name}.`
          : `Step ${record.orderIndex} (${record.flowStep.label}) signed by ${user.name}.`,
      });

      return { raced: false as const };
    });

    if (result.raced) {
      await driver.remove(storageKey).catch(() => undefined);
      return { ok: false, error: DENIAL_MESSAGES['step-not-open'] };
    }
  } catch (error) {
    // The transaction rolled back, so nothing references the image.
    await driver.remove(storageKey).catch(() => undefined);
    throw error;
  }

  // After the commit, and best-effort: a signature that is safely recorded but
  // unannounced is recoverable; a signature rolled back because a notification
  // failed is not.
  if (advance.nextOrder !== null) {
    await notifyStepOpened(form.id, advance.nextOrder);
  } else {
    await notifyCompleted(form.id);
  }

  const nextLabel =
    advance.nextOrder === null
      ? null
      : (steps.find((s) => s.orderIndex === advance.nextOrder)?.label ?? null);

  return {
    ok: true,
    completed: advance.completed,
    nextOrder: advance.nextOrder,
    nextLabel,
    bookingId: form.bookingId,
  };
}

/**
 * Puts the signature bytes in storage.
 *
 * Goes through the driver's signed upload URL so there is one storage path for
 * both drivers, rather than a `if (local) write file else call Supabase` here.
 * For the local driver the grant is irrelevant (the key is already decided),
 * which is why an empty one is passed above.
 */
async function writeSignature(
  storageKey: string,
  bytes: Buffer,
  upload: { url: string; method: 'PUT'; headers: Record<string, string> },
): Promise<void> {
  if (upload.url.startsWith('/')) {
    // Local driver: write straight to disk rather than calling back into our
    // own HTTP route from inside a server action.
    const { writeLocalObject } = await import('@/lib/storage/local');
    await writeLocalObject(storageKey, bytes, 'image/png');
    return;
  }

  const response = await fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: new Uint8Array(bytes),
  });
  if (!response.ok) {
    throw new Error(`Could not store the signature: ${response.status}`);
  }
}

export async function returnStep(
  user: SessionUser,
  input: ReturnInput,
): Promise<ReturnResult> {
  const record = await loadStep(input.formId, input.orderIndex);
  if (!record) return { ok: false, error: 'Step not found.' };

  const form = record.flowInstance.bookingForm;
  if (form.organizationId !== user.organizationId) {
    return { ok: false, error: 'Step not found.' };
  }

  const actor: Actor = {
    userId: user.id,
    roleId: user.roleId,
    isCreator: form.createdById === user.id,
  };

  const check = canActOnStep(
    actor,
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
  if (!check.allowed) return { ok: false, error: DENIAL_MESSAGES[check.reason] };

  const comment = validateReturnComment(input.comment);
  if (!comment.ok) return { ok: false, error: comment.error };

  const plan = planReturn(record.orderIndex);
  const { ip, device } = await requestMeta();

  const raced = await prisma.$transaction(async (tx) => {
    const current = await tx.formStepRecord.findUniqueOrThrow({
      where: { id: record.id },
      select: { status: true },
    });
    if (current.status !== 'PENDING') return true;

    await tx.formStepRecord.update({
      where: { id: record.id },
      data: {
        status: 'RETURNED',
        assigneeId: user.id,
        comment: comment.comment,
        actedAt: new Date(),
        ip,
        device,
      },
    });

    await tx.bookingForm.update({
      where: { id: form.id },
      data: {
        status: plan.formStatus,
        // Resubmission resumes HERE, not at step 1.
        returnToStepOrder: plan.returnToOrder,
        currentStepOrder: null,
      },
    });

    await auditWithin(tx, {
      organizationId: form.organizationId,
      userId: user.id,
      bookingFormId: form.id,
      action: 'RETURN',
      detail: `Returned at step ${record.orderIndex} (${record.flowStep.label}) by ${user.name}: ${comment.comment}`,
    });

    return false;
  });

  if (raced) return { ok: false, error: DENIAL_MESSAGES['step-not-open'] };

  await notifyReturned(form.id, {
    stepLabel: record.flowStep.label,
    returnedBy: user.name,
    comment: comment.comment,
  });

  return {
    ok: true,
    returnedToCreator: form.createdBy.name,
    bookingId: form.bookingId,
  };
}
