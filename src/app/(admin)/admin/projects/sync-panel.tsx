'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { SyncOutcome, SyncStatus } from '@/lib/projects/sync';
import { previewProjectSync, syncProjectsNow } from './sync-actions';

/**
 * The project-sheet panel on the admin screen.
 *
 * "Preview" exists because a sync can **deactivate** projects — a row removed
 * from the sheet disappears from the booking dropdown — and an admin should be
 * able to see that coming rather than discover it from a sales executive who
 * cannot find a project. Preview runs the same plan and writes nothing.
 */
export function SyncPanel({ status }: { status: SyncStatus }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  const [wasPreview, setWasPreview] = useState(false);
  const [isPending, startTransition] = useTransition();

  function run(preview: boolean): void {
    setOutcome(null);
    setWasPreview(preview);

    startTransition(async () => {
      const result = preview ? await previewProjectSync() : await syncProjectsNow();
      setOutcome(result);
      if (!preview && result.ok) router.refresh();
    });
  }

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Google Sheet</h2>
          {status.configured ? (
            <p className="mt-1 text-xs text-gray-600">
              Reading the <strong>{status.tab}</strong> tab of{' '}
              {status.sheetLink ? (
                <a
                  href={status.sheetLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-dac-navy-700 underline underline-offset-2"
                >
                  the project sheet
                </a>
              ) : (
                'the project sheet'
              )}
              . {status.syncedProjects} synced, {status.handAddedProjects} added by hand,{' '}
              {status.activeProjects} active.
              {status.lastSyncedAt ? (
                <>
                  {' '}
                  Last sync{' '}
                  {new Intl.DateTimeFormat('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'Asia/Kolkata',
                  }).format(new Date(status.lastSyncedAt))}
                  .
                </>
              ) : (
                ' Never synced.'
              )}
            </p>
          ) : (
            <p className="mt-1 text-xs text-gray-600">
              Not configured. Projects added here work exactly as they do now — the sync is
              optional, and the booking form always reads this list, never Google.
            </p>
          )}
        </div>

        {status.configured ? (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => run(true)}
              disabled={isPending}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
            >
              {isPending && wasPreview ? 'Checking…' : 'Preview'}
            </button>
            <button
              type="button"
              onClick={() => run(false)}
              disabled={isPending}
              className="rounded-md bg-dac-navy-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-dac-navy-900 disabled:opacity-50"
            >
              {isPending && !wasPreview ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        ) : null}
      </div>

      {outcome ? (
        <div
          className={`mt-3 rounded-md border px-3 py-2 text-xs ${
            outcome.ok
              ? 'border-green-200 bg-green-50 text-green-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {outcome.ok ? (
            <>
              <p className="font-medium">
                {wasPreview ? 'This sync would:' : 'Synced:'} {outcome.created} added,{' '}
                {outcome.updated} updated, {outcome.unchanged} unchanged,{' '}
                {outcome.deactivated} deactivated.
              </p>

              {outcome.deactivated > 0 ? (
                <p className="mt-1">
                  Deactivated projects disappear from the booking dropdown but keep resolving
                  for existing bookings — nothing is deleted.
                </p>
              ) : null}

              {outcome.derivedCodes ? (
                <p className="mt-1">
                  <strong>The sheet has no code column.</strong> Codes were derived from the
                  names, so renaming a project in the sheet will create a new entry rather
                  than renaming the existing one. Adding a code column avoids that.
                </p>
              ) : null}

              {outcome.problems.length > 0 ? (
                <details className="mt-1">
                  <summary className="cursor-pointer font-medium">
                    {outcome.problems.length} row
                    {outcome.problems.length === 1 ? '' : 's'} skipped
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {outcome.problems.map((problem) => (
                      <li key={problem.sourceRow}>
                        Row {problem.sourceRow}: {problem.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : (
            <p>{outcome.error}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
