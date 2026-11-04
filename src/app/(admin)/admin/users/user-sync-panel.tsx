'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { UserSyncOutcome, UserSyncStatus } from '@/lib/users/sync';
import { previewUserSync, syncUsersNow } from './sync-actions';

export function UserSyncPanel({ status }: { status: UserSyncStatus }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<UserSyncOutcome | null>(null);
  const [wasPreview, setWasPreview] = useState(false);
  const [isPending, startTransition] = useTransition();

  function run(preview: boolean): void {
    setOutcome(null);
    setWasPreview(preview);

    startTransition(async () => {
      const result = preview ? await previewUserSync() : await syncUsersNow();
      setOutcome(result);
      if (!preview && result.ok) router.refresh();
    });
  }

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-100 text-xs font-bold text-emerald-800">
              📊
            </span>
            <h2 className="text-sm font-bold text-slate-900">Google Sheet User & Role Sync</h2>
          </div>
          {status.configured ? (
            <p className="mt-1 text-xs text-slate-600">
              Reading the <strong className="text-slate-800">{status.tab}</strong> tab of{' '}
              {status.sheetLink ? (
                <a
                  href={status.sheetLink}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-dac-navy-700 underline underline-offset-2 hover:text-dac-navy-900"
                >
                  the master spreadsheet ↗
                </a>
              ) : (
                'the master spreadsheet'
              )}
              . {status.activeUsers} active / {status.totalUsers} total staff in system.
              {status.lastSyncedAt ? (
                <>
                  {' '}
                  Last sync:{' '}
                  <span className="font-medium text-slate-700">
                    {new Intl.DateTimeFormat('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'Asia/Kolkata',
                    }).format(new Date(status.lastSyncedAt))}
                  </span>
                </>
              ) : (
                ' Not yet synced.'
              )}
            </p>
          ) : (
            <p className="mt-1 text-xs text-amber-700">
              Google Sheets sync is not configured. Set <code className="font-mono text-xs">GOOGLE_USERS_SHEET_ID</code> in <code className="font-mono text-xs">.env</code>.
            </p>
          )}
        </div>

        {status.configured && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(true)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-50"
            >
              {isPending && wasPreview ? 'Checking...' : 'Preview Changes'}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(false)}
              className="rounded-lg bg-dac-navy-800 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-dac-navy-900 disabled:opacity-50"
            >
              {isPending && !wasPreview ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        )}
      </div>

      {outcome && (
        <div
          role="status"
          className={`mt-4 rounded-lg border p-3.5 text-xs ${
            outcome.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
              : 'border-rose-200 bg-rose-50 text-rose-950'
          }`}
        >
          {outcome.ok ? (
            <div>
              <p className="font-bold">
                {wasPreview ? 'Preview results (no changes saved):' : 'Sync completed successfully:'}
              </p>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-slate-700">
                <li>
                  <strong className="text-emerald-800">{outcome.created}</strong> new user accounts created
                </li>
                <li>
                  <strong className="text-blue-800">{outcome.updated}</strong> user records & roles updated
                </li>
                <li>
                  <strong>{outcome.unchanged}</strong> records already up to date
                </li>
                {outcome.deactivated > 0 && (
                  <li>
                    <strong className="text-rose-800">{outcome.deactivated}</strong> users marked inactive (sessions revoked)
                  </li>
                )}
              </ul>

              {outcome.problems.length > 0 && (
                <div className="mt-3 border-t border-emerald-200 pt-2 text-amber-900">
                  <p className="font-bold">Warnings on {outcome.problems.length} row(s):</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {outcome.problems.map((p, i) => (
                      <li key={i}>{p.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="font-medium">Sync failed: {outcome.error}</p>
          )}
        </div>
      )}
    </section>
  );
}

