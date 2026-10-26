import { describe, expect, it } from 'vitest';
import { buildDigests, type PendingNotification, type Recipient } from './digest';

const APP_URL = 'https://booking.dac.example';

function note(overrides: Partial<PendingNotification> = {}): PendingNotification {
  return {
    id: 'n1',
    userId: 'u1',
    title: 'DAC/2026/00042 is waiting on you',
    body: 'AGM — review it and sign.',
    link: '/forms/abc',
    createdAt: new Date('2026-10-26T10:00:00Z'),
    ...overrides,
  };
}

const AGM: Recipient = { id: 'u1', email: 'agm@dac.test', name: 'Anita AGM' };
const MIS: Recipient = { id: 'u2', email: 'mis@dac.test', name: 'Mani MIS' };

function build(
  notifications: PendingNotification[],
  recipients: Recipient[] = [AGM, MIS],
  maxEmails = 100,
) {
  return buildDigests({ notifications, recipients, appUrl: APP_URL, maxEmails });
}

describe('one email per person, not per event', () => {
  it('collapses several notifications into a single message', () => {
    const plan = build([
      note({ id: 'a' }),
      note({ id: 'b', title: 'DAC/2026/00043 is waiting on you' }),
      note({ id: 'c', title: 'DAC/2026/00044 is waiting on you' }),
    ]);

    expect(plan.digests).toHaveLength(1);
    expect(plan.digests[0]?.notificationIds).toEqual(['a', 'b', 'c']);
  });

  it('sends one message to each person who has something waiting', () => {
    const plan = build([note({ id: 'a', userId: 'u1' }), note({ id: 'b', userId: 'u2' })]);
    expect(plan.digests.map((d) => d.email).sort()).toEqual(['agm@dac.test', 'mis@dac.test']);
  });

  it('says the count in the subject, so it is useful unopened', () => {
    expect(build([note()]).digests[0]?.subject).toBe('1 booking is waiting on you');

    const many = build([note({ id: 'a' }), note({ id: 'b' })]);
    expect(many.digests[0]?.subject).toBe('2 bookings are waiting on you');
  });

  it('produces nothing when there is nothing waiting', () => {
    const plan = build([]);
    expect(plan.digests).toEqual([]);
    expect(plan.deferred).toBe(0);
  });
});

describe('the daily budget', () => {
  it('never exceeds the cap', () => {
    const notifications = Array.from({ length: 10 }, (_, i) =>
      note({ id: `n${i}`, userId: `u${i}` }),
    );
    const recipients = Array.from({ length: 10 }, (_, i) => ({
      id: `u${i}`,
      email: `u${i}@dac.test`,
      name: `User ${i}`,
    }));

    const plan = buildDigests({ notifications, recipients, appUrl: APP_URL, maxEmails: 4 });
    expect(plan.digests).toHaveLength(4);
    expect(plan.deferred).toBe(6);
  });

  it('serves whoever has been waiting longest first', () => {
    // A capped run must not starve the same person every night.
    const plan = buildDigests({
      notifications: [
        note({ id: 'new', userId: 'u2', createdAt: new Date('2026-10-26T12:00:00Z') }),
        note({ id: 'old', userId: 'u1', createdAt: new Date('2026-10-20T09:00:00Z') }),
      ],
      recipients: [AGM, MIS],
      appUrl: APP_URL,
      maxEmails: 1,
    });

    expect(plan.digests).toHaveLength(1);
    expect(plan.digests[0]?.userId).toBe('u1');
    expect(plan.deferred).toBe(1);
  });

  it('defers people rather than dropping their notifications', () => {
    const plan = buildDigests({
      notifications: [note({ id: 'a', userId: 'u1' }), note({ id: 'b', userId: 'u2' })],
      recipients: [AGM, MIS],
      appUrl: APP_URL,
      maxEmails: 1,
    });

    // Only the sent one is marked; the other stays pending for the next run.
    const marked = plan.digests.flatMap((d) => d.notificationIds);
    expect(marked).toEqual(['a']);
    expect(plan.undeliverable).toEqual([]);
  });

  it('sends nothing at all when the budget is spent', () => {
    const plan = buildDigests({
      notifications: [note()],
      recipients: [AGM],
      appUrl: APP_URL,
      maxEmails: 0,
    });
    expect(plan.digests).toEqual([]);
    expect(plan.deferred).toBe(1);
  });
});

describe('recipients that cannot be reached', () => {
  it('skips a notification whose user is not in the recipient list', () => {
    // Deactivated account, or one with no address.
    const plan = build([note({ id: 'orphan', userId: 'gone' })], [AGM]);
    expect(plan.digests).toEqual([]);
    expect(plan.undeliverable).toEqual(['orphan']);
  });

  it('still serves everybody else', () => {
    const plan = build([note({ id: 'orphan', userId: 'gone' }), note({ id: 'ok', userId: 'u1' })]);
    expect(plan.digests).toHaveLength(1);
    expect(plan.undeliverable).toEqual(['orphan']);
  });
});

describe('the message itself', () => {
  const plan = build([
    note({ id: 'a', createdAt: new Date('2026-10-20T09:00:00Z'), title: 'Older' }),
    note({ id: 'b', createdAt: new Date('2026-10-26T09:00:00Z'), title: 'Newer' }),
  ]);
  const digest = plan.digests[0];

  it('leads with the most recent ask', () => {
    expect(digest?.notificationIds).toEqual(['b', 'a']);
  });

  it('greets the person by name', () => {
    expect(digest?.text).toContain('Anita AGM');
    expect(digest?.html).toContain('Anita AGM');
  });

  it('turns app links into absolute URLs', () => {
    expect(digest?.text).toContain(`${APP_URL}/forms/abc`);
    expect(digest?.html).toContain(`${APP_URL}/forms/abc`);
  });

  it('does not double the slash when the app URL has a trailing one', () => {
    const trailing = buildDigests({
      notifications: [note()],
      recipients: [AGM],
      appUrl: 'https://booking.dac.example/',
      maxEmails: 10,
    });
    expect(trailing.digests[0]?.text).not.toContain('example//forms');
  });

  it('says the portal is the real list, not the email', () => {
    expect(digest?.text).toContain('nothing here is the only copy');
  });

  it('carries both a text and an HTML part', () => {
    expect(digest?.text.length).toBeGreaterThan(0);
    expect(digest?.html).toContain('<div');
  });

  it('copes with a notification that has no link', () => {
    const noLink = build([note({ link: null })]);
    expect(noLink.digests[0]?.text).not.toContain('undefined');
    expect(noLink.digests[0]?.html).not.toContain('href="null"');
  });
});

describe('escaping', () => {
  it('escapes HTML in a notification body', () => {
    // A project or applicant name is free text and reaches this unaltered.
    const plan = build([
      note({ body: 'Returned: "fix <b>the price</b>" & resubmit' }),
    ]);

    expect(plan.digests[0]?.html).toContain('&lt;b&gt;');
    expect(plan.digests[0]?.html).not.toContain('<b>the price</b>');
    expect(plan.digests[0]?.html).toContain('&amp;');
  });

  it('escapes the recipient name too', () => {
    const plan = build([note()], [{ ...AGM, name: 'A <script>alert(1)</script>' }]);
    expect(plan.digests[0]?.html).not.toContain('<script>');
  });

  it('leaves the plain-text part unescaped, as it should be', () => {
    const plan = build([note({ body: 'price & terms' })]);
    expect(plan.digests[0]?.text).toContain('price & terms');
  });
});
