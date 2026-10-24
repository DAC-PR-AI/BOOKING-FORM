import { describe, expect, it } from 'vitest';
import {
  BOOKING_ID_PATTERN,
  bookingYearIst,
  formatBookingId,
  parseBookingId,
} from './booking-id';

describe('formatBookingId', () => {
  it('produces the format printed on the paper form', () => {
    expect(formatBookingId(2026, 1)).toBe('DAC/2026/00001');
    expect(formatBookingId(2026, 42)).toBe('DAC/2026/00042');
    expect(formatBookingId(2026, 99999)).toBe('DAC/2026/99999');
  });

  it('matches the pattern it advertises', () => {
    expect(BOOKING_ID_PATTERN.test(formatBookingId(2026, 7))).toBe(true);
  });

  it('grows rather than wrapping past five digits', () => {
    // A duplicated Booking ID would be far worse than one character of overflow.
    expect(formatBookingId(2026, 100000)).toBe('DAC/2026/100000');
    expect(formatBookingId(2026, 1234567)).toBe('DAC/2026/1234567');
  });

  it('accepts a different prefix without changing the shape', () => {
    expect(formatBookingId(2026, 3, 'DACX')).toBe('DACX/2026/00003');
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
  ])('refuses a %s sequence', (_name, sequence) => {
    expect(() => formatBookingId(2026, sequence)).toThrow();
  });

  it.each([
    ['too early', 1999],
    ['five digits', 10000],
    ['fractional', 2026.5],
  ])('refuses a %s year', (_name, year) => {
    expect(() => formatBookingId(year, 1)).toThrow();
  });
});

describe('bookingYearIst', () => {
  it('uses the Indian calendar year, not UTC', () => {
    // 31 December 2025, 20:00 UTC is already 01:30 IST on 1 January 2026.
    // To the office this is a 2026 booking; UTC would file it under 2025.
    expect(bookingYearIst(new Date('2025-12-31T20:00:00Z'))).toBe(2026);
  });

  it('does not roll over early', () => {
    // 31 December 2025, 17:00 UTC is 22:30 IST on 31 December — still 2025.
    expect(bookingYearIst(new Date('2025-12-31T17:00:00Z'))).toBe(2025);
  });

  it('is stable mid-year', () => {
    expect(bookingYearIst(new Date('2026-06-15T12:00:00Z'))).toBe(2026);
  });
});

describe('parseBookingId', () => {
  it('round-trips what formatBookingId produced', () => {
    expect(parseBookingId(formatBookingId(2026, 42))).toEqual({
      prefix: 'DAC',
      year: 2026,
      sequence: 42,
    });
  });

  it('reads a sequence that grew past five digits', () => {
    expect(parseBookingId('DAC/2026/123456')?.sequence).toBe(123456);
  });

  it.each([
    ['empty', ''],
    ['lowercase prefix', 'dac/2026/00001'],
    ['missing year', 'DAC/00001'],
    ['short sequence', 'DAC/2026/0001'],
    ['two-digit year', 'DAC/26/00001'],
    ['trailing text', 'DAC/2026/00001x'],
  ])('rejects %s', (_name, value) => {
    expect(parseBookingId(value)).toBeNull();
  });
});
