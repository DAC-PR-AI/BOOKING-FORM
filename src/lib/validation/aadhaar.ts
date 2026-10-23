/**
 * Aadhaar validation.
 *
 * A length check alone is not enough. Aadhaar carries a Verhoeff check digit,
 * which catches single-digit errors and — importantly for a form typed from a
 * card by hand — adjacent transpositions. "234567890132" would pass a naive
 * 12-digit test and fail here.
 *
 * Tables from the Verhoeff algorithm (dihedral group D5).
 */

// Multiplication table.
const D: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

// Permutation table.
const P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** Inverse table — used when generating a check digit, not when verifying. */
const INV: readonly number[] = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function at(table: readonly (readonly number[])[], row: number, col: number): number {
  return table[row]?.[col] ?? 0;
}

/** True when the digit string satisfies the Verhoeff checksum. */
export function hasValidVerhoeff(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;

  let c = 0;
  const reversed = digits.split('').reverse();

  for (let i = 0; i < reversed.length; i += 1) {
    const digit = Number(reversed[i]);
    c = at(D, c, at(P, i % 8, digit));
  }

  return c === 0;
}

/** Computes the Verhoeff check digit for a body of digits. */
export function verhoeffCheckDigit(body: string): number {
  let c = 0;
  const reversed = body.split('').reverse();

  for (let i = 0; i < reversed.length; i += 1) {
    const digit = Number(reversed[i]);
    c = at(D, c, at(P, (i + 1) % 8, digit));
  }

  return INV[c] ?? 0;
}

export type AadhaarProblem = 'length' | 'digits' | 'leading' | 'checksum';

/**
 * Returns null when valid, or the first problem found.
 *
 * UIDAI never issues a number starting with 0 or 1, so those are rejected
 * before the checksum — it gives a clearer error than "invalid number".
 */
export function validateAadhaar(value: string): AadhaarProblem | null {
  const digits = value.replace(/\s/g, '');

  if (!/^\d*$/.test(digits)) return 'digits';
  if (digits.length !== 12) return 'length';
  if (digits.startsWith('0') || digits.startsWith('1')) return 'leading';
  if (!hasValidVerhoeff(digits)) return 'checksum';

  return null;
}

export function aadhaarMessage(problem: AadhaarProblem): string {
  switch (problem) {
    case 'digits':
      return 'Adhaar number must contain digits only.';
    case 'length':
      return 'Adhaar number must be exactly 12 digits.';
    case 'leading':
      return 'An Adhaar number never starts with 0 or 1. Please re-check the card.';
    case 'checksum':
      return 'That Adhaar number is not valid — please re-check the digits.';
  }
}

export function isValidAadhaar(value: string): boolean {
  return validateAadhaar(value) === null;
}

// --- PAN -------------------------------------------------------------------

/**
 * PAN is AAAAA9999A. The 4th character encodes holder type ('P' individual,
 * 'C' company, 'H' HUF, …). We accept any valid type rather than forcing 'P':
 * a booking can legitimately be made by a company or an HUF.
 */
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function isValidPan(value: string): boolean {
  return PAN_PATTERN.test(value.trim().toUpperCase());
}

// --- Mobile ----------------------------------------------------------------

/** Indian mobile numbers are 10 digits starting 6–9. */
export const MOBILE_PATTERN = /^[6-9]\d{9}$/;

export function isValidMobile(value: string): boolean {
  return MOBILE_PATTERN.test(value.replace(/\s/g, ''));
}
