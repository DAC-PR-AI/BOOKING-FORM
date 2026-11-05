import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { verifyCronAuth } from '@/lib/auth/cron';
import { storageStatus } from '@/lib/storage';

/**
 * Keep-alive + liveness probe.
 *
 * Supabase pauses a free-plan project after ~7 days without database activity,
 * which would take the portal down silently. A daily Vercel Cron hits this
 * endpoint and the trivial query below counts as activity (PLAN.md §5).
 *
 * Pinned to Mumbai like every other data route.
 */
// Region pinning lives in vercel.json ("regions": ["bom1"]), not in a route
// segment export: Next 16 deprecated `preferredRegion`, and Vercel now accepts
// only 'auto' | 'global' | 'home' there — an unsupported value throws at deploy
// time. The project-level setting pins every function to Mumbai, which is what
// the residency rule needs.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  // When CRON_SECRET is configured, require it in constant time. Vercel Cron
  // sends it as a bearer token; this keeps the endpoint from being a free DB
  // ping for anyone.
  if (
    !verifyCronAuth(request.headers.get('authorization'), {
      cronSecret: env.CRON_SECRET,
      nodeEnv: env.NODE_ENV,
      failClosedInProd: true,
    })
  ) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    console.error('[health] database check failed', error);
    return NextResponse.json(
      { ok: false, database: 'unreachable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Which storage driver is live, and whether its bytes are in India. The
  // most likely way to break the residency requirement is a deploy that
  // silently falls back to the wrong driver or the wrong region, and a
  // misconfiguration nobody can see is one nobody fixes.
  let storage: { driver: string; residency: { inIndia: boolean; detail: string } } | { error: string };
  try {
    storage = storageStatus();
  } catch (error) {
    storage = { error: error instanceof Error ? error.message : 'unavailable' };
  }

  return NextResponse.json(
    {
      ok: true,
      database: 'reachable',
      latencyMs: Date.now() - startedAt,
      storage,
      at: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
