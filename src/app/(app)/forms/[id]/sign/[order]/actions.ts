'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/rbac';
import {
  returnStep,
  signStep,
  type ReturnResult,
  type SignInput,
  type SignResult,
} from '@/lib/flow/sign';

const signInputSchema = z.object({
  formId: z.string().uuid(),
  orderIndex: z.number().int().min(1).max(9),
  signatureDataUrl: z.string().trim().min(20).max(500_000),
  signerName: z.string().max(120).optional(),
  validated: z.boolean().optional(),
});

const returnInputSchema = z.object({
  formId: z.string().uuid(),
  orderIndex: z.number().int().min(1).max(9),
  comment: z.string().max(1000),
});

/**
 * Server Action wrappers for signing and returning a step.
 *
 * Authorisation of the *step* is not done here — it depends on the step's role,
 * the form's status and who created it, so it lives in `canActOnStep` and is
 * applied by `@/lib/flow/sign`. All this does is establish who is asking,
 * validate the payload boundary, and revalidate afterwards.
 */

export async function signCurrentStep(rawInput: SignInput): Promise<SignResult> {
  const user = await requireUser();

  const parsed = signInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid signature payload.' };
  }
  const input = parsed.data;

  const result = await signStep(user, {
    formId: input.formId,
    orderIndex: input.orderIndex,
    signatureDataUrl: input.signatureDataUrl,
    ...(input.signerName !== undefined ? { signerName: input.signerName } : {}),
    ...(input.validated !== undefined ? { validated: input.validated } : {}),
  });

  if (result.ok) {
    revalidatePath(`/forms/${input.formId}`);
    revalidatePath('/forms');
    revalidatePath('/signatory/queue');
    revalidatePath('/coordinator/queue');
  }

  return result;
}

export async function returnCurrentStep(rawInput: {
  formId: string;
  orderIndex: number;
  comment: string;
}): Promise<ReturnResult> {
  const user = await requireUser();

  const parsed = returnInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid return request.' };
  }
  const input = parsed.data;

  const result = await returnStep(user, input);

  if (result.ok) {
    revalidatePath(`/forms/${input.formId}`);
    revalidatePath('/forms');
    revalidatePath('/signatory/queue');
    revalidatePath('/coordinator/queue');
  }

  return result;
}
