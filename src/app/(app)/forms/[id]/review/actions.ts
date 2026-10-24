'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/rbac';
import { performSubmit, type SubmitResult } from '@/lib/forms/submit';

/**
 * Server Action wrapper for submitting a booking form.
 *
 * Authorisation only. The work — the gate, the Booking ID, the transaction and
 * the flow — lives in `@/lib/forms/submit`, which takes the acting user as a
 * parameter so it can be verified end to end without a browser session.
 */
export async function submitBookingForm(
  formId: string,
  input: { tncAccepted: boolean },
): Promise<SubmitResult> {
  const user = await requireRole('SALES_EXECUTIVE', 'ADMIN');
  const result = await performSubmit(user, formId, input);

  if (result.ok) {
    revalidatePath('/forms');
    revalidatePath(`/forms/${formId}`);
  }

  return result;
}
