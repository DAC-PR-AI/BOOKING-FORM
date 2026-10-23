import { describe, expect, it } from 'vitest';
import { formatPaise, paiseToInputValue, parseRupeesToPaise } from './money';

describe('parseRupeesToPaise', () => {
  it('parses a plain amount', () => {
    expect(parseRupeesToPaise('5000000')).toEqual({ ok: true, paise: 500000000n });
  });

  it('parses Indian digit grouping', () => {
    expect(parseRupeesToPaise('50,00,000')).toEqual({ ok: true, paise: 500000000n });
  });

  it('parses paise', () => {
    expect(parseRupeesToPaise('5000000.50')).toEqual({ ok: true, paise: 500000050n });
  });

  it('pads a single decimal place', () => {
    expect(parseRupeesToPaise('100.5')).toEqual({ ok: true, paise: 10050n });
  });

  it('strips a rupee symbol and spaces', () => {
    expect(parseRupeesToPaise('₹ 50,00,000.50')).toEqual({ ok: true, paise: 500000050n });
  });

  it('rejects more than two decimals rather than rounding silently', () => {
    expect(parseRupeesToPaise('100.555')).toEqual({ ok: false, error: 'format' });
  });

  it('rejects empty, negative and non-numeric input', () => {
    expect(parseRupeesToPaise('')).toEqual({ ok: false, error: 'empty' });
    expect(parseRupeesToPaise('   ')).toEqual({ ok: false, error: 'empty' });
    expect(parseRupeesToPaise('-100')).toEqual({ ok: false, error: 'negative' });
    expect(parseRupeesToPaise('abc')).toEqual({ ok: false, error: 'format' });
  });

  it('rejects an implausibly large amount', () => {
    expect(parseRupeesToPaise('99999999999')).toEqual({ ok: false, error: 'too_large' });
  });

  it('keeps full precision on a large value — no float drift', () => {
    const result = parseRupeesToPaise('12345678.91');
    expect(result).toEqual({ ok: true, paise: 1234567891n });
  });

  it('handles the classic float trap exactly', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in paise it is just 30.
    const a = parseRupeesToPaise('0.10');
    const b = parseRupeesToPaise('0.20');
    if (!a.ok || !b.ok) throw new Error('expected both to parse');
    expect(a.paise + b.paise).toBe(30n);
  });
});

describe('formatPaise', () => {
  it('formats with Indian grouping (lakh/crore)', () => {
    expect(formatPaise(500000000n)).toBe('₹50,00,000.00');
  });

  it('formats a crore', () => {
    // ₹1 crore = 1,00,00,000 rupees = 1,000,000,000 paise.
    expect(formatPaise(1000000000n)).toBe('₹1,00,00,000.00');
  });

  it('formats ten crore', () => {
    expect(formatPaise(10000000000n)).toBe('₹10,00,00,000.00');
  });

  it('keeps paise', () => {
    expect(formatPaise(500000050n)).toBe('₹50,00,000.50');
  });

  it('formats zero', () => {
    expect(formatPaise(0n)).toBe('₹0.00');
  });

  it('can omit the symbol', () => {
    expect(formatPaise(500000000n, { symbol: false })).toBe('50,00,000.00');
  });
});

describe('round-tripping', () => {
  it.each(['5000000', '50,00,000.50', '1', '0.01', '12345678.91'])(
    'survives parse -> input value -> parse for %s',
    (input) => {
      const first = parseRupeesToPaise(input);
      if (!first.ok) throw new Error('expected parse to succeed');
      const second = parseRupeesToPaise(paiseToInputValue(first.paise));
      if (!second.ok) throw new Error('expected re-parse to succeed');
      expect(second.paise).toBe(first.paise);
    },
  );
});
