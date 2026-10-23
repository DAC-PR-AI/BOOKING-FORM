/**
 * Money handling.
 *
 * Everything is stored and compared as integer PAISE in a BigInt. Rupees only
 * ever exist as a display string or as raw user input. Floats are never used:
 * `0.1 + 0.2` problems on a sale price are not acceptable on a legal document.
 */

const PAISE_PER_RUPEE = 100n;

export type MoneyParseError = 'empty' | 'format' | 'negative' | 'too_large';

/** ₹1,00,00,00,000 — a sanity ceiling, well above any realistic unit price. */
const MAX_PAISE = 100_000_000_000n;

/**
 * Parses user input into paise.
 *
 * Accepts "5000000", "50,00,000", "5000000.50", "₹ 50,00,000.50".
 * Rejects more than two decimal places rather than rounding silently — a
 * truncated third decimal on a sale price would be a real error, not a typo
 * to paper over.
 */
export function parseRupeesToPaise(
  input: string,
): { ok: true; paise: bigint } | { ok: false; error: MoneyParseError } {
  const cleaned = input.replace(/[₹,\s]/g, '').trim();

  if (cleaned === '') return { ok: false, error: 'empty' };
  if (cleaned.startsWith('-')) return { ok: false, error: 'negative' };
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { ok: false, error: 'format' };

  const [wholePart, fractionPart = ''] = cleaned.split('.');
  const paise =
    BigInt(wholePart ?? '0') * PAISE_PER_RUPEE +
    BigInt(fractionPart.padEnd(2, '0'));

  if (paise > MAX_PAISE) return { ok: false, error: 'too_large' };

  return { ok: true, paise };
}

export function moneyErrorMessage(error: MoneyParseError): string {
  switch (error) {
    case 'empty':
      return 'Enter an amount.';
    case 'negative':
      return 'Amount cannot be negative.';
    case 'too_large':
      return 'That amount looks too large — please re-check.';
    case 'format':
      return 'Enter a valid amount, for example 50,00,000 or 5000000.50';
  }
}

/** Paise → "50,00,000.00" using the Indian grouping system (lakh, crore). */
export function formatPaise(paise: bigint, options?: { symbol?: boolean }): string {
  const negative = paise < 0n;
  const absolute = negative ? -paise : paise;

  const rupees = absolute / PAISE_PER_RUPEE;
  const remainder = absolute % PAISE_PER_RUPEE;

  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(`${rupees}.${remainder.toString().padStart(2, '0')}`));

  const symbol = options?.symbol === false ? '' : '₹';
  return `${negative ? '-' : ''}${symbol}${formatted}`;
}

/** Paise → "5000000.00", for pre-filling an editable input. */
export function paiseToInputValue(paise: bigint): string {
  const rupees = paise / PAISE_PER_RUPEE;
  const remainder = paise % PAISE_PER_RUPEE;
  return `${rupees}.${remainder.toString().padStart(2, '0')}`;
}
