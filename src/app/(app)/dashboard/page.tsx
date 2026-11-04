import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/rbac';
import { pendingForUserWhere } from '@/lib/flow/queue';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

type TileAccent = 'navy' | 'amber' | 'red' | 'emerald' | 'slate';

const ACCENT_STYLES: Record<
  TileAccent,
  { bar: string; badgeBg: string; badgeText: string; ring: string }
> = {
  navy: {
    bar: 'bg-dac-navy-700',
    badgeBg: 'bg-dac-navy-50',
    badgeText: 'text-dac-navy-700',
    ring: 'hover:border-dac-navy-400',
  },
  amber: {
    bar: 'bg-amber-500',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-800',
    ring: 'hover:border-amber-400',
  },
  red: {
    bar: 'bg-red-500',
    badgeBg: 'bg-red-50',
    badgeText: 'text-red-700',
    ring: 'hover:border-red-400',
  },
  emerald: {
    bar: 'bg-emerald-500',
    badgeBg: 'bg-emerald-50',
    badgeText: 'text-emerald-700',
    ring: 'hover:border-emerald-400',
  },
  slate: {
    bar: 'bg-slate-400',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-700',
    ring: 'hover:border-slate-400',
  },
};

function Tile({
  label,
  sublabel,
  value,
  href,
  accent = 'navy',
}: {
  label: string;
  sublabel?: string;
  value: number;
  href?: string;
  accent?: TileAccent;
}) {
  const style = ACCENT_STYLES[accent];
  const body = (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${style.ring}`}
    >
      <div className={`absolute inset-x-0 top-0 h-1 ${style.bar}`} aria-hidden="true" />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-3xl font-bold tracking-tight tabular-nums text-slate-900">
            {value}
          </p>
          <p className="mt-1.5 text-sm font-semibold text-slate-800">{label}</p>
          {sublabel ? <p className="mt-0.5 text-xs text-slate-500">{sublabel}</p> : null}
        </div>
        <span
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${style.badgeBg} ${style.badgeText} transition group-hover:scale-105`}
          aria-hidden="true"
        >
          →
        </span>
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function DashboardPage() {
  const user = await requireUser();
  const isCreator = user.role.name === 'SALES_EXECUTIVE';
  const isAdmin = user.role.name === 'ADMIN';
  const isCoordinator = user.role.name === 'SALES_COORDINATOR';

  // Creators see their own forms; admins see the whole organisation;
  // signatories see what is pending on them (either pinned or role-claimable).
  const [drafts, inReview, returned, completed, pendingOnMe] = await Promise.all([
    prisma.bookingForm.count({
      where: {
        organizationId: user.organizationId,
        status: 'DRAFT',
        ...(isAdmin ? {} : { createdById: user.id }),
      },
    }),
    prisma.bookingForm.count({
      where: {
        organizationId: user.organizationId,
        status: { in: ['SUBMITTED', 'IN_REVIEW'] },
        ...(isAdmin ? {} : { createdById: user.id }),
      },
    }),
    prisma.bookingForm.count({
      where: {
        organizationId: user.organizationId,
        status: 'RETURNED',
        ...(isAdmin ? {} : { createdById: user.id }),
      },
    }),
    prisma.bookingForm.count({
      where: {
        organizationId: user.organizationId,
        status: 'COMPLETED',
        ...(isAdmin ? {} : { createdById: user.id }),
      },
    }),
    prisma.formStepRecord.count({
      where: pendingForUserWhere(user),
    }),
  ]);

  const queueHref = isCoordinator ? '/coordinator/queue' : '/signatory/queue';

  return (
    <div className="space-y-8">
      {/* Executive Welcome Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-dac-navy-800 bg-gradient-to-r from-dac-navy-900 via-dac-navy-800 to-dac-navy-700 p-6 sm:p-8 text-white shadow-lg shadow-dac-navy-900/10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-20 -right-20 h-64 w-64 rounded-full bg-dac-orange-500/20 blur-3xl"
        />
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-dac-orange-400 backdrop-blur-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-dac-orange-400" />
              <span>Role Master: {user.role.label}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Welcome, {user.name.split(' ')[0] ?? user.name}
            </h1>
            <p className="mt-1 text-sm text-slate-300">
              Signed in as <strong className="font-semibold text-white">{user.role.label}</strong> ·{' '}
              {user.email}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {isCreator || isAdmin ? (
              <Link
                href="/forms/new"
                className="inline-flex items-center gap-2 rounded-xl bg-dac-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-black/20 transition hover:bg-dac-orange-600"
              >
                <span>+ New booking form</span>
              </Link>
            ) : null}
            <Link
              href={isCreator || isAdmin ? '/forms' : queueHref}
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-xs transition hover:bg-white/20"
            >
              <span>{isCreator || isAdmin ? 'View booking forms' : 'Open my queue'}</span>
            </Link>
          </div>
        </div>
      </div>

      <section aria-label="Needs my action">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-wider text-slate-700 uppercase">
            Needs My Action
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Waiting on me to sign"
            sublabel={isCoordinator ? 'Validate & sign (Step 6)' : 'Ready in your signature queue'}
            value={pendingOnMe}
            accent={pendingOnMe > 0 ? 'amber' : 'navy'}
            href={queueHref}
          />
          {isCreator || isAdmin ? (
            <Tile
              label="Returned to me"
              sublabel="Requires correction & resubmit"
              value={returned}
              accent={returned > 0 ? 'red' : 'slate'}
              href="/forms"
            />
          ) : null}
        </div>
      </section>

      <section aria-label="Booking forms">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-wider text-slate-700 uppercase">
            {isAdmin ? 'All Booking Forms' : 'My Booking Forms'}
          </h2>
          {isCreator || isAdmin ? (
            <Link
              href="/forms"
              className="text-xs font-semibold text-dac-navy-700 hover:text-dac-orange-600"
            >
              View all →
            </Link>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Drafts"
            sublabel="In progress, not yet submitted"
            value={drafts}
            accent="slate"
            href="/forms"
          />
          <Tile
            label="In review"
            sublabel="Moving through 9-step pipeline"
            value={inReview}
            accent="amber"
            href="/forms"
          />
          <Tile
            label="Returned"
            sublabel="Sent back for updates"
            value={returned}
            accent="red"
            href="/forms"
          />
          <Tile
            label="Completed"
            sublabel="All 9 steps signed & PDF sealed"
            value={completed}
            accent="emerald"
            href="/forms"
          />
        </div>
      </section>
    </div>
  );
}
