import type { Metadata } from 'next';
import Link from 'next/link';
import type { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/rbac';
import { PageHeader, EmptyState } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'Audit trail' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/**
 * The audit trail.
 *
 * Append-only by design, so this is a reader and nothing else — there is no
 * edit or delete here, and a later migration revokes UPDATE and DELETE on the
 * table so even a compromised application role cannot rewrite history.
 *
 * Safe to show in full. PAN and Aadhaar never reach these rows: `redact()`
 * strips them on the way in and is unit tested, because a leak here would be
 * the kind that survives in a table nobody re-reads for months.
 */

/** Grouped so a filter reads as a question rather than a list of constants. */
const ACTION_GROUPS: Array<{ label: string; actions: AuditAction[] }> = [
  { label: 'Signing', actions: ['SIGN', 'VALIDATE', 'RETURN', 'SUBMIT'] },
  { label: 'Editing', actions: ['CREATE', 'EDIT', 'UPLOAD', 'CANCEL'] },
  { label: 'Sensitive access', actions: ['VIEW_SENSITIVE', 'PDF', 'EXPORT'] },
  { label: 'Accounts', actions: ['LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_RESET'] },
  { label: 'System', actions: ['REASSIGN', 'SYNC'] },
];

const ACTION_STYLE: Partial<Record<AuditAction, string>> = {
  VIEW_SENSITIVE: 'bg-red-50 text-red-800',
  LOGIN_FAILED: 'bg-red-50 text-red-800',
  SIGN: 'bg-green-50 text-green-800',
  VALIDATE: 'bg-green-50 text-green-800',
  SUBMIT: 'bg-blue-50 text-blue-800',
  RETURN: 'bg-amber-50 text-amber-900',
  PDF: 'bg-indigo-50 text-indigo-800',
};

function formatIst(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Kolkata',
  }).format(d);
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; q?: string; page?: string }>;
}) {
  const { group, q, page } = await searchParams;
  const user = await requireAdmin();

  const currentPage = Math.min(10_000, Math.max(1, Number.parseInt(page ?? '1', 10) || 1));
  const selected = ACTION_GROUPS.find((g) => g.label === group);
  const search = (q?.trim() ?? '').slice(0, 120);

  const where: Prisma.AuditLogWhereInput = {
    organizationId: user.organizationId,
    ...(selected ? { action: { in: selected.actions } } : {}),
    ...(search
      ? {
          OR: [
            { detail: { contains: search, mode: 'insensitive' } },
            { bookingForm: { bookingId: { contains: search, mode: 'insensitive' } } },
            { user: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [total, entries] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { at: 'desc' },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: { select: { name: true, email: true } },
        bookingForm: { select: { id: true, bookingId: true } },
      },
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const linkFor = (next: { group?: string; q?: string; page?: number }): string => {
    const params = new URLSearchParams();
    const g = next.group ?? group;
    const query = next.q ?? search;
    if (g) params.set('group', g);
    if (query) params.set('q', query);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    const qs = params.toString();
    return qs ? `/admin/audit?${qs}` : '/admin/audit';
  };

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Append-only. Every signature, upload, sensitive view and login is here. PAN and Adhaar values are never recorded."
      />

      {/* --- filters ------------------------------------------------------ */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href={linkFor({ group: '', page: 1 })}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
            selected
              ? 'border-gray-300 text-gray-700 hover:bg-gray-50'
              : 'border-dac-navy-700 bg-dac-navy-700 text-white'
          }`}
        >
          Everything
        </Link>
        {ACTION_GROUPS.map((g) => (
          <Link
            key={g.label}
            href={linkFor({ group: g.label, page: 1 })}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
              selected?.label === g.label
                ? 'border-dac-navy-700 bg-dac-navy-700 text-white'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {g.label}
          </Link>
        ))}

        <form method="get" className="ml-auto flex items-center gap-2">
          {group ? <input type="hidden" name="group" value={group} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Booking ID, person, or detail"
            className="w-56 rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-900 focus:border-dac-navy-500 focus:ring-1 focus:ring-dac-navy-500"
          />
          <button
            type="submit"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Search
          </button>
        </form>
      </div>

      {entries.length === 0 ? (
        <EmptyState>
          {search || selected
            ? 'Nothing matches that filter.'
            : 'No audit entries yet. They appear as soon as anyone acts on a booking.'}
        </EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">When (IST)</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Who</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Action</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Booking</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-2 whitespace-nowrap text-xs tabular-nums text-gray-600">
                      {formatIst(entry.at)}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-900">
                      {entry.user?.name ?? <span className="text-gray-400">system</span>}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          ACTION_STYLE[entry.action] ?? 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {entry.action.replace(/_/g, ' ').toLowerCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {entry.bookingForm ? (
                        <Link
                          href={`/forms/${entry.bookingForm.id}`}
                          className="text-dac-navy-700 underline underline-offset-2"
                        >
                          {entry.bookingForm.bookingId ?? 'draft'}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600">{entry.detail ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-gray-600">
            <span>
              {total.toLocaleString('en-IN')} entr{total === 1 ? 'y' : 'ies'} · page{' '}
              {currentPage} of {pages}
            </span>
            <div className="flex gap-2">
              {currentPage > 1 ? (
                <Link
                  href={linkFor({ page: currentPage - 1 })}
                  className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Previous
                </Link>
              ) : null}
              {currentPage < pages ? (
                <Link
                  href={linkFor({ page: currentPage + 1 })}
                  className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Next
                </Link>
              ) : null}
            </div>
          </div>
        </>
      )}
    </>
  );
}
