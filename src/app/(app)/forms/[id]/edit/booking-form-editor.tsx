'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BoxInput } from '@/components/form-sheet/box-input';
import {
  Field,
  PhotoBox,
  SelectField,
  SheetSection,
  TextField,
  TickGroup,
} from '@/components/form-sheet/fields';
import { saveDraft } from '../../actions';
import type { DraftInput } from '@/lib/validation/booking-form';
import { validateAadhaar, aadhaarMessage, isValidPan } from '@/lib/validation/aadhaar';

type ApplicantState = NonNullable<DraftInput['firstApplicant']>;
type AddressState = NonNullable<DraftInput['communicationAddress']>;

export type EditorState = {
  bookingDate: string;
  projectId: string;
  propertyType: string;
  apartmentNo: string;
  salesExecutive: string;
  salesHead: string;
  telecaller: string;
  leadId: string;
  source: string;
  builtUpAreaSqft: string;
  udsSqft: string;
  floor: string;
  bookingAdvance: string;
  paymentMode: string;
  paymentRefNo: string;
  paymentDate: string;
  bank: string;
  paymentSource: string;
  salePrice: string;
  remarks: string;
  hasSecondApplicant: boolean;
  sameAsCommunication: boolean;
  firstApplicant: ApplicantState;
  secondApplicant: ApplicantState;
  communicationAddress: AddressState;
  permanentAddress: AddressState;
};

const SALUTATIONS = [
  { value: 'MR', label: 'Mr.' },
  { value: 'MRS', label: 'Mrs.' },
  { value: 'MS', label: 'Ms.' },
];

const RELATIONS = [
  { value: 'SON_OF', label: 'Son of' },
  { value: 'DAUGHTER_OF', label: 'Daughter of' },
  { value: 'WIFE_OF', label: 'Wife of' },
];

