import 'server-only';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { buildDigests } from './digest';
import { emailConfig, isDeliverable, sendEmail } from './email';

/**
 * The nightly email digest.
 *
 * Only **unread** notifications are worth emailing: if somebody has already
 * seen it in the portal, a reminder is noise. And only ones not emailed
 * before, so a notification that stays unread for a week produces one email,
 * not seven.
 *
 * The daily budget is counted from what has actually been sent today rather
 * than assumed, because a manual run and the cron can both fire on the same
 * day and the free tier's 100 messages are shared between them.
 */

export type DigestRun = {
  ok: boolean;
  sent: number;
  failed: number;
  deferred: number;
  skipped: number;
  /** Null when email is not configured — not an error. */
  reason?: string;
};

function startOfTodayIst(): Date {
  // IST is UTC+5:30 with no daylight saving, so the offset is a constant.
  const offsetMs = 5.5 * 60 * 60 * 1000;
  const nowIst = new Date(Date.now() + offsetMs);
  const midnightIst = Date.UTC(
    nowIst.getUTCFullYear(),
    nowIst.getUTCMonth(),
    nowIst.getUTCDate(),
  );
  return new Date(midnightIst - offsetMs);
}

export async function runDigest(): Promise<DigestRun> {
  const config = emailConfig();
  if (!config) {
    return {
      ok: true,
      sent: 0,
      failed: 0,
      deferred: 0,
      skipped: 0,
      reason:
        'Email is not configured. The in-app queue is unaffected — set RESEND_API_KEY to ' +
        'turn the digest on.',
    };
  }

  const since = startOfTodayIst();

  // One email per person per run, so distinct recipients today is the number
  // of messages already sent.
  const sentToday = await prisma.notification.findMany({
    where: { emailSentAt: { gte: since } },
    distinct: ['userId'],
    select: { userId: true },
  });
  const budget = Math.max(0, config.dailyCap - sentToday.length);

  if (budget === 0) {
    return {
      ok: true,
      sent: 0,
      failed: 0,
      deferred: 0,
      skipped: 0,
      reason: `The daily cap of ${config.dailyCap} is already used. Everything waits for tomorrow.`,
    };
  }

  const pending = await prisma.notification.findMany({
    where: { emailSentAt: null, readAt: null },
    orderBy: { createdAt: 'asc' },
    take: 1000,
    select: { id: true, userId: true, title: true, body: true, link: true, createdAt: true },
  });

  if (pending.length === 0) {
    return { ok: true, sent: 0, failed: 0, deferred: 0, skipped: 0 };
  }

  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(pending.map((n) => n.userId))] }, isActive: true },
    select: { id: true, email: true, name: true },
  });

  const recipients = users.filter((u) => isDeliverable(u.email));

  const plan = buildDigests({
    notifications: pending,
    recipients,
    appUrl: env.APP_URL,
    maxEmails: budget,
  });

  let sent = 0;
  let failed = 0;

  for (const digest of plan.digests) {
    const result = await sendEmail(config, {
      to: digest.email,
      subject: digest.subject,
      text: digest.text,
      html: digest.html,
    });

    if (result.ok) {
      // Marked only on success, so a failure is retried on the next run
      // rather than silently lost.
      await prisma.notification.updateMany({
        where: { id: { in: digest.notificationIds } },
        data: { emailSentAt: new Date() },
      });
      sent += 1;
    } else {
      console.error('[notify] digest send failed', { to: digest.email, error: result.error });
      failed += 1;
    }
  }

  // Undeliverable addresses are marked so they are not retried every night
  // for ever. The notification itself stays in the portal, unread.
  if (plan.undeliverable.length > 0) {
    await prisma.notification.updateMany({
      where: { id: { in: plan.undeliverable } },
      data: { emailSentAt: new Date() },
    });
  }

  const skippedForAddress = pending.filter(
    (n) => !recipients.some((r) => r.id === n.userId),
  ).length;

  return {
    ok: failed === 0,
    sent,
    failed,
    deferred: plan.deferred,
    skipped: skippedForAddress,
  };
}
