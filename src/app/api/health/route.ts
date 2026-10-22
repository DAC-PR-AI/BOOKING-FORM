import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';

/**
 * Keep-alive + liveness probe.
 *
 * Supabase pauses a free-plan project after ~7 days without database activity,
 * which would take the portal down silently. A daily Vercel Cron hits this
 * endpoint and the trivial query below counts as activity (PLAN.md §5).
 *
 * Pinned to Mumbai like every other data route.
 */
export const runtime = 'nodejs';
export const preferredRegion = 'bom1';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  // When CRON_SECRET is configured, require it. Vercel Cron sends it as a
  // bearer token; this keeps the endpoint from being a free DB ping for anyone.
  if (env.CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
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

  return NextResponse.json(
    {
      ok: true,
      database: 'reachable',
      latencyMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
