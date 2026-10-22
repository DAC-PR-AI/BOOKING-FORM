import { describe, expect, it } from 'vitest';
import { REDACTED, redact } from './redact';

describe('audit redaction', () => {
  it('redacts PAN and Aadhaar at the top level', () => {
    const out = redact({ pan: 'ABCDE1234F', aadhaar: '234567890123', name: 'RAVI' });
    expect(out).toEqual({ pan: REDACTED, aadhaar: REDACTED, name: 'RAVI' });
  });

  it('redacts nested sensitive fields', () => {
    const out = redact({
      applicant: { fullName: 'RAVI KUMAR', pan: 'ABCDE1234F', dob: '1990-01-01' },
    });
    expect(out).toEqual({
      applicant: { fullName: 'RAVI KUMAR', pan: REDACTED, dob: REDACTED },
    });
  });

  it('redacts inside arrays', () => {
    const out = redact([{ pan: 'ABCDE1234F' }, { pan: 'ZZZZZ9999Z' }]);
    expect(out).toEqual([{ pan: REDACTED }, { pan: REDACTED }]);
  });

  it('redacts the last-4 columns too — they are still personal data', () => {
    const out = redact({ panLast4: '234F', aadhaarLast4: '0123' });
    expect(out).toEqual({ panLast4: REDACTED, aadhaarLast4: REDACTED });
  });

  it('redacts credentials and session tokens', () => {
    const out = redact({ passwordHash: '$argon2id$...', tokenHash: 'deadbeef' });
    expect(out).toEqual({ passwordHash: REDACTED, tokenHash: REDACTED });
  });

  it('leaves non-sensitive values untouched', () => {
    const input = { bookingId: 'DAC/2026/00001', salePricePaise: 5_000_000_00 };
    expect(redact(input)).toEqual(input);
  });

  it('passes through null and undefined', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  it('serialises dates rather than dropping them', () => {
    const d = new Date('2026-10-22T00:00:00.000Z');
    expect(redact({ bookingDate: d })).toEqual({
      bookingDate: '2026-10-22T00:00:00.000Z',
    });
  });
});
