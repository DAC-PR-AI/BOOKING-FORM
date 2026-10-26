import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/rbac';
import { storageStatus } from '@/lib/storage';
import { emailConfig } from '@/lib/notify/email';
import { syncStatus } from '@/lib/projects/sync';
import {
  FREE_TIER,
  bookingsRemaining,
  formatBytes,
  meter,
  type Meter,
} from '@/lib/admin/usage';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'System' };
export const dynamic = 'force-dynamic';

/**
 * What the system is doing, and how close it is to a free-tier cliff.
 *
 * The database limit is the dangerous one: crossing 500 MB puts Supabase into
 * **read-only**, which for this app means bookings can be read but not signed.
 * That is not something to discover from a signatory who cannot sign, so the
 * documented upgrade trigger is 70% and this is where it shows.
 */

const LEVEL_STYLE = {
  ok: { bar: 'bg-green-600', text: 'text-gray-600', box: 'border-gray-200 bg-white' },
  watch: { bar: 'bg-amber-500', text: 'text-amber-900', box: 'border-amber-200 bg-amber-50' },
  critical: { bar: 'bg-red-600', text: 'text-red-900', box: 'border-red-200 bg-red-50' },
} as const;

function MeterBar({ value }: { value: Meter }) {
  const style = LEVEL_STYLE[value.level];

  return (
    <div className={`rounded-lg border p-4 ${style.box}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">{value.label}</h3>
        <span className={`text-xs tabular-nums ${style.text}`}>
          {formatBytes(value.used)} of {formatBytes(value.limit)} ·{' '}
          {value.percent.toFixed(1)}%
        </span>
      </div>

      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200"
        role="progressbar"
        aria-valuenow={Math.round(value.percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={value.label}
      >
        <div className={`h-full ${style.bar}`} style={{ width: `${value.percent}%` }} />
      </div>

      {value.note ? <p className={`mt-2 text-xs ${style.text}`}>{value.note}</p> : null}
    </div>
  );
}

function Fact({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-gray-900">{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-gray-500">{detail}</p> : null}
    </div>
  );
}

export default async function SystemPage() {
  const admin = await requireAdmin();

  const [documents, signatures, pdfs, counts, sync] = await Promise.all([
    prisma.formDocument.aggregate({ _sum: { sizeBytes: true }, _count: true }),
    prisma.signatureAsset.count(),
    prisma.generatedPdf.aggregate({ _sum: { sizeBytes: true }, _count: true }),
    Promise.all([
      prisma.bookingForm.count({ where: { organizationId: admin.organizationId } }),
      prisma.bookingForm.count({
        where: { organizationId: admin.organizationId, status: 'COMPLETED' },
      }),
      prisma.auditLog.count({ where: { organizationId: admin.organizationId } }),
      prisma.user.count({ where: { organizationId: admin.organizationId, isActive: true } }),
      prisma.notification.count({ where: { readAt: null } }),
    ]),
    syncStatus(admin.organizationId),
  ]);

  const [bookings, completed, auditRows, activeUsers, unreadNotifications] = counts;

  // Signatures are small PNGs; 20 KB each is a workable estimate and is
  // labelled as one rather than presented as measured.
  const estimatedSignatureBytes = signatures * 20 * 1024;
  const storedBytes =
    (documents._sum.sizeBytes ?? 0) + (pdfs._sum.sizeBytes ?? 0) + estimatedSignatureBytes;

  // Postgres' own idea of its size, rather than a guess from row counts.
  const [dbSize] = await prisma.$queryRaw<Array<{ bytes: bigint }>>`
    SELECT pg_database_size(current_database())::bigint AS bytes
  `;
  const databaseBytes = Number(dbSize?.bytes ?? 0);

  const storageMeter = meter({
    label: 'Document storage',
    used: storedBytes,
    limit: FREE_TIER.storageBytes,
    consequence: 'New uploads start failing once it is full.',
  });

  const databaseMeter = meter({
    label: 'Database',
    used: databaseBytes,
    limit: FREE_TIER.databaseBytes,
    consequence: 'Supabase switches the project to read-only, so bookings cannot be signed.',
  });

  const remaining = bookingsRemaining({
    usedBytes: storedBytes,
    limitBytes: FREE_TIER.storageBytes,
    completedBookings: completed,
  });

  const storage = storageStatus();
  const email = emailConfig();

  return (
    <>
      <PageHeader
        title="System"
        description="Free-tier headroom, where the data lives, and which integrations are switched on."
      />

      {!storage.residency.inIndia ? (
        <p className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <strong>Documents are not confirmed to be stored in India.</strong>{' '}
          {storage.residency.detail} All personal data must reside in India — this must be
          resolved before production.
        </p>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <MeterBar value={databaseMeter} />
        <MeterBar value={storageMeter} />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact
          label="Bookings"
          value={bookings.toLocaleString('en-IN')}
          detail={`${completed.toLocaleString('en-IN')} completed`}
        />
        <Fact
          label="Room for roughly"
          value={remaining === null ? '—' : `${remaining.toLocaleString('en-IN')} more`}
          detail={
            remaining === null
              ? 'Needs a completed booking to project from'
              : 'Projected from what stored bookings actually weigh'
          }
        />
        <Fact label="Audit entries" value={auditRows.toLocaleString('en-IN')} />
        <Fact
          label="Active users"
          value={activeUsers.toLocaleString('en-IN')}
          detail={`${unreadNotifications.toLocaleString('en-IN')} unread notifications`}
        />
      </div>

      <h2 className="mb-2 text-sm font-semibold text-gray-900">Where the data lives</h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Fact
          label="Document storage"
          value={storage.driver === 'local' ? 'Local filesystem' : 'Supabase Storage'}
          detail={storage.residency.detail}
        />
        <Fact
          label="Stored objects"
          value={`${(documents._count + signatures + pdfs._count).toLocaleString('en-IN')} files`}
          detail={`${documents._count} documents · ${signatures} signatures · ${pdfs._count} PDFs`}
        />
      </div>

      <h2 className="mb-2 text-sm font-semibold text-gray-900">Integrations</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Email digest</p>
          <p className="mt-0.5 text-sm font-semibold text-gray-900">
            {email ? 'Configured' : 'Not configured'}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {email
              ? `From ${email.from}, capped at ${email.dailyCap} a day. One message per person per night.`
              : 'The in-app queue is unaffected — email is a prompt to go and look, never the only copy.'}
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Project sheet</p>
          <p className="mt-0.5 text-sm font-semibold text-gray-900">
            {sync.configured ? 'Configured' : 'Not configured'}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {sync.configured
              ? `${sync.syncedProjects} synced, ${sync.handAddedProjects} by hand.`
              : `${sync.activeProjects} active projects, maintained by hand.`}{' '}
            <Link
              href="/admin/projects"
              className="text-dac-navy-700 underline underline-offset-2"
            >
              Manage
            </Link>
          </p>
        </div>
      </div>

      <p className="mt-6 text-xs text-gray-500">
        Signature sizes are estimated at 20 KB each; documents and PDFs are measured. The
        upgrade trigger is 70% — see <code>PLAN.md</code> §5.
      </p>
    </>
  );
}
