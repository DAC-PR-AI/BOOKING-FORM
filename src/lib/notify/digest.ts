import { digestSubject } from './events';

/**
 * Turning unsent notifications into one email per person.
 *
 * Resend's free tier allows **100 emails a day** — not 3,000 a month, which is
 * the figure the pricing page leads with and the one that would mislead you
 * into sending per-event. One email per signature exhausts the day's budget at
 * about eleven bookings, which is a normal Monday. So email is a digest: one
 * message per person per run, listing everything they have not been told about
 * by email yet.
 *
 * That budget is also why this returns a `deferred` count rather than silently
 * dropping people. Nothing is lost when a run is capped: the in-app queue is
 * the system of record, the notifications stay unsent, and the next run picks
 * them up. An email is a prompt to go and look, not the thing being delivered.
 *
 * Pure and unit tested.
 */

export type PendingNotification = {
  id: string;
  userId: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: Date;
};

export type Recipient = {
  id: string;
  email: string;
  name: string;
};

export type Digest = {
  userId: string;
  email: string;
  name: string;
  subject: string;
  text: string;
  html: string;
  /** Marked as emailed once the send succeeds. */
  notificationIds: string[];
};

export type DigestPlan = {
  digests: Digest[];
  /** People who had something waiting but were over the day's budget. */
  deferred: number;
  /** Notifications with no deliverable recipient — skipped, not retried forever. */
  undeliverable: string[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function absolute(appUrl: string, link: string | null): string | null {
  if (!link) return null;
  return `${appUrl.replace(/\/+$/, '')}${link}`;
}

function renderText(name: string, items: PendingNotification[], appUrl: string): string {
  const lines = items.map((item) => {
    const url = absolute(appUrl, item.link);
    return [`* ${item.title}`, `  ${item.body}`, url ? `  ${url}` : null]
      .filter(Boolean)
      .join('\n');
  });

  return [
    `Hello ${name},`,
    '',
    items.length === 1
      ? 'One booking needs your attention:'
      : `${items.length} bookings need your attention:`,
    '',
    lines.join('\n\n'),
    '',
    `Open the portal: ${appUrl.replace(/\/+$/, '')}/dashboard`,
    '',
    'This is a summary. The portal is where the work happens, and it always has the',
    'full list — nothing here is the only copy.',
  ].join('\n');
}

function renderHtml(name: string, items: PendingNotification[], appUrl: string): string {
  const rows = items
    .map((item) => {
      const url = absolute(appUrl, item.link);
      const title = escapeHtml(item.title);
      const body = escapeHtml(item.body);
      const heading = url
        ? `<a href="${escapeHtml(url)}" style="color:#1b2a6b;text-decoration:underline">${title}</a>`
        : title;

      return `<li style="margin:0 0 14px"><strong style="font-size:14px">${heading}</strong><br>
        <span style="color:#444;font-size:13px">${body}</span></li>`;
    })
    .join('');

  return `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;color:#111">
  <p style="font-size:14px">Hello ${escapeHtml(name)},</p>
  <p style="font-size:14px">${
    items.length === 1
      ? 'One booking needs your attention:'
      : `${items.length} bookings need your attention:`
  }</p>
  <ul style="padding-left:18px">${rows}</ul>
  <p style="font-size:13px">
    <a href="${escapeHtml(appUrl.replace(/\/+$/, ''))}/dashboard"
       style="color:#1b2a6b">Open the DAC Booking Portal</a>
  </p>
  <p style="font-size:11px;color:#777">
    This is a summary. The portal always has the full list — nothing here is the only copy.
  </p>
</div>`;
}

export function buildDigests(input: {
  notifications: PendingNotification[];
  recipients: Recipient[];
  appUrl: string;
  /** How many emails this run may send. */
  maxEmails: number;
}): DigestPlan {
  const byId = new Map(input.recipients.map((r) => [r.id, r]));

  const grouped = new Map<string, PendingNotification[]>();
  const undeliverable: string[] = [];

  for (const notification of input.notifications) {
    if (!byId.has(notification.userId)) {
      // No active account, or no address: skip rather than retry nightly.
      undeliverable.push(notification.id);
      continue;
    }
    const list = grouped.get(notification.userId) ?? [];
    list.push(notification);
    grouped.set(notification.userId, list);
  }

  // Oldest waiting first, so a capped run never starves the same person twice.
  const ordered = [...grouped.entries()].sort(([, a], [, b]) => {
    const oldest = (items: PendingNotification[]) =>
      Math.min(...items.map((i) => i.createdAt.getTime()));
    return oldest(a) - oldest(b);
  });

  const digests: Digest[] = [];
  let deferred = 0;

  for (const [userId, items] of ordered) {
    if (digests.length >= input.maxEmails) {
      deferred += 1;
      continue;
    }

    const recipient = byId.get(userId);
    if (!recipient) continue;

    // Newest first inside the message: the most recent ask is usually the one
    // that matters.
    const sorted = [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    digests.push({
      userId,
      email: recipient.email,
      name: recipient.name,
      subject: digestSubject(sorted.length),
      text: renderText(recipient.name, sorted, input.appUrl),
      html: renderHtml(recipient.name, sorted, input.appUrl),
      notificationIds: sorted.map((i) => i.id),
    });
  }

  return { digests, deferred, undeliverable };
}
