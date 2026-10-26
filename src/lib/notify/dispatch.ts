import 'server-only';
import { prisma } from '@/lib/db';
import { renderNotification, type FlowEvent } from './events';

/**
 * Who gets told, and when.
 *
 * Always called **after** the surrounding transaction has committed, never
 * inside it. A notification is not part of the legal record: a booking whose
 * signature committed but whose notification failed is a booking that is
 * correctly signed and slightly less visible, which is recoverable. The
 * reverse — rolling back a signature because an email queue hiccupped — is
 * not. Every function here swallows its own errors and logs them.
 *
 * Delivery is in-app first. The in-app queue is the system of record and
 * email is a best-effort digest on top of it, because Resend's free tier
 * allows 100 messages a **day** and one per signature would run out at about
 * eleven bookings.
 */

async function create(
  userIds: string[],
  event: FlowEvent,
): Promise<void> {
  if (userIds.length === 0) return;

  const content = renderNotification(event);
  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      title: content.title,
      body: content.body,
      link: content.link,
    })),
  });
}

/** Active users holding a role — the pool a staff step is offered to. */
async function holdersOfRole(organizationId: string, roleId: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { organizationId, roleId, isActive: true },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

type FormFacts = {
  id: string;
  bookingId: string;
  applicantName: string | null;
  createdById: string;
  createdByName: string;
  organizationId: string;
};

async function formFacts(formId: string): Promise<FormFacts | null> {
  const form = await prisma.bookingForm.findUnique({
    where: { id: formId },
    select: {
      id: true,
      bookingId: true,
      organizationId: true,
      createdById: true,
      createdBy: { select: { name: true } },
      applicants: {
        where: { applicantType: 'PRIMARY' },
        select: { fullName: true },
      },
    },
  });
  if (!form) return null;

  return {
    id: form.id,
    bookingId: form.bookingId ?? 'This booking',
    applicantName: form.applicants[0]?.fullName ?? null,
    createdById: form.createdById,
    createdByName: form.createdBy.name,
    organizationId: form.organizationId,
  };
}

/**
 * A step has just opened.
 *
 * Staff steps go to every active holder of the role, because that is exactly
 * who may act on them — the step is unassigned until someone claims it, so
 * telling one named person would be telling the wrong person half the time.
 * Applicant steps go to the form's creator, who performs the capture.
 */
export async function notifyStepOpened(formId: string, orderIndex: number): Promise<void> {
  try {
    const facts = await formFacts(formId);
    if (!facts) return;

    const record = await prisma.formStepRecord.findFirst({
      where: { orderIndex, flowInstance: { bookingFormId: formId } },
      select: {
        assigneeId: true,
        flowStep: {
          select: { label: true, roleId: true, action: true, actsOnCreatorDevice: true },
        },
      },
    });
    if (!record) return;

    if (record.flowStep.actsOnCreatorDevice) {
      await create([record.assigneeId ?? facts.createdById], {
        kind: 'applicant-capture',
        bookingId: facts.bookingId,
        formId: facts.id,
        stepLabel: record.flowStep.label,
        applicantName: facts.applicantName,
      });
      return;
    }

    const recipients = record.assigneeId
      ? [record.assigneeId]
      : await holdersOfRole(facts.organizationId, record.flowStep.roleId);

    await create(recipients, {
      kind: 'step-opened',
      bookingId: facts.bookingId,
      formId: facts.id,
      stepLabel: record.flowStep.label,
      requiresValidation: record.flowStep.action === 'VALIDATE_AND_SIGN',
      applicantName: facts.applicantName,
      raisedBy: facts.createdByName,
    });
  } catch (error) {
    console.error('[notify] could not announce an opened step', { formId, orderIndex, error });
  }
}

/** A booking has been sent back. Only the creator can act on that. */
export async function notifyReturned(
  formId: string,
  input: { stepLabel: string; returnedBy: string; comment: string },
): Promise<void> {
  try {
    const facts = await formFacts(formId);
    if (!facts) return;

    await create([facts.createdById], {
      kind: 'returned',
      bookingId: facts.bookingId,
      formId: facts.id,
      stepLabel: input.stepLabel,
      returnedBy: input.returnedBy,
      comment: input.comment,
    });
  } catch (error) {
    console.error('[notify] could not announce a return', { formId, error });
  }
}

/** Every signature is in. The creator is the one waiting to hear it. */
export async function notifyCompleted(formId: string): Promise<void> {
  try {
    const facts = await formFacts(formId);
    if (!facts) return;

    await create([facts.createdById], {
      kind: 'completed',
      bookingId: facts.bookingId,
      formId: facts.id,
      applicantName: facts.applicantName,
    });
  } catch (error) {
    console.error('[notify] could not announce a completion', { formId, error });
  }
}

/** Unread count for the header bell. */
export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
