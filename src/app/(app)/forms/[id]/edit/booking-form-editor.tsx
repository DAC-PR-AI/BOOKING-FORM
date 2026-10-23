'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  value,
  onChange,
}: {
  title: string;
  photoCaption: string;
  value: ApplicantState;
  onChange: (patch: Partial<ApplicantState>) => void;
}) {
  const set = <K extends keyof ApplicantState>(key: K) => (v: ApplicantState[K]) =>
    onChange({ [key]: v } as Partial<ApplicantState>);

  return (
    <div className="mb-4 border border-gray-400 bg-white p-4">
      <h3 className="mb-3 text-[13px] font-bold tracking-wide text-gray-700 uppercase">
        {title}
      </h3>

      <div className="flex flex-col gap-4 sm:flex-row">
        <PhotoBox caption={photoCaption} />

        <div className="min-w-0 flex-1">
          <div className="grid gap-x-6 sm:grid-cols-2">
            <div className="flex gap-2">
              <div className="w-24 shrink-0">
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

            <div className="flex gap-2">
              <div className="w-32 shrink-0">
                <SelectField
                  label="Son / Daughter / Wife of"
                  value={value.relationType ?? ''}
                  onChange={set('relationType')}
                  options={RELATIONS}
                  placeholder="—"
                />
              </div>
              <div className="w-20 shrink-0">
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

          <div className="grid gap-x-6 sm:grid-cols-2">
            <Field label="Mobile No">
              <BoxInput
                label="Mobile number"
                length={10}
                value={value.mobileNo ?? ''}
                onChange={set('mobileNo')}
              />
            </Field>

            <Field label="Alternate Mobile No">
              <BoxInput
                label="Alternate mobile number"
                length={10}
                value={value.altMobileNo ?? ''}
                onChange={set('altMobileNo')}
              />
            </Field>
          </div>

          <div className="grid gap-x-6 sm:grid-cols-2">
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
              hint="Format AAAAA9999A"
            />
          </div>

          <div className="grid gap-x-6 sm:grid-cols-2">
            {/* Paper spells it "Adhaar" — reproduced verbatim. */}
            <Field label="Adhaar No">
              <BoxInput
                label="Adhaar number"
                length={12}
                value={value.aadhaar ?? ''}
                onChange={set('aadhaar')}
              />
            </Field>

            <Field label="D.O.B (DD/MM/YYYY)">
              <div className="flex flex-wrap items-center gap-3">
                <BoxInput
                  label="Date of birth"
                  length={8}
                  groups={[2, 2, 4]}
                  value={dobToDigits(value.dob ?? '')}
                  onChange={(digits) => onChange({ dob: digitsToDob(digits) })}
                />
                <input
                  type="date"
                  aria-label="Date of birth, date picker"
                  value={value.dob ?? ''}
                  onChange={(e) => onChange({ dob: e.target.value })}
                  className="border-b border-gray-400 bg-transparent py-1 text-xs focus:border-dac-navy-600 focus:outline-none"
                />
              </div>
            </Field>
          </div>

          <div className="grid gap-x-6 sm:grid-cols-2">
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
    <div className="flex-1 border border-gray-400 bg-white p-4">
      <h3 className="mb-3 text-[13px] font-bold tracking-wide text-gray-700 uppercase">
        {title}
      </h3>
      {([1, 2, 3, 4] as const).map((n) => {
        const key = `line${n}` as keyof AddressState;
        return (
          <input
            key={n}
            aria-label={`${title} line ${n}`}
            value={value[key] ?? ''}
            disabled={disabled}
            maxLength={100}
            onChange={(e) => onChange({ [key]: e.target.value } as Partial<AddressState>)}
            className="mb-3 w-full border-0 border-b border-gray-400 bg-transparent px-1 py-1 text-sm focus:border-dac-navy-600 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500"
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
  readOnly = false,
}: {
  formId: string;
  initial: EditorState;
  projects: Array<{ value: string; label: string }>;
  sources: Array<{ value: string; label: string }>;
  readOnly?: boolean;
}) {
  const [state, setState] = useState<EditorState>(initial);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  const patch = useCallback((p: Partial<EditorState>) => {
    dirty.current = true;
    setState((s) => ({ ...s, ...p }));
  }, []);

  const persist = useCallback(
    async (current: EditorState) => {
      setStatus('saving');
      const result = await saveDraft(formId, {
        ...current,
        secondApplicant: current.hasSecondApplicant ? current.secondApplicant : undefined,
        permanentAddress: current.sameAsCommunication
          ? current.communicationAddress
          : current.permanentAddress,
      });
      if (result.ok) {
        setStatus('saved');
        setMessage(
          new Date(result.savedAt).toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
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

  // Debounced autosave. The brief is explicit: no data loss on refresh.
  useEffect(() => {
    if (readOnly || !dirty.current) return;
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

  return (
    <div className="mx-auto max-w-4xl">
      {/* Save indicator */}
      <div className="sticky top-0 z-10 mb-4 flex items-center justify-between border border-gray-300 bg-white px-4 py-2 text-xs shadow-sm">
        <span className="font-medium text-gray-700">Booking Form — draft</span>
        <span aria-live="polite" className="text-gray-600">
          {status === 'saving' ? 'Saving…' : null}
          {status === 'saved' ? `All changes saved at ${message}` : null}
          {status === 'error' ? (
            <span className="font-medium text-red-700">{message}</span>
          ) : null}
          {status === 'idle' ? 'Changes save automatically' : null}
        </span>
      </div>

      {/* --- Header block ------------------------------------------------- */}
      <SheetSection>
        <div className="grid gap-x-6 sm:grid-cols-3">
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
            <p className="border-b border-gray-300 py-1 text-sm text-gray-500 italic">
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
          value={state.firstApplicant}
          onChange={setApplicant('firstApplicant')}
        />

        <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={state.hasSecondApplicant}
            onChange={(e) => patch({ hasSecondApplicant: e.target.checked })}
            className="h-4 w-4 border-gray-500 text-dac-navy-700 focus:ring-dac-navy-500"
          />
          This booking has a second applicant
        </label>

        {state.hasSecondApplicant ? (
          <ApplicantBlock
            title="Co / Second Applicant"
            photoCaption="Photo of Co / Second Applicant"
            value={state.secondApplicant}
            onChange={setApplicant('secondApplicant')}
          />
        ) : null}
      </SheetSection>

      {/* --- Addresses ----------------------------------------------------- */}
      <div className="mb-5 flex flex-col gap-4 sm:flex-row">
        <AddressBlock
          title="Communication Address"
          value={state.communicationAddress}
          onChange={(p) =>
            patch({ communicationAddress: { ...state.communicationAddress, ...p } })
          }
        />
        <div className="flex-1">
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
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={state.sameAsCommunication}
              onChange={(e) => patch({ sameAsCommunication: e.target.checked })}
              className="h-4 w-4 border-gray-500 text-dac-navy-700 focus:ring-dac-navy-500"
            />
            Same as communication address
          </label>
        </div>
      </div>

      {/* --- Property + payment -------------------------------------------- */}
      <div className="mb-5 flex flex-col gap-4 sm:flex-row">
        <div className="flex-1">
          <SheetSection title="Property Details">
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

        <div className="flex-[2]">
          <SheetSection title="Payment Details">
            <div className="grid gap-x-6 sm:grid-cols-2">
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

            <div className="mt-2 border-t border-gray-300 pt-3">
              <TextField
                label="Sale Price"
                value={state.salePrice}
                onChange={(v) => patch({ salePrice: v })}
                placeholder="50,00,000"
              />
              {/* Printed on the paper — reproduced verbatim. */}
              <p className="-mt-2 text-[11px] text-gray-500 italic">
                (Excluding GST &amp; Registration charges)
              </p>
            </div>
          </SheetSection>
        </div>
      </div>

      {/* --- Remarks -------------------------------------------------------- */}
      <SheetSection title="Remarks (if any)">
        <textarea
          aria-label="Remarks"
          rows={3}
          maxLength={1000}
          value={state.remarks}
          onChange={(e) => patch({ remarks: e.target.value })}
          className="w-full border border-gray-300 bg-transparent p-2 text-sm focus:border-dac-navy-600 focus:outline-none"
        />
      </SheetSection>

      <p className="mb-10 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <strong className="font-semibold">Phase 2 of 8.</strong> The form saves as a draft
        automatically. Supporting documents arrive in Phase 3, and submission into the
        signature flow in Phase 4.
      </p>
    </div>
  );
}
