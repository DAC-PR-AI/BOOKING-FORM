import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { runDigest } from '@/lib/notify/run-digest';

/**
 * The nightly notification digest.
 *
 * One email per person listing what they have not read, rather than one per
 * event: Resend's free tier allows 100 messages a day and per-event sending
 * would exhaust that at about eleven bookings.
 *
 * Failures here never matter to the booking flow. The in-app queue is the
 * system of record and is completely unaffected by whether this runs.
 */

// Region pinning lives in vercel.json ("regions": ["bom1"]), not in a route
// segment export: Next 16 deprecated `preferredRegion`, and Vercel now accepts
// only 'auto' | 'global' | 'home' there — an unsupported value throws at deploy
// time. The project-level setting pins every function to Mumbai, which is what
// the residency rule needs.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  if (env.CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  const result = await runDigest();

  // A partial failure is reported as 500 so it shows in Vercel's cron log
  // rather than passing as a green tick over a digest nobody received.
  return NextResponse.json(
    { at: new Date().toISOString(), ...result },
    { status: result.ok ? 200 : 500, headers: { 'Cache-Control': 'no-store' } },
  );
}
