import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { googleConfig } from '@/lib/google/sheets';
import { runProjectSync } from '@/lib/projects/sync';

/**
 * The daily project sync.
 *
 * A cached read-through (PLAN.md §2A): the booking form reads Postgres, and
 * this is the only thing that talks to Google. If it fails, staff lose access
 * to *new* project names until it succeeds — not the ability to book, and not
 * any existing booking's project.
 *
 * Runs for every organisation, because a cron has no session to tell it which
 * one. Today there is one; the loop means a second does not need a new route.
 */

export const runtime = 'nodejs';
export const preferredRegion = 'bom1';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  // Vercel Cron sends the secret as a bearer token. Without this the endpoint
  // is a free way for anyone to make us hammer Google's API.
  if (env.CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  if (!googleConfig()) {
    // Not an error: the sheet is optional until DAC supplies one, and a cron
    // that fails nightly over an unconfigured integration trains people to
    // ignore alerts.
    return NextResponse.json(
      { ok: true, skipped: 'The project sheet is not configured.' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const organizations = await prisma.organization.findMany({ select: { id: true, slug: true } });

  const results = [];
  for (const organization of organizations) {
    const outcome = await runProjectSync({ organizationId: organization.id });
    results.push({
      organization: organization.slug,
      ...(outcome.ok
        ? {
            ok: true,
            created: outcome.created,
            updated: outcome.updated,
            deactivated: outcome.deactivated,
            skippedRows: outcome.problems.length,
          }
        : { ok: false, error: outcome.error }),
    });
  }

  const anyFailed = results.some((r) => r.ok === false);

  // A non-200 on failure so Vercel's cron log shows it rather than a green
  // tick over a sync that has silently stopped working.
  return NextResponse.json(
    { ok: !anyFailed, at: new Date().toISOString(), results },
    { status: anyFailed ? 500 : 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
