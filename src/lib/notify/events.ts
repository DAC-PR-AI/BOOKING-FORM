/**
 * What a notification says.
 *
 * Separated from who receives it (`dispatch.ts`) and from how it is delivered,
 * because the wording is the part worth testing: these lines are the only
 * thing a signatory sees before deciding whether to open a booking, and a
 * notification that does not say what is being asked of them is noise they
 * will learn to ignore.
 *
 * Pure. No database, no email, no `server-only`.
 */

export type FlowEvent =
  | {
      kind: 'step-opened';
      bookingId: string;
      formId: string;
      stepLabel: string;
      /** True for the Co-ordinator's VALIDATE_AND_SIGN step. */
      requiresValidation: boolean;
      applicantName: string | null;
      raisedBy: string;
    }
  | {
      kind: 'applicant-capture';
      bookingId: string;
      formId: string;
      stepLabel: string;
      applicantName: string | null;
    }
  | {
      kind: 'returned';
      bookingId: string;
      formId: string;
      stepLabel: string;
      returnedBy: string;
      comment: string;
    }
  | {
      kind: 'completed';
      bookingId: string;
      formId: string;
      applicantName: string | null;
    }
  | {
      kind: 'submitted';
      bookingId: string;
      formId: string;
      applicantName: string | null;
      submittedBy: string;
    };

export type NotificationContent = {
  title: string;
  body: string;
  link: string;
};

/** "for RAVI KUMAR" when the name is known, nothing when it is not. */
function forApplicant(name: string | null): string {
  return name ? ` for ${name}` : '';
}

export function renderNotification(event: FlowEvent): NotificationContent {
  switch (event.kind) {
    case 'step-opened':
      return {
        title: `${event.bookingId} is waiting on you`,
        body:
          `${event.stepLabel} — booking ${event.bookingId}${forApplicant(event.applicantName)}, ` +
          `raised by ${event.raisedBy}. ` +
          (event.requiresValidation
            ? 'Check the form and its documents against the booking, then validate and sign.'
            : 'Review it and sign, or send it back with a note.'),
        link: `/forms/${event.formId}`,
      };

    case 'applicant-capture':
      return {
        title: `${event.bookingId} needs an applicant signature`,
        body:
          `${event.stepLabel}${forApplicant(event.applicantName)} signs in person, on your ` +
          'device. Open the booking when you are with them.',
        link: `/forms/${event.formId}/sign`,
      };

    case 'returned':
      return {
        title: `${event.bookingId} was sent back for changes`,
        body:
          `${event.returnedBy} returned it at ${event.stepLabel}: “${event.comment}” ` +
          'Make the changes and resubmit — it resumes at that same step, and the signatures ' +
          'already collected are kept.',
        link: `/forms/${event.formId}/edit`,
      };

    case 'completed':
      return {
        title: `${event.bookingId} is complete`,
        body:
          `All signatures are in${forApplicant(event.applicantName)}. The signed PDF can now ` +
          'be downloaded from the booking.',
        link: `/forms/${event.formId}`,
      };

    case 'submitted':
      return {
        title: `${event.bookingId} has entered the signature flow`,
        body:
          `${event.submittedBy} submitted it${forApplicant(event.applicantName)}. ` +
          'It now moves through the nine signature steps.',
        link: `/forms/${event.formId}`,
      };
  }
}

/**
 * One line per notification for the daily email digest.
 *
 * Resend's free tier allows **100 emails a day**, not 3,000 a month as the
 * monthly figure suggests — that is the binding constraint, and one email per
 * signature would exhaust it at about eleven bookings. So email is a digest of
 * what is outstanding, and the in-app queue stays the system of record.
 */
export function digestLine(content: NotificationContent): string {
  return `${content.title} — ${content.body}`;
}

/** Subject for the digest. Says the count, so it is useful unopened. */
export function digestSubject(count: number): string {
  if (count === 1) return '1 booking is waiting on you';
  return `${count} bookings are waiting on you`;
}
