import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  decryptField,
  encryptField,
  last4,
  maskWithLast4,
  safeEquals,
} from './field-encryption';

beforeAll(() => {
  process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});

describe('field encryption', () => {
  it('round-trips a PAN', () => {
    const pan = 'ABCDE1234F';
    expect(decryptField(encryptField(pan))).toBe(pan);
  });

  it('round-trips a 12-digit Aadhaar', () => {
    const aadhaar = '234567890123';
    expect(decryptField(encryptField(aadhaar))).toBe(aadhaar);
  });

  it('produces different ciphertext for the same input (random IV)', () => {
    const a = encryptField('ABCDE1234F');
    const b = encryptField('ABCDE1234F');
    expect(a.equals(b)).toBe(false);
  });

  it('never leaves the plaintext visible in the stored bytes', () => {
    const payload = encryptField('ABCDE1234F');
    expect(payload.toString('utf8')).not.toContain('ABCDE1234F');
    expect(payload.toString('latin1')).not.toContain('ABCDE1234F');
  });

  it('rejects tampered ciphertext rather than returning garbage', () => {
    const payload = encryptField('234567890123');
    // Flip a bit in the ciphertext body.
    const tampered = Buffer.from(payload);
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0x01;

    expect(() => decryptField(tampered)).toThrow();
  });

  it('rejects a truncated payload', () => {
    expect(() => decryptField(Buffer.alloc(8))).toThrow(/too short/i);
  });

  it('fails loudly on a wrong-length key', () => {
    const original = process.env.FIELD_ENCRYPTION_KEY;
    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    expect(() => encryptField('x')).toThrow(/32 bytes/);
    process.env.FIELD_ENCRYPTION_KEY = original;
  });
});

describe('masking', () => {
  it('takes the last 4 of an Aadhaar', () => {
    expect(last4('234567890123')).toBe('0123');
  });

  it('masks an Aadhaar to its last 4', () => {
    expect(maskWithLast4('0123', 12)).toBe('XXXXXXXX0123');
  });

  it('masks a PAN to its last 4', () => {
    expect(maskWithLast4('234F', 10)).toBe('XXXXXX234F');
  });

  it('does not go negative when the suffix is longer than the total', () => {
    expect(maskWithLast4('0123', 2)).toBe('0123');
  });
});

describe('safeEquals', () => {
  it('matches identical values', () => {
    expect(safeEquals('ABCDE1234F', 'ABCDE1234F')).toBe(true);
  });

  it('rejects different values', () => {
    expect(safeEquals('ABCDE1234F', 'ABCDE1234G')).toBe(false);
  });

  it('rejects different lengths without throwing', () => {
    expect(safeEquals('short', 'muchlonger')).toBe(false);
  });
});
