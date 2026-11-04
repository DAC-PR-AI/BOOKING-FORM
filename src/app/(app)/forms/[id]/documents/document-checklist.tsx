'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { compressImage, formatBytes, sha256Hex } from '@/lib/images/compress';
import {
  confirmDocumentUpload,
  removeDocument,
  requestDocumentUpload,
} from './actions';

export type SlotView = {
  typeId: string;
  typeKey: string;
  label: string;
  helpText: string | null;
  appliesTo: 'PRIMARY' | 'SECONDARY' | null;
  acceptedMimeTypes: string[];
  maxBytes: number;
  required: boolean;
  document: {
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: string;
  } | null;
};

export type ProgressView = {
  requiredTotal: number;
  requiredSatisfied: number;
  optionalUploaded: number;
  missing: string[];
  complete: boolean;
};

type RowState =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'uploading'; percent: number }
  | { kind: 'saving' }
  | { kind: 'error'; message: string };

function applicantSuffix(appliesTo: 'PRIMARY' | 'SECONDARY' | null): string | null {
  if (appliesTo === 'PRIMARY') return '1st applicant';
  if (appliesTo === 'SECONDARY') return '2nd applicant';
  return null;
}

function putWithProgress(
  url: string,
  method: 'PUT',
  headers: Record<string, string>,
  body: Blob,
  onProgress: (percent: number) => void,
): Promise<{ ok: boolean; status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () =>
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        body: xhr.responseText,
      });
    xhr.onerror = () => reject(new Error('The network dropped during the upload.'));
    xhr.ontimeout = () => reject(new Error('The upload timed out.'));
    xhr.send(body);
  });
}

export function DocumentChecklist({
  bookingFormId,
  editable,
  canUploadAnytime = editable,
  slots,
  progress,
}: {
  bookingFormId: string;
  editable: boolean;
  canUploadAnytime?: boolean;
  slots: SlotView[];
  progress: ProgressView;
}) {
  return (
    <div className="space-y-5">
      <ProgressBanner progress={progress} />

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
        {slots.map((slot) => {
          const rowEditable = slot.required
            ? editable || (!slot.document && canUploadAnytime)
            : canUploadAnytime;

          return (
            <DocumentRow
              key={slot.typeId}
              bookingFormId={bookingFormId}
              editable={rowEditable}
              slot={slot}
            />
          );
        })}
      </ul>
    </div>
  );
}

