'use client';

import { useId, type ReactNode } from 'react';

/**
 * Primitives that give the screen form the look of the printed sheet:
 * grey section ribbons, boxed sections, ruled label-colon-value rows.
 *
 * Geometry and section order come from formLayout.ts so the PDF renderer in
 * Phase 6 can read the same source rather than duplicating the layout.
 */

export function SectionRibbon({ children }: { children: ReactNode }) {
  return (
    <div className="-mt-3 mb-4 ml-3 inline-block border border-gray-400 bg-ribbon px-3 py-1 text-[11px] font-bold tracking-wide text-ribbon-text uppercase">
      {children}
    </div>
  );
}

export function SheetSection({
  title,
  children,
  className = '',
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-5 border border-gray-400 bg-white pb-4 ${className}`}>
      {title ? <SectionRibbon>{title}</SectionRibbon> : <div className="pt-4" />}
      <div className="px-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  required = false,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="mb-3">
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-[13px] font-medium text-gray-800"
      >
        {label}
        {required ? <span className="ml-0.5 text-red-600">*</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-xs text-gray-500">{hint}</p> : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const inputClass = (invalid?: boolean) =>
  [
    'w-full border-0 border-b bg-transparent px-1 py-1 text-sm',
    'focus:outline-none focus:ring-0',
    invalid
      ? 'border-red-500 focus:border-red-600'
      : 'border-gray-400 focus:border-dac-navy-600',
  ].join(' ');

export function TextField({
  label,
  value,
  onChange,
  required,
  error,
  hint,
  type = 'text',
  uppercase = false,
  maxLength,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
  type?: 'text' | 'email' | 'date' | 'tel';
  uppercase?: boolean;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} required={required} error={error} hint={hint} htmlFor={id}>
      <input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        onChange={(e) =>
          onChange(uppercase ? e.target.value.toUpperCase() : e.target.value)
        }
        className={`${inputClass(Boolean(error))} ${uppercase ? 'uppercase' : ''}`}
      />
    </Field>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  required,
  error,
  placeholder = 'Select…',
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
  error?: string | undefined;
  placeholder?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} required={required} error={error} htmlFor={id}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass(Boolean(error))}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/**
 * The paper prints these as tick boxes in a row (Villa / Plot / Apartment No,
 * Chq / Card / Online, Own Funds / Home Loan). Only one may be chosen, so they
 * behave as radios while keeping the printed square appearance.
 */
export function TickGroup({
  label,
  value,
  onChange,
  options,
  required,
  error,
  inline = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
  error?: string | undefined;
  inline?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="mb-3">
      <legend className="mb-1 block text-[13px] font-medium text-gray-800">
        {label}
        {required ? <span className="ml-0.5 text-red-600">*</span> : null}
      </legend>
      <div className={inline ? 'flex flex-wrap items-center gap-4' : 'space-y-1'}>
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="h-4 w-4 rounded-none border-gray-500 text-dac-navy-700 focus:ring-dac-navy-500"
            />
            <span className="text-sm text-gray-800">{o.label}</span>
          </label>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** The photo box printed on the left of each applicant block. */
export function PhotoBox({ caption }: { caption: string }) {
  return (
    <div className="flex h-36 w-28 shrink-0 flex-col items-center justify-center border border-gray-400 bg-gray-50 p-2 text-center">
      <span className="text-[10px] leading-tight text-gray-500">{caption}</span>
      <span className="mt-2 text-[10px] text-gray-400">Upload in Phase 3</span>
    </div>
  );
}
