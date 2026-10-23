import { describe, expect, it } from 'vitest';
import {
  hasValidVerhoeff,
  isValidAadhaar,
  isValidMobile,
  isValidPan,
  validateAadhaar,
  verhoeffCheckDigit,
} from './aadhaar';

/**
 * Valid 12-digit samples, generated with verhoeffCheckDigit and cross-checked
 * against the published Verhoeff vectors below. These are structurally valid
 * numbers, not real people's Aadhaar.
 */
const VALID_AADHAAR = ['234567890124', '876543210988', '998877665548'];

describe('Verhoeff — published test vectors', () => {
  // From the standard references; these pin the tables independently of our
  // own generator, so the suite is not merely self-consistent.
  it.each([
    ['236', 3],
    ['12345', 1],
    ['142857', 0],
  ])('check digit of %s is %i', (body, expected) => {
    expect(verhoeffCheckDigit(body)).toBe(expected);
  });

  it.each(['2363', '123451', '1428570'])('%s validates', (n) => {
    expect(hasValidVerhoeff(n)).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    expect(hasValidVerhoeff('2364')).toBe(false);
  });

  it('catches a transposition, which a length check would miss', () => {
    expect(hasValidVerhoeff('2363')).toBe(true);
    expect(hasValidVerhoeff('2633')).toBe(false);
  });
});

describe('validateAadhaar', () => {
  it.each(VALID_AADHAAR)('accepts %s', (n) => {
    expect(validateAadhaar(n)).toBeNull();
    expect(isValidAadhaar(n)).toBe(true);
  });

  it('rejects the wrong length', () => {
    expect(validateAadhaar('23456789012')).toBe('length');
    expect(validateAadhaar('2345678901245')).toBe('length');
  });

  it('rejects non-digits', () => {
    expect(validateAadhaar('23456789O124')).toBe('digits');
  });

  it('rejects numbers starting 0 or 1 — UIDAI never issues those', () => {
    expect(validateAadhaar('034567890124')).toBe('leading');
    expect(validateAadhaar('134567890124')).toBe('leading');
  });

  it('rejects a bad checksum that is otherwise well formed', () => {
    // Same as a valid sample with the final digit changed.
    expect(validateAadhaar('234567890123')).toBe('checksum');
  });

  it('catches a single adjacent transposition in a real-length number', () => {
    const valid = '234567890124';
    const swapped = '234567890214'; // last two body digits transposed
    expect(isValidAadhaar(valid)).toBe(true);
    expect(isValidAadhaar(swapped)).toBe(false);
  });

  it('tolerates spaces, as printed on the card in groups of four', () => {
    expect(isValidAadhaar('2345 6789 0124')).toBe(true);
  });
});

describe('PAN', () => {
  it.each(['ABCDE1234F', 'AAAPL1234C', 'ZZZZZ9999Z'])('accepts %s', (pan) => {
    expect(isValidPan(pan)).toBe(true);
  });

  it('accepts lower case input and trims it', () => {
    expect(isValidPan('  abcde1234f  ')).toBe(true);
  });

  it.each([
    'ABCD1234F', // 4 letters
    'ABCDE123F', // 3 digits
    'ABCDE12345', // trailing digit
    '1BCDE1234F', // leading digit
    'ABCDE1234', // too short
  ])('rejects %s', (pan) => {
    expect(isValidPan(pan)).toBe(false);
  });

  it('accepts a company PAN (4th char C), not just individual P', () => {
    // A booking may legitimately be made by a company or an HUF.
    expect(isValidPan('AAACC1234D')).toBe(true);
    expect(isValidPan('AAAHH1234D')).toBe(true);
  });
});

describe('mobile', () => {
  it.each(['9876543210', '6000000000', '7012345678', '8888888888'])(
    'accepts %s',
    (m) => {
      expect(isValidMobile(m)).toBe(true);
    },
  );

  it.each([
    '5876543210', // starts below 6
    '98765432', // too short
    '98765432101', // too long
    '987654321a',
  ])('rejects %s', (m) => {
    expect(isValidMobile(m)).toBe(false);
  });

  it('tolerates spaces', () => {
    expect(isValidMobile('98765 43210')).toBe(true);
  });
});
