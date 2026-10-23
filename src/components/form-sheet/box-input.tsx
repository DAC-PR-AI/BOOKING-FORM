'use client';

import { useId, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

/**
 * The boxed character inputs printed on the paper form — one square per digit.
 *
 * Used at four lengths, all verified against the photograph (FIELD_MAP.md):
 *   Mobile No           10
 *   Alternate Mobile No 10
 *   Adhaar No           12
 *   D.O.B                8, printed as 4 visual pairs (DD MM YY YY)
 *
 * Behaviour: auto-advance on entry, backspace steps back, arrow keys move,
 * and a pasted value fills from the current box. Mobile keyboards get the
 * numeric pad.
 *
 * Accessibility: the boxes are a labelled group with one combined value for
 * screen readers, rather than 12 unlabelled single-character fields.
 */

export type BoxInputProps = {
  value: string;
  onChange: (next: string) => void;
  length: number;
  label: string;
  name?: string;
  /** Visual gaps, e.g. [2, 2, 4] for DD MM YYYY. Must sum to `length`. */
  groups?: number[];
  disabled?: boolean;
  invalid?: boolean;
  describedById?: string;
};

export function BoxInput({
  value,
  onChange,
  length,
  label,
  name,
  groups,
  disabled = false,
  invalid = false,
  describedById,
}: BoxInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const groupId = useId();

  const digits = value.padEnd(length, ' ').slice(0, length).split('');

  const focusBox = (index: number) => {
    const clamped = Math.max(0, Math.min(length - 1, index));
    refs.current[clamped]?.focus();
    refs.current[clamped]?.select();
  };

  const setDigit = (index: number, digit: string) => {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join('').replace(/\s+$/, ''));
  };

  const handleChange = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, '').slice(-1);
    if (!digit) return;
    setDigit(index, digit);
    if (index < length - 1) focusBox(index + 1);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'Backspace': {
        event.preventDefault();
        if ((digits[index] ?? ' ').trim()) {
          setDigit(index, ' ');
        } else if (index > 0) {
          setDigit(index - 1, ' ');
          focusBox(index - 1);
        }
        return;
      }
      case 'Delete':
        event.preventDefault();
        setDigit(index, ' ');
        return;
      case 'ArrowLeft':
        event.preventDefault();
        focusBox(index - 1);
        return;
      case 'ArrowRight':
        event.preventDefault();
        focusBox(index + 1);
        return;
      case 'Home':
        event.preventDefault();
        focusBox(0);
        return;
      case 'End':
        event.preventDefault();
        focusBox(length - 1);
        return;
      default:
    }
  };

  /** Pasting a whole Aadhaar or mobile number should just work. */
  const handlePaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '');
    if (!pasted) return;

    const next = digits.slice();
    for (let i = 0; i < pasted.length && index + i < length; i += 1) {
      next[index + i] = pasted[i] ?? ' ';
    }
    onChange(next.join('').replace(/\s+$/, ''));
    focusBox(Math.min(index + pasted.length, length - 1));
  };

  // Where to insert a visual gap.
  const gapAfter = new Set<number>();
  if (groups && groups.reduce((a, b) => a + b, 0) === length) {
    let running = 0;
    for (const size of groups.slice(0, -1)) {
      running += size;
      gapAfter.add(running - 1);
    }
  }

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={describedById}
      className="flex items-center gap-1"
    >
      {/* One combined value for assistive tech and for form submission. */}
      {name ? <input type="hidden" name={name} value={value.trim()} /> : null}

      {digits.map((digit, index) => (
        <span key={`${groupId}-${index}`} className="contents">
          <input
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={1}
            disabled={disabled}
            value={digit.trim()}
            aria-label={`${label}, digit ${index + 1} of ${length}`}
            onChange={(e) => handleChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={(e) => handlePaste(index, e)}
            onFocus={(e) => e.target.select()}
            className={[
              'h-9 w-7 border text-center text-sm font-medium tabular-nums',
              'focus:outline-none focus:ring-2 focus:ring-dac-navy-500',
              invalid ? 'border-red-500 bg-red-50' : 'border-gray-400 bg-white',
              disabled ? 'cursor-not-allowed bg-gray-100 text-gray-500' : '',
            ].join(' ')}
          />
          {gapAfter.has(index) ? <span className="w-2" aria-hidden="true" /> : null}
        </span>
      ))}
    </div>
  );
}