function ApplicantBlock({
  title,
  photoCaption,
  photoDocumentId,
  documentsHref,
  value,
  onChange,
  existingLast4,
}: {
  title: string;
  photoCaption: string;
  /** The uploaded passport photograph, so the box shows what will print. */
  photoDocumentId: string | null;
  documentsHref: string;
  value: ApplicantState;
  onChange: (patch: Partial<ApplicantState>) => void;
  existingLast4?: { pan?: string | null; aadhaar?: string | null };
}) {
  const set = <K extends keyof ApplicantState>(key: K) => (v: ApplicantState[K]) =>
    onChange({ [key]: v } as Partial<ApplicantState>);

  const aadhaarDigits = (value.aadhaar ?? '').replace(/\s/g, '');
  let aadhaarError: string | undefined = undefined;
  let aadhaarHint: string | undefined = undefined;

  if (aadhaarDigits.length === 12) {
    const problem = validateAadhaar(aadhaarDigits);
    if (problem) {
      aadhaarError = aadhaarMessage(problem);
    } else {
      aadhaarHint = '✓ Valid Adhaar number';
    }
  } else if (aadhaarDigits.length > 0) {
    aadhaarHint = `${12 - aadhaarDigits.length} digit${12 - aadhaarDigits.length === 1 ? '' : 's'} remaining`;
  } else if (existingLast4?.aadhaar) {
    aadhaarHint = `Saved on file: •••• •••• ${existingLast4.aadhaar} (leave blank to keep)`;
  } else {
    aadhaarHint = '12 digits required (must be a valid UIDAI number)';
  }

  const panValue = (value.pan ?? '').trim().toUpperCase();
  let panError: string | undefined = undefined;
  let panHint: string | undefined = 'Format AAAAA9999A';
  if (panValue.length === 10) {
    if (!isValidPan(panValue)) {
      panError = 'Enter a valid PAN (e.g. ABCDE1234F).';
    } else {
      panHint = '✓ Valid PAN';
    }
  } else if (panValue.length === 0 && existingLast4?.pan) {
    panHint = `Saved on file: ••••••${existingLast4.pan} (leave blank to keep)`;
  }

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/40 p-3.5 sm:p-5">
      <div className="mb-4 flex items-center gap-2 border-b border-slate-200/80 pb-2.5">
        <span className="h-2 w-2 rounded-full bg-dac-navy-700" aria-hidden="true" />
        <h3 className="text-xs font-bold tracking-wider text-dac-navy-900 uppercase">
          {title}
        </h3>
      </div>

      <div className="flex flex-col items-center md:items-start md:flex-row gap-5">
        <PhotoBox
          caption={photoCaption}
          documentId={photoDocumentId}
          manageHref={documentsHref}
        />

        <div className="min-w-0 flex-1 w-full space-y-3.5">
          {/* Row 1: Name and Guardian */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="w-full sm:w-24 shrink-0">
                <SelectField
                  label="Mr./Mrs./Ms."
                  value={value.salutation ?? ''}
                  onChange={set('salutation')}
                  options={SALUTATIONS}
                  placeholder="—"
                />
              </div>
              <div className="min-w-0 flex-1">
                <TextField
                  label="Name"
                  value={value.fullName ?? ''}
                  onChange={set('fullName')}
                  uppercase
                  maxLength={120}
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <div className="w-full sm:w-32 shrink-0">
                <SelectField
                  label="Son / Daughter / Wife of"
                  value={value.relationType ?? ''}
                  onChange={set('relationType')}
                  options={RELATIONS}
                  placeholder="—"
                />
              </div>
              <div className="w-full sm:w-20 shrink-0">
                <SelectField
                  label="Mr./Mrs./Ms."
                  value={value.guardianSalutation ?? ''}
                  onChange={set('guardianSalutation')}
                  options={SALUTATIONS}
                  placeholder="—"
                />
              </div>
              <div className="min-w-0 flex-1">
                <TextField
                  label="Name"
                  value={value.guardianName ?? ''}
                  onChange={set('guardianName')}
                  uppercase
                  maxLength={120}
                />
              </div>
            </div>
          </div>

          {/* Row 2: Mobile Numbers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Mobile No">
              <div className="overflow-x-auto pb-1 max-w-full">
                <BoxInput
                  label="Mobile number"
                  length={10}
                  groups={[5, 5]}
                  value={value.mobileNo ?? ''}
                  onChange={set('mobileNo')}
                />
              </div>
            </Field>

            <Field label="Alternate Mobile No">
              <div className="overflow-x-auto pb-1 max-w-full">
                <BoxInput
                  label="Alternate mobile number"
                  length={10}
                  groups={[5, 5]}
                  value={value.altMobileNo ?? ''}
                  onChange={set('altMobileNo')}
                />
              </div>
            </Field>
          </div>

          {/* Row 3: Email and PAN */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            <TextField
              label="Email ID"
              type="email"
              value={value.email ?? ''}
              onChange={set('email')}
            />
            <TextField
              label="PAN (Mandatory)"
              value={value.pan ?? ''}
              onChange={set('pan')}
              uppercase
              maxLength={10}
              error={panError}
              hint={panHint}
            />
          </div>

          {/* Row 4: Aadhaar (Dedicated full width row, 4-4-4 grouping) */}
          <div className="w-full">
            <Field
              label="Adhaar No"
              error={aadhaarError}
              hint={aadhaarHint}
            >
              <div className="overflow-x-auto pb-1 max-w-full">
                <BoxInput
                  label="Adhaar number"
                  length={12}
                  groups={[4, 4, 4]}
                  invalid={Boolean(aadhaarError)}
                  value={value.aadhaar ?? ''}
                  onChange={set('aadhaar')}
                />
              </div>
            </Field>
          </div>

          {/* Row 5: D.O.B (Dedicated full width row, never collides with Aadhaar) */}
          <div className="w-full">
            <Field label="D.O.B (DD/MM/YYYY)">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <div className="overflow-x-auto pb-1">
                  <BoxInput
                    label="Date of birth"
                    length={8}
                    groups={[2, 2, 4]}
                    value={dobToDigits(value.dob ?? '')}
                    onChange={(digits) => onChange({ dob: digitsToDob(digits) })}
                  />
                </div>
                <input
                  type="date"
                  aria-label="Date of birth, date picker"
                  value={value.dob ?? ''}
                  onChange={(e) => onChange({ dob: e.target.value })}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-2xs focus:border-dac-navy-600 focus:outline-none"
                />
              </div>
            </Field>
          </div>

          {/* Row 6: Occupation Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            <TextField
              label="Occupation"
              value={value.occupation ?? ''}
              onChange={set('occupation')}
            />
            <TextField
              label="Company Name"
              value={value.companyName ?? ''}
              onChange={set('companyName')}
            />
            <TextField
              label="Designation"
              value={value.designation ?? ''}
              onChange={set('designation')}
            />
            <TextField
              label="Location"
              value={value.location ?? ''}
              onChange={set('location')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** "1990-05-14" -> "14051990" for the eight printed boxes. */
function dobToDigits(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  return `${m[3]}${m[2]}${m[1]}`;
}

/** "14051990" -> "1990-05-14", only once all eight boxes are filled. */
function digitsToDob(digits: string): string {
  if (digits.length !== 8) return '';
  return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
}

function AddressBlock({
  title,
  value,
  onChange,
  disabled = false,
}: {
  title: string;
  value: AddressState;
  onChange: (patch: Partial<AddressState>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex-1 rounded-xl border border-slate-300/90 bg-white p-4 sm:p-5 shadow-2xs">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-3.5 w-1 rounded-full bg-dac-navy-700" aria-hidden="true" />
        <h3 className="text-xs font-bold tracking-wider text-dac-navy-900 uppercase">
          {title}
        </h3>
      </div>
      {([1, 2, 3, 4] as const).map((n) => {
        const key = `line${n}` as keyof AddressState;
        return (
          <input
            key={n}
            aria-label={`${title} line ${n}`}
            placeholder={`Address line ${n}`}
            value={value[key] ?? ''}
            disabled={disabled}
            maxLength={100}
            onChange={(e) => onChange({ [key]: e.target.value } as Partial<AddressState>)}
            className="mb-2.5 w-full rounded-t-md border-0 border-b-2 border-slate-300 bg-slate-50/40 px-2 py-1.5 text-sm font-medium text-slate-900 transition-colors placeholder:font-normal placeholder:text-slate-400 focus:border-dac-navy-700 focus:bg-dac-navy-50/40 focus:outline-none disabled:bg-slate-100/70 disabled:text-slate-500"
          />
        );
      })}
    </div>
  );
}

export function BookingFormEditor({
  formId,
  initial,
  projects,
  sources,
  photoDocumentIds,
  existingLast4,
  readOnly = false,
}: {
  formId: string;
  initial: EditorState;
  projects: Array<{ value: string; label: string }>;
  sources: Array<{ value: string; label: string }>;
  photoDocumentIds: { primary: string | null; secondary: string | null };
  existingLast4?: {
    primary?: { pan?: string | null; aadhaar?: string | null };
    secondary?: { pan?: string | null; aadhaar?: string | null };
  };
  readOnly?: boolean;
}) {
  const [state, setState] = useState<EditorState>(initial);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  const patch = useCallback(
    (next: Partial<EditorState>) => {
      dirty.current = true;
      setState((prev) => ({ ...prev, ...next }));
    },
    [],
  );

  const persist = useCallback(
    async (current: EditorState) => {
      setStatus('saving');
      const result = await saveDraft(formId, {
        ...current,
        secondApplicant: current.hasSecondApplicant ? current.secondApplicant : undefined,
      });

      if (result.ok) {
        setStatus('saved');
        const now = new Date();
        setMessage(
          now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
          }),
        );
        dirty.current = false;
      } else {
        setStatus('error');
        setMessage(result.error);
      }
    },
    [formId],
  );

  // Debounced auto-save on every state change.
  useEffect(() => {
    if (readOnly || !dirty.current) return;
    setStatus('saving');

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(state), 1200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, persist, readOnly]);

  // Warn before losing an unsaved change on navigation away.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const setApplicant =
    (which: 'firstApplicant' | 'secondApplicant') => (p: Partial<ApplicantState>) =>
      patch({ [which]: { ...state[which], ...p } } as Partial<EditorState>);

  const documentsHref = `/forms/${formId}/documents`;

  return (
    <div className="mx-auto max-w-4xl px-1 sm:px-4">
      {/* Sticky 3-Step Workflow & Autosave Bar */}
      <div className="sticky top-14 z-20 mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border border-slate-200/90 bg-white/95 px-4 py-3 text-xs shadow-md backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-dac-navy-800 px-2.5 py-1 font-semibold text-white shadow-2xs">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px]">
              1
            </span>
            <span>Booking Form</span>
          </span>
          <span className="text-slate-300" aria-hidden="true">→</span>
          <Link
            href={documentsHref}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-dac-navy-700 transition hover:border-dac-navy-300 hover:bg-dac-navy-50"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-dac-navy-100 text-[10px] text-dac-navy-800">
              2
            </span>
            <span>Supporting documents</span>
          </Link>
          <span className="text-slate-300" aria-hidden="true">→</span>
          <Link
            href={`/forms/${formId}/review`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-dac-navy-700 transition hover:border-dac-navy-300 hover:bg-dac-navy-50"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-dac-navy-100 text-[10px] text-dac-navy-800">
              3
            </span>
            <span>Review and submit</span>
          </Link>
        </div>

        <span aria-live="polite" className="flex items-center gap-1.5 font-medium text-slate-600">
          {status === 'saving' ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-amber-800 border border-amber-200">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              Saving…
            </span>
          ) : null}
          {status === 'saved' ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-emerald-800 border border-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              All changes saved at {message}
            </span>
          ) : null}
          {status === 'error' ? (
            <span className="rounded-full bg-red-50 px-2.5 py-0.5 font-semibold text-red-700 border border-red-200">
              {message}
            </span>
          ) : null}
          {status === 'idle' ? (
            <span className="text-slate-500">Changes save automatically</span>
          ) : null}
        </span>
      </div>

      {/* Elevated Paper Sheet Replica Container */}
      <div className="rounded-2xl border border-slate-300/90 bg-white p-4 sm:p-6 shadow-xl shadow-slate-900/5">
        {/* --- Paper Form Masthead with DAC Logo ---------------------------- */}
        <div className="mb-6 flex items-center justify-between rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-dac-navy-50/40 px-4 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2 mb-1.5" aria-hidden="true">
              <span className="h-1.5 w-14 rounded-full bg-dac-navy-700" />
              <span className="h-1.5 w-7 rounded-full bg-dac-orange-500" />
            </div>
            <h2 className="text-lg sm:text-xl font-extrabold tracking-wide text-dac-navy-900 uppercase">
              Booking Form
            </h2>
            <p className="text-xs font-medium text-slate-500">
              DAC Developers Pvt Ltd · Provisional Allotment Sheet
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/dac-logo.png"
            alt="DAC Developers"
            className="h-11 sm:h-14 w-auto object-contain"
          />
        </div>

        {/* --- Header block ------------------------------------------------- */}
        <SheetSection>
          <div className="grid gap-x-6 gap-y-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            <TextField
              label="Booking Date"
              type="date"
              value={state.bookingDate}
              onChange={(v) => patch({ bookingDate: v })}
            />
            <SelectField
              label="Project Name"
              value={state.projectId}
              onChange={(v) => patch({ projectId: v })}
              options={projects}
            />
            <div>
              <TickGroup
                label="Property type"
                value={state.propertyType}
                onChange={(v) => patch({ propertyType: v })}
                options={[
                  { value: 'VILLA', label: 'Villa' },
                  { value: 'PLOT', label: 'Plot' },
                  { value: 'APARTMENT', label: 'Apartment No' },
                ]}
              />
              {state.propertyType === 'APARTMENT' ? (
                <TextField
                  label="Apartment No"
                  value={state.apartmentNo}
                  onChange={(v) => patch({ apartmentNo: v })}
                  maxLength={20}
                />
              ) : null}
            </div>

            <TextField
              label="Sales Executive"
              value={state.salesExecutive}
              onChange={(v) => patch({ salesExecutive: v })}
            />
            <TextField
              label="Sales Head"
              value={state.salesHead}
              onChange={(v) => patch({ salesHead: v })}
            />
            <TextField
              label="Telecaller"
              value={state.telecaller}
              onChange={(v) => patch({ telecaller: v })}
            />

            <TextField
              label="Lead ID"
              value={state.leadId}
              onChange={(v) => patch({ leadId: v })}
              maxLength={60}
            />
            <SelectField
              label="Source"
              value={state.source}
              onChange={(v) => patch({ source: v })}
              options={sources}
            />
            <Field label="Booking ID">
              <p className="rounded-t-md border-b-2 border-dashed border-slate-300 bg-slate-50/60 px-2 py-1.5 text-sm text-slate-500 italic">
                Generated on submission
              </p>
            </Field>
          </div>
        </SheetSection>

        {/* --- Personal information ----------------------------------------- */}
        <SheetSection title="Personal Information (to be filled in CAPITAL LETTERS ONLY)">
          <ApplicantBlock
            title="Sole / First Applicant"
            photoCaption="Photo of Sole / First Applicant"
            photoDocumentId={photoDocumentIds.primary}
            documentsHref={documentsHref}
            value={state.firstApplicant}
            onChange={setApplicant('firstApplicant')}
            existingLast4={existingLast4?.primary}
          />

          <label className="mb-3 inline-flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 transition hover:border-dac-navy-300 hover:bg-dac-navy-50/40">
            <input
              type="checkbox"
              checked={state.hasSecondApplicant}
              onChange={(e) => patch({ hasSecondApplicant: e.target.checked })}
              className="h-4 w-4 rounded border-slate-400 text-dac-navy-700 focus:ring-dac-navy-500"
            />
            This booking has a second applicant
          </label>

          {state.hasSecondApplicant ? (
            <ApplicantBlock
              title="Co / Second Applicant"
              photoCaption="Photo of Co / Second Applicant"
              photoDocumentId={photoDocumentIds.secondary}
              documentsHref={documentsHref}
              value={state.secondApplicant}
              onChange={setApplicant('secondApplicant')}
              existingLast4={existingLast4?.secondary}
            />
          ) : null}
        </SheetSection>

        {/* --- Addresses ----------------------------------------------------- */}
        <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <AddressBlock
            title="Communication Address"
            value={state.communicationAddress}
            onChange={(p) =>
              patch({ communicationAddress: { ...state.communicationAddress, ...p } })
            }
          />
          <div>
            <AddressBlock
              title="Permanent Address"
              value={
                state.sameAsCommunication
                  ? state.communicationAddress
                  : state.permanentAddress
              }
              onChange={(p) =>
                patch({ permanentAddress: { ...state.permanentAddress, ...p } })
              }
              disabled={state.sameAsCommunication}
            />
            <label className="mt-2.5 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:border-dac-navy-300">
              <input
                type="checkbox"
                checked={state.sameAsCommunication}
                onChange={(e) => patch({ sameAsCommunication: e.target.checked })}
                className="h-4 w-4 rounded border-slate-400 text-dac-navy-700 focus:ring-dac-navy-500"
              />
              Same as communication address
            </label>
          </div>
        </div>

        {/* --- Property + payment -------------------------------------------- */}
        <div className="mb-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div>
            <SheetSection title="Property Details" className="mb-0 h-full">
              <TextField
                label="Built-up Area (Sq.Ft)"
                value={state.builtUpAreaSqft}
                onChange={(v) => patch({ builtUpAreaSqft: v })}
              />
              <TextField
                label="UDS (Sq.Ft.)"
                value={state.udsSqft}
                onChange={(v) => patch({ udsSqft: v })}
              />
              <TextField
                label="Floor"
                value={state.floor}
                onChange={(v) => patch({ floor: v })}
                maxLength={20}
              />
            </SheetSection>
          </div>

          <div className="lg:col-span-2">
            <SheetSection title="Payment Details" className="mb-0 h-full">
              <div className="grid gap-x-6 gap-y-3 grid-cols-1 sm:grid-cols-2">
                <TextField
                  label="Booking Advance"
                  value={state.bookingAdvance}
                  onChange={(v) => patch({ bookingAdvance: v })}
                  placeholder="5,00,000"
                />
                <TickGroup
                  label="Mode"
                  value={state.paymentMode}
                  onChange={(v) => patch({ paymentMode: v })}
                  options={[
                    { value: 'CHQ', label: 'Chq' },
                    { value: 'CARD', label: 'Card' },
                    { value: 'ONLINE', label: 'Online' },
                  ]}
                />
                <TextField
                  label="Ref. No."
                  value={state.paymentRefNo}
                  onChange={(v) => patch({ paymentRefNo: v })}
                />
                <TextField
                  label="Date"
                  type="date"
                  value={state.paymentDate}
                  onChange={(v) => patch({ paymentDate: v })}
                />
                <TextField
                  label="Bank"
                  value={state.bank}
                  onChange={(v) => patch({ bank: v })}
                />
                <TickGroup
                  label="Payment Source"
                  value={state.paymentSource}
                  onChange={(v) => patch({ paymentSource: v })}
                  options={[
                    { value: 'OWN_FUNDS', label: 'Own Funds' },
                    { value: 'HOME_LOAN', label: 'Home Loan' },
                  ]}
                />
              </div>

              <div className="mt-3 rounded-xl border border-dac-navy-100 bg-dac-navy-50/40 p-3.5">
                <TextField
                  label="Sale Price"
                  value={state.salePrice}
                  onChange={(v) => patch({ salePrice: v })}
                  placeholder="50,00,000"
                />
                <p className="-mt-1.5 text-[11px] font-medium text-slate-500 italic">
                  (Excluding GST &amp; Registration charges)
                </p>
              </div>
            </SheetSection>
          </div>
        </div>

        {/* --- Remarks -------------------------------------------------------- */}
        <SheetSection title="Remarks (if any)" className="mb-2">
          <textarea
            aria-label="Remarks"
            rows={3}
            maxLength={1000}
            placeholder="Enter any special allotment notes or payment schedule remarks…"
            value={state.remarks}
            onChange={(e) => patch({ remarks: e.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-slate-50/40 p-3 text-sm font-medium text-slate-900 transition focus:border-dac-navy-700 focus:bg-white focus:outline-none"
          />
        </SheetSection>
      </div>

      {/* Bottom Workflow Action Bar */}
      <div className="mt-6 mb-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs text-slate-600">
          <strong className="font-semibold text-slate-900">Mandatory KYC to submit:</strong>{' '}
          Passport Photo, PAN Card &amp; Aadhaar Card. Other documents can be uploaded anytime.
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href={documentsHref}
            className="inline-flex items-center gap-1.5 rounded-xl border border-dac-navy-200 bg-dac-navy-50 px-4 py-2.5 text-xs font-bold text-dac-navy-800 transition hover:bg-dac-navy-100"
          >
            <span>Step 2: Supporting Documents →</span>
          </Link>
          <Link
            href={`/forms/${formId}/review`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-dac-navy-800 to-dac-navy-700 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:from-dac-navy-900 hover:to-dac-navy-800"
          >
            <span>Step 3: Review &amp; Submit →</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
