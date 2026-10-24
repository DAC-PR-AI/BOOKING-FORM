'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { compressImage, formatBytes, sha256Hex } from '@/lib/images/compress';
import {
  confirmDocumentUpload,
  removeDocument,
  requestDocumentUpload,
} from './actions';

/**
 * The supporting-document checklist.
 *
 * It reads as the tick-list printed on the paper form — one row per document,
 * in the same order, with the mandatory ones marked. The brief is explicit
 * that the digital form should read like the paper one, so this is a list of
 * named slots, not a general-purpose file manager with a drop zone.
 *
 * Each row owns its own upload state. One failing row must not blank out the
 * others, and a slow photo upload must not stop someone attaching the cost
 * sheet in the meantime.
 */

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

/**
 * Uploads with XHR rather than fetch purely for `upload.onprogress` — on a
 * site connection a 3 MB photo is a long silence otherwise, and silence reads
 * as a broken page.
 */
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
  slots,
  progress,
}: {
  bookingFormId: string;
  editable: boolean;
  slots: SlotView[];
  progress: ProgressView;
}) {
  return (
    <div className="space-y-4">
      <ProgressBanner progress={progress} />

      <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {slots.map((slot) => (
          <DocumentRow
            key={slot.typeId}
            bookingFormId={bookingFormId}
            editable={editable}
            slot={slot}
          />
        ))}
      </ul>
    </div>
  );
}

function ProgressBanner({ progress }: { progress: ProgressView }) {
  const { requiredSatisfied, requiredTotal, complete, missing } = progress;

  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm ${
        complete
          ? 'border-green-200 bg-green-50 text-green-900'
          : 'border-gray-200 bg-white text-gray-700'
      }`}
    >
      <p className="font-medium">
        {complete
          ? `All ${requiredTotal} required documents are attached.`
          : `${requiredSatisfied} of ${requiredTotal} required documents attached.`}
      </p>
      {!complete && missing.length > 0 ? (
        <p className="mt-1 text-gray-600">Still needed: {missing.join(', ')}.</p>
      ) : null}
      {progress.optionalUploaded > 0 ? (
        <p className="mt-1 text-gray-600">
          Plus {progress.optionalUploaded} optional{' '}
          {progress.optionalUploaded === 1 ? 'document' : 'documents'}.
        </p>
      ) : null}
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
      // Shrink photographs before anything else, so the size the server is
      // asked to authorise is the size actually sent.
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
      // Let the same file be picked again after a failure.
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
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">
          {slot.label}
          {suffix ? <span className="font-normal text-gray-500"> — {suffix}</span> : null}
          {slot.required ? (
            <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
              Required
            </span>
          ) : (
            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
              Optional
            </span>
          )}
        </p>

        {slot.helpText ? (
          <p className="mt-1 text-xs text-gray-500">{slot.helpText}</p>
        ) : null}

        {slot.document ? (
          <p className="mt-2 truncate text-xs text-gray-600">
            <a
              href={`/api/documents/${slot.document.id}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-dac-navy-700 underline underline-offset-2"
            >
              {slot.document.originalName}
            </a>{' '}
            · {formatBytes(slot.document.sizeBytes)}
          </p>
        ) : (
          <p className="mt-2 text-xs text-gray-400">
            Nothing attached · {describeTypes(slot.acceptedMimeTypes)} · up to {maxMb} MB
          </p>
        )}

        {state.kind === 'error' ? (
          <p role="alert" className="mt-2 text-xs font-medium text-red-700">
            {state.message}
          </p>
        ) : null}

        {state.kind === 'uploading' ? (
          <div className="mt-2 flex items-center gap-2">
            <div
              className="h-1.5 w-32 overflow-hidden rounded-full bg-gray-200"
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
            <span className="text-xs text-gray-500">{state.percent}%</span>
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
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            {busyLabel(state) ?? (slot.document ? 'Replace' : 'Upload')}
          </button>

          {slot.document ? (
            <button
              type="button"
              disabled={busy || isRemoving}
              onClick={() => handleRemove(slot.document!.id)}
              className="rounded-md border border-transparent px-2 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
            >
              {isRemoving ? 'Removing…' : 'Remove'}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function busyLabel(state: RowState): string | null {
  if (state.kind === 'preparing') return 'Preparing…';
  if (state.kind === 'uploading') return 'Uploading…';
  if (state.kind === 'saving') return 'Saving…';
  return null;
}

/** "a JPEG, PNG or PDF" — the picker's filter said in words, for the hint line. */
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
