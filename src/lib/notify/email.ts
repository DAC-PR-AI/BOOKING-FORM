import 'server-only';

/**
 * Sending mail through Resend.
 *
 * A single POST, so this is `fetch` rather than the `resend` SDK — same
 * reasoning as the Sheets client: a dependency should earn its place in a
 * function bundle that has a size limit.
 *
 * Email here is **best effort and nothing more**. The in-app queue is the
 * system of record; a failed send is logged and the notification stays
 * unsent for the next run. Nothing in the booking flow waits on this.
 */

const ENDPOINT = 'https://api.resend.com/emails';

export type EmailConfig = {
  apiKey: string;
  from: string;
  /** Resend's free tier allows 100 messages a day. */
  dailyCap: number;
};

export function emailConfig(): EmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;

  const cap = Number.parseInt(process.env.RESEND_DAILY_CAP ?? '', 10);

  return {
    apiKey,
    from: process.env.RESEND_FROM || 'DAC Booking <onboarding@resend.dev>',
    dailyCap: Number.isFinite(cap) && cap > 0 ? cap : 100,
  };
}

/**
 * Addresses that cannot receive mail.
 *
 * The seeded demo accounts are all on `.test`, which is reserved by RFC 2606
 * precisely so it never resolves. Sending to them would burn the daily budget
 * on guaranteed bounces, and a bounce rate like that is how a sending domain
 * gets its reputation ruined.
 */
export function isDeliverable(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return !['test', 'invalid', 'example', 'localhost'].some(
    (reserved) => domain === reserved || domain.endsWith(`.${reserved}`),
  );
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

export async function sendEmail(
  config: EmailConfig,
  message: { to: string; subject: string; text: string; html: string },
): Promise<SendResult> {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      return { ok: false, error: `Resend returned ${response.status}: ${detail}` };
    }

    const body = (await response.json()) as { id?: string };
    return { ok: true, id: body.id ?? 'unknown' };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The send failed.',
    };
  }
}
