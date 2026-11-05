import { type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { audit } from '@/lib/audit/log';
import { authoriseFormAccess } from '@/lib/documents/access';
import { storage } from '@/lib/storage';
import { DOWNLOAD_URL_TTL_SECONDS } from '@/lib/storage/upload-token';
import { getOrCreatePdf } from '@/lib/pdf/render';

/**
 * The completed Booking Form, as a PDF.
 *
 * Generated on the first request after the booking completes and stored
 * write-once; every later request serves the same bytes, so the SHA-256 beside
 * it keeps meaning something.
 *
 * Rendering can take a few seconds — it embeds two photographs and up to nine
 * signatures — which is why this is a Route Handler rather than something a
 * page awaits. It redirects to a short-lived signed URL like every other
 * stored object, so the bytes do not pass through the function on repeat
 * downloads.
 */

// Region pinning lives in vercel.json ("regions": ["bom1"]), not in a route
// segment export: Next 16 deprecated `preferredRegion`, and Vercel now accepts
// only 'auto' | 'global' | 'home' there — an unsupported value throws at deploy
// time. The project-level setting pins every function to Mumbai, which is what
// the residency rule needs.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Generation is the slow path; Hobby caps at 10s, Pro allows more. */
export const maxDuration = 60;

const notFound = () => new Response('Not found', { status: 404 });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const user = await getSessionUser();
  if (!user) return notFound();

  // 404 rather than 403 — do not confirm that someone else's booking exists.
  const access = await authoriseFormAccess(user, id);
  if (!access) return notFound();

  let result;
  try {
    result = await getOrCreatePdf(user, access.bookingFormId);
  } catch (error) {
    console.error('[pdf] generation failed', { bookingFormId: access.bookingFormId, error });
    return new Response('The PDF could not be produced. Please try again.', { status: 500 });
  }

  if (!result.ok) {
    // A booking still in the flow has no PDF yet; that is a 409, not a 404 —
    // the reader is allowed to know this booking exists.
    return new Response(result.error, {
      status: result.error.startsWith('Booking not found') ? 404 : 409,
      headers: { 'cache-control': 'no-store, private' },
    });
  }

  // First-time generation already records VIEW_SENSITIVE inside getOrCreatePdf.
  // Repeat downloads of the stored PDF must also record VIEW_SENSITIVE because
  // the printed PDF contains full unmasked PAN and 12-digit Aadhaar numbers.
  if (!result.freshlyGenerated) {
    await audit({
      organizationId: user.organizationId,
      userId: user.id,
      bookingFormId: access.bookingFormId,
      action: 'VIEW_SENSITIVE',
      detail: `Downloaded stored booking form PDF (sha256 ${result.pdf.sha256.slice(0, 12)}…) containing full PAN and Aadhaar.`,
    });
  }

  let signedUrl: string;
  try {
    signedUrl = await storage().createSignedDownloadUrl(
      result.pdf.storageKey,
      DOWNLOAD_URL_TTL_SECONDS,
    );
  } catch (error) {
    console.error('[pdf] could not sign a download URL', { pdfId: result.pdf.id, error });
    return new Response('The PDF could not be opened.', { status: 502 });
  }

  return new Response(null, {
    status: 302,
    headers: {
      location: signedUrl,
      'cache-control': 'no-store, private',
      // Useful for a verification run, and harmless to a browser.
      'x-pdf-sha256': result.pdf.sha256,
    },
  });
}
