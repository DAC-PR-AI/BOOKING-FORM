'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/rbac';
import {
  returnStep,
  signStep,
  type ReturnResult,
  type SignInput,
  type SignResult,
} from '@/lib/flow/sign';

/**
 * Server Action wrappers for signing and returning a step.
 *
 * Authorisation of the *step* is not done here — it depends on the step's role,
 * the form's status and who created it, so it lives in `canActOnStep` and is
 * applied by `@/lib/flow/sign`. All this does is establish who is asking, and
 * revalidate afterwards.
 *
 * `requireUser` rather than `requireRole`: every role in the pipeline reaches
 * this, including the sales executive capturing an applicant's signature, and
 * narrowing it here would duplicate the real rule in a second place where it
 * could drift.
 */

export async function signCurrentStep(input: SignInput): Promise<SignResult> {
  const user = await requireUser();
  const result = await signStep(user, input);

  if (result.ok) {
    revalidatePath(`/forms/${input.formId}`);
    revalidatePath('/forms');
    revalidatePath('/signatory/queue');
    revalidatePath('/coordinator/queue');
  }

  return result;
}

export async function returnCurrentStep(input: {
  formId: string;
  orderIndex: number;
  comment: string;
}): Promise<ReturnResult> {
  const user = await requireUser();
  const result = await returnStep(user, input);

  if (result.ok) {
    revalidatePath(`/forms/${input.formId}`);
    revalidatePath('/forms');
    revalidatePath('/signatory/queue');
    revalidatePath('/coordinator/queue');
  }

  return result;
}
