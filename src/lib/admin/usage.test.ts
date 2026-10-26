import { describe, expect, it } from 'vitest';
import {
  CRITICAL_AT,
  FREE_TIER,
  WATCH_AT,
  bookingsRemaining,
  formatBytes,
  levelFor,
  meter,
} from './usage';

describe('levelFor', () => {
  it('is comfortable well below the trigger', () => {
    expect(levelFor(10, 100)).toBe('ok');
    expect(levelFor(69, 100)).toBe('ok');
  });

  it('warns exactly at the documented 70% upgrade trigger', () => {
    expect(levelFor(70, 100)).toBe('watch');
    expect(WATCH_AT).toBe(0.7);
  });

  it('becomes critical at 90%', () => {
    expect(levelFor(89, 100)).toBe('watch');
    expect(levelFor(90, 100)).toBe('critical');
    expect(CRITICAL_AT).toBe(0.9);
  });

  it('stays critical past the limit rather than wrapping', () => {
    expect(levelFor(150, 100)).toBe('critical');
  });

  it('does not divide by zero', () => {
    expect(levelFor(10, 0)).toBe('ok');
  });

  it('is ok at nothing used', () => {
    expect(levelFor(0, 100)).toBe('ok');
  });
});

describe('meter', () => {
  const consequence = 'The database goes read-only, so bookings cannot be signed.';

  it('says nothing when there is nothing to say', () => {
    const m = meter({ label: 'Database', used: 10, limit: 100, consequence });
    expect(m.level).toBe('ok');
    expect(m.note).toBeNull();
  });

  it('spells out the consequence once it matters', () => {
    const m = meter({ label: 'Database', used: 75, limit: 100, consequence });
    expect(m.note).toContain('70%');
    expect(m.note).toContain('read-only');
  });

  it('is more urgent when critical', () => {
    const m = meter({ label: 'Database', used: 95, limit: 100, consequence });
    expect(m.note).toContain('90%');
    expect(m.note).toContain('before this fills');
  });

  it('clamps the bar to 100 rather than overflowing it', () => {
    expect(meter({ label: 'x', used: 300, limit: 100, consequence }).percent).toBe(100);
  });

  it('never reports a negative bar', () => {
    expect(meter({ label: 'x', used: -5, limit: 100, consequence }).percent).toBe(0);
  });

  it('reports a real percentage in between', () => {
    expect(meter({ label: 'x', used: 25, limit: 100, consequence }).percent).toBeCloseTo(25);
  });
});

describe('the free-tier limits', () => {
  it('matches the plan: 500 MB database, 1 GB storage', () => {
    expect(FREE_TIER.databaseBytes).toBe(500 * 1024 * 1024);
    expect(FREE_TIER.storageBytes).toBe(1024 * 1024 * 1024);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [2048, '2 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
    [1536 * 1024 * 1024, '1.50 GB'],
  ])('formats %i as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('bookingsRemaining', () => {
  it('projects from what stored bookings actually weigh', () => {
    // 10 bookings using 10 MB of a 100 MB limit — 90 MB left, so about 90 more.
    const remaining = bookingsRemaining({
      usedBytes: 10 * 1024 * 1024,
      limitBytes: 100 * 1024 * 1024,
      completedBookings: 10,
    });
    expect(remaining).toBe(90);
  });

  it('returns null with nothing to project from', () => {
    expect(bookingsRemaining({ usedBytes: 0, limitBytes: 100, completedBookings: 0 })).toBeNull();
    expect(bookingsRemaining({ usedBytes: 50, limitBytes: 100, completedBookings: 0 })).toBeNull();
    expect(bookingsRemaining({ usedBytes: 0, limitBytes: 100, completedBookings: 5 })).toBeNull();
  });

  it('reports zero rather than a negative when already over', () => {
    expect(
      bookingsRemaining({ usedBytes: 200, limitBytes: 100, completedBookings: 10 }),
    ).toBe(0);
  });

  it('rounds down, so it never promises room that is not there', () => {
    const remaining = bookingsRemaining({
      usedBytes: 30,
      limitBytes: 100,
      completedBookings: 3,
    });
    expect(remaining).toBe(7);
  });
});
