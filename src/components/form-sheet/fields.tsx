'use client';

import { useId, type ReactNode } from 'react';

/**
 * Primitives that give the screen form the look of the printed sheet,
 * elevated with crisp architectural borders, navy ribbon accents, and
 * tactile focus states.
 */

export function SectionRibbon({ children }: { children: ReactNode }) {
  return (
    <div className="-mt-3.5 mb-4 ml-4 inline-flex items-center gap-2 rounded-r-md border border-slate-300 border-l-4 border-l-dac-navy-700 bg-ribbon px-3.5 py-1 text-[11px] font-bold tracking-wider text-ribbon-text uppercase shadow-2xs">
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
    <section
      className={`mb-6 rounded-xl border border-slate-300/90 bg-white pb-5 shadow-2xs transition hover:border-slate-400/80 ${className}`}
    >
      {title ? <SectionRibbon>{title}</SectionRibbon> : <div className="pt-4" />}
      <div className="px-4 sm:px-5">{children}</div>
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
        className="mb-1 block text-xs font-semibold tracking-wide text-slate-700"
      >
        {label}
        {required ? <span className="ml-0.5 text-red-600">*</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p className="mt-1 text-[11px] font-medium text-slate-500">{hint}</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs font-semibold text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const inputClass = (invalid?: boolean) =>
  [
    'w-full rounded-t-md border-0 border-b-2 bg-slate-50/40 px-2 py-1.5 text-sm font-medium text-slate-900 transition-colors',
    'placeholder:font-normal placeholder:text-slate-400 focus:bg-dac-navy-50/40 focus:outline-none focus:ring-0',
    invalid
      ? 'border-red-500 bg-red-50/30 focus:border-red-600'
      : 'border-slate-300 hover:border-slate-400 focus:border-dac-navy-700',
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
        className={`${inputClass(Boolean(error))} ${uppercase ? 'uppercase tracking-wide' : ''}`}
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
 * behave as radios while keeping the printed square appearance inside a tactile chip.
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
      <legend className="mb-1.5 block text-xs font-semibold tracking-wide text-slate-700">
        {label}
        {required ? <span className="ml-0.5 text-red-600">*</span> : null}
      </legend>
      <div className={inline ? 'flex flex-wrap items-center gap-2' : 'space-y-1.5'}>
        {options.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={o.value}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${checked
                ? 'border-dac-navy-700 bg-dac-navy-50 text-dac-navy-900 shadow-2xs'
                : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
                }`}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={checked}
                onChange={() => onChange(o.value)}
                className="h-3.5 w-3.5 rounded-none border-slate-400 text-dac-navy-700 focus:ring-dac-navy-500"
              />
              <span>{o.label}</span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-xs font-semibold text-red-600">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * The photo box printed on the left of each applicant block.
 */
export function PhotoBox({
  caption,
  documentId,
  manageHref,
}: {
  caption: string;
  /** The uploaded photograph, if there is one. */
  documentId?: string | null;
  /** Where "Add" goes. Omitted when the form is read-only. */
  manageHref?: string;
}) {
  const frame =
    'flex h-36 w-28 shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl border border-slate-300 bg-slate-50 text-center shadow-2xs';

  if (documentId) {
    return (
      <a
        href={`/api/documents/${documentId}`}
        target="_blank"
        rel="noreferrer"
        className={`${frame} group relative ring-2 ring-dac-navy-500/20`}
        title={`${caption} — click to open`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/documents/${documentId}`}
          alt={caption}
          className="h-full w-full object-cover"
        />
        <span className="absolute inset-x-0 bottom-0 bg-dac-navy-900/75 py-1 text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
          Open Photo
        </span>
      </a>
    );
  }

  return (
    <div className="flex h-36 w-28 shrink-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/70 p-2.5 text-center transition hover:border-dac-navy-400 hover:bg-dac-navy-50/30">
      <svg
        className="h-6 w-6 text-slate-400"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
        />
      </svg>
      <span className="text-[10px] leading-tight text-slate-500">{caption}</span>
      {manageHref ? (
        <a
          href={manageHref}
          className="rounded-md bg-dac-navy-50 px-2 py-0.5 text-[10px] font-semibold text-dac-navy-700 ring-1 ring-dac-navy-200 transition hover:bg-dac-navy-700 hover:text-white"
        >
          Add photo
        </a>
      ) : (
        <span className="text-[10px] text-slate-400">Not attached</span>
      )}
    </div>
  );
}
