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
      className="flex items-center gap-0.5 sm:gap-1 max-w-full overflow-x-auto py-1"
    >
      {/* One combined value for assistive tech and for form submission. */}
      {name ? <input type="hidden" name={name} value={value.trim()} /> : null}

      {digits.map((digit, index) => {
        const trimmed = digit.trim();
        const isFilled = trimmed.length > 0;
        return (
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
              value={trimmed}
              aria-label={`${label}, digit ${index + 1} of ${length}`}
              onChange={(e) => handleChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              onPaste={(e) => handlePaste(index, e)}
              onFocus={(e) => e.target.select()}
              className={[
                'h-9 w-6 sm:w-7 shrink-0 rounded-md border text-center text-xs sm:text-sm font-bold tabular-nums shadow-2xs transition',
                'focus:border-dac-navy-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-dac-navy-500/30',
                invalid
                  ? 'border-red-500 bg-red-50 text-red-900'
                  : isFilled
                    ? 'border-dac-navy-600/80 bg-dac-navy-50/40 text-dac-navy-900'
                    : 'border-slate-300 bg-white text-slate-900 hover:border-slate-400',
                disabled ? 'cursor-not-allowed bg-slate-100 text-slate-500' : '',
              ].join(' ')}
            />
            {gapAfter.has(index) ? (
              <span className="w-1.5 sm:w-2.5 shrink-0" aria-hidden="true" />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
