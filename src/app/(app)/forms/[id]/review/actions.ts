'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/rbac';
import { performSubmit, type SubmitResult } from '@/lib/forms/submit';

const submitSchema = z.object({
  formId: z.string().uuid(),
  tncAccepted: z.boolean(),
});

/**
 * Server Action wrapper for submitting a booking form.
 *
 * Authorisation and input validation happen here. The work — the gate, the
 * Booking ID, the transaction and the flow — lives in `@/lib/forms/submit`,
 * which takes the acting user as a parameter so it can be verified end to end
 * without a browser session.
 */
export async function submitBookingForm(
  formId: string,
  input: { tncAccepted: boolean },
): Promise<SubmitResult> {
  const user = await requireRole('SALES_EXECUTIVE', 'ADMIN');

  const parsed = submitSchema.safeParse({
    formId,
    tncAccepted: input?.tncAccepted,
  });
  if (!parsed.success) {
    return { ok: false, error: 'Invalid submission request.' };
  }

  const result = await performSubmit(user, parsed.data.formId, {
    tncAccepted: parsed.data.tncAccepted,
  });

  if (result.ok) {
    revalidatePath('/forms');
    revalidatePath(`/forms/${parsed.data.formId}`);
  }

  return result;
}