function ProgressBanner({ progress }: { progress: ProgressView }) {
  const { requiredSatisfied, requiredTotal, complete, missing } = progress;
  const percent =
    requiredTotal > 0 ? Math.min(100, Math.round((requiredSatisfied / requiredTotal) * 100)) : 100;

  return (
    <div
      className={`rounded-2xl border p-5 text-sm shadow-2xs ${
        complete
          ? 'border-emerald-200 bg-emerald-50/80 text-emerald-950'
          : 'border-slate-200 bg-white text-slate-800'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold">
          {complete
            ? `All ${requiredTotal} mandatory KYC documents (Photo, PAN & Aadhaar) are attached — ready to submit.`
            : `${requiredSatisfied} of ${requiredTotal} mandatory KYC documents attached (Photo, PAN & Aadhaar are required to create/submit).`}
        </p>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${
            complete ? 'bg-emerald-600 text-white' : 'bg-dac-navy-50 text-dac-navy-800'
          }`}
        >
          {requiredSatisfied}/{requiredTotal} KYC
        </span>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200/80" aria-hidden="true">
        <div
          className={`h-full transition-all duration-300 ${
            complete ? 'bg-emerald-600' : 'bg-dac-navy-700'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {!complete && missing.length > 0 ? (
        <p className="mt-2.5 text-xs font-medium text-slate-600">
          Still needed before submitting: <strong className="text-slate-900">{missing.join(', ')}</strong>.
        </p>
      ) : null}
      <p className="mt-1.5 text-xs text-slate-500">
        All other documents (1st payment screenshot, simple cost sheet, mail, discount cost sheet)
        can be uploaded now or at any time later.
        {progress.optionalUploaded > 0
          ? ` (${progress.optionalUploaded} additional ${
              progress.optionalUploaded === 1 ? 'document' : 'documents'
            } attached)`
          : ''}
      </p>
    </div>
  );
}

function DocumentRow({
  bookingFormId,
  editable,
  slot,
}: {
  bookingFormId: string;
  editable: boolean;
  slot: SlotView;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<RowState>({ kind: 'idle' });
  const [isRemoving, startRemoving] = useTransition();

  const busy = state.kind === 'preparing' || state.kind === 'uploading' || state.kind === 'saving';
  const suffix = applicantSuffix(slot.appliesTo);
  const maxMb = Math.floor(slot.maxBytes / (1024 * 1024));

  async function handleFile(picked: File): Promise<void> {
    setState({ kind: 'preparing' });

    try {
      const { file } = await compressImage(picked);

      if (!slot.acceptedMimeTypes.includes(file.type.toLowerCase())) {
        setState({
          kind: 'error',
          message: `This slot accepts ${describeTypes(slot.acceptedMimeTypes)}.`,
        });
        return;
      }

      if (file.size > slot.maxBytes) {
        setState({
          kind: 'error',
          message: `That file is ${formatBytes(file.size)}, over the ${maxMb} MB limit.`,
        });
        return;
      }

      const digest = await sha256Hex(file);

      const requested = await requestDocumentUpload({
        bookingFormId,
        documentTypeId: slot.typeId,
        contentType: file.type.toLowerCase(),
        sizeBytes: file.size,
      });
      if (!requested.ok) {
        setState({ kind: 'error', message: requested.error });
        return;
      }

      setState({ kind: 'uploading', percent: 0 });

      const sent = await putWithProgress(
        requested.ticket.url,
        requested.ticket.method,
        requested.ticket.headers,
        file,
        (percent) => setState({ kind: 'uploading', percent }),
      );

      if (!sent.ok) {
        setState({
          kind: 'error',
          message:
            sent.status === 413
              ? `That file is over the ${maxMb} MB limit.`
              : 'The upload failed. Please try again.',
        });
        return;
      }

      setState({ kind: 'saving' });

      const confirmed = await confirmDocumentUpload({
        token: requested.ticket.token,
        originalName: picked.name,
        ...(digest ? { sha256: digest } : {}),
      });
      if (!confirmed.ok) {
        setState({ kind: 'error', message: confirmed.error });
        return;
      }

      setState({ kind: 'idle' });
      router.refresh();
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function handleRemove(documentId: string): void {
    startRemoving(async () => {
      const result = await removeDocument(documentId);
      if (!result.ok) {
        setState({ kind: 'error', message: result.error });
        return;
      }
      setState({ kind: 'idle' });
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-3 px-5 py-4 transition hover:bg-slate-50/70 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
          <span
            aria-hidden="true"
            className={`inline-block h-2 w-2 rounded-full ${
              slot.document
                ? 'bg-emerald-500'
                : slot.required
                  ? 'bg-amber-500'
                  : 'bg-slate-300'
            }`}
          />
          <span>
            {slot.label}
            {suffix ? <span className="font-normal text-slate-500"> — {suffix}</span> : null}
          </span>
          {slot.required ? (
            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
              Mandatory
            </span>
          ) : (
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
              Upload anytime
            </span>
          )}
          {slot.document ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
              ✓ Attached
            </span>
          ) : null}
        </p>

        {slot.helpText ? (
          <p className="mt-1 text-xs text-slate-500">{slot.helpText}</p>
        ) : null}

        {slot.document ? (
          <p className="mt-2 truncate text-xs text-slate-600">
            <a
              href={`/api/documents/${slot.document.id}`}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-dac-navy-700 underline underline-offset-2 hover:text-dac-orange-600"
            >
              {slot.document.originalName}
            </a>{' '}
            · {formatBytes(slot.document.sizeBytes)}
          </p>
        ) : (
          <p className="mt-2 text-xs text-slate-400">
            Nothing attached · {describeTypes(slot.acceptedMimeTypes)} · up to {maxMb} MB
          </p>
        )}

        {state.kind === 'error' ? (
          <p role="alert" className="mt-2 text-xs font-semibold text-red-600">
            {state.message}
          </p>
        ) : null}

        {state.kind === 'uploading' ? (
          <div className="mt-2 flex items-center gap-2">
            <div
              className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-200"
              role="progressbar"
              aria-valuenow={state.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Uploading ${slot.label}`}
            >
              <div
                className="h-full bg-dac-navy-700 transition-[width]"
                style={{ width: `${state.percent}%` }}
              />
            </div>
            <span className="text-xs font-medium text-slate-500">{state.percent}%</span>
          </div>
        ) : null}
      </div>

      {editable ? (
        <div className="flex shrink-0 items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={slot.acceptedMimeTypes.join(',')}
            className="hidden"
            aria-label={`Choose a file for ${slot.label}${suffix ? ` (${suffix})` : ''}`}
            onChange={(event) => {
              const picked = event.target.files?.[0];
              if (picked) void handleFile(picked);
            }}
          />

          <button
            type="button"
            disabled={busy || isRemoving}
            onClick={() => inputRef.current?.click()}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold shadow-2xs transition disabled:opacity-50 ${
              slot.document
                ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                : 'bg-dac-navy-700 text-white hover:bg-dac-navy-900'
            }`}
          >
            {busyLabel(state) ?? (slot.document ? 'Replace' : 'Upload')}
          </button>

          {slot.document ? (
            <button
              type="button"
              disabled={busy || isRemoving}
              onClick={() => handleRemove(slot.document!.id)}
              className="rounded-xl border border-transparent px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
            >
              {isRemoving ? 'Removing…' : 'Remove'}
            </button>
          ) : null}
        </div>
      ) : (
        <span className="shrink-0 self-center rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
          Locked
        </span>
      )}
    </li>
  );
}

function busyLabel(state: RowState): string | null {
  if (state.kind === 'preparing') return 'Preparing…';
  if (state.kind === 'uploading') return 'Uploading…';
  if (state.kind === 'saving') return 'Saving…';
  return null;
}

function describeTypes(mimeTypes: string[]): string {
  const names = mimeTypes.map((mime) => {
    if (mime === 'application/pdf') return 'PDF';
    if (mime === 'image/jpeg') return 'JPEG';
    if (mime === 'image/png') return 'PNG';
    if (mime === 'image/webp') return 'WebP';
    if (mime === 'image/heic') return 'HEIC';
    return mime;
  });
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique[0] ?? 'any file';
  return `${unique.slice(0, -1).join(', ')} or ${unique[unique.length - 1]}`;
}
