import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth/session';
import { storage } from '@/lib/storage';
import { DOWNLOAD_URL_TTL_SECONDS } from '@/lib/storage/upload-token';
import { authoriseFormAccess } from '@/lib/documents/access';

/**
 * Serves a captured signature image.
 *
 * Same shape as `/api/documents/{id}`: authorise against the booking, then
 * redirect to a short-lived signed URL. There is no public path to a signature.
 *
 * Unlike documents, a view is **not** audited. A signature is shown inline on
 * the status page and on every later signing screen, so each page load would
 * write several rows — and unlike a PAN card, the image is something the
 * signatory is entitled to see for as long as they can see the booking at all.
 * Who *created* each signature is already recorded against the step, which is
 * the fact that matters for a dispute.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const notFound = () => new Response('Not found', { status: 404 });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const user = await getSessionUser();
  if (!user) return notFound();

  const asset = await prisma.signatureAsset.findFirst({
    where: { id },
    select: {
      id: true,
      storageKey: true,
      stepRecord: {
        select: { flowInstance: { select: { bookingFormId: true } } },
      },
    },
  });

  // An asset with no step record is an orphan from a rolled-back signature:
  // nothing references it, so nobody may read it.
  const bookingFormId = asset?.stepRecord?.flowInstance.bookingFormId;
  if (!asset || !bookingFormId) return notFound();

  const access = await authoriseFormAccess(user, bookingFormId);
  if (!access) return notFound();

  let signedUrl: string;
  try {
    signedUrl = await storage().createSignedDownloadUrl(
      asset.storageKey,
      DOWNLOAD_URL_TTL_SECONDS,
    );
  } catch (error) {
    console.error('[signatures] could not sign a download URL', { assetId: asset.id, error });
    return new Response('The signature could not be opened.', { status: 502 });
  }

  // 302, not 307: the browser must not replay a PUT or POST to the signed URL.
  return new Response(null, {
    status: 302,
    headers: { location: signedUrl, 'cache-control': 'no-store, private' },
  });
}
