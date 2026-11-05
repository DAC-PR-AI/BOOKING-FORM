import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth/session';
import { audit } from '@/lib/audit/log';
import { storage } from '@/lib/storage';
import { DOWNLOAD_URL_TTL_SECONDS } from '@/lib/storage/upload-token';
import { authoriseFormAccess, isSensitiveDocumentType, isValidUuid } from '@/lib/documents/access';

/**
 * The only way to read a supporting document.
 *
 * Authorise → audit → redirect to a short-lived signed URL. The redirect
 * matters: the bytes do not pass through this function, so a 6 MB scan does
 * not become 6 MB of serverless egress on every view, and the signed URL is
 * minted per request rather than stored anywhere.
 *
 * Every view is logged (brief §3). PAN and Aadhaar scans are logged as
 * VIEW_SENSITIVE; the audit entry records the document type, never contents.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const notFound = () => new Response('Not found', { status: 404 });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isValidUuid(id)) return notFound();

  const user = await getSessionUser();
  if (!user) return notFound();

  const document = await prisma.formDocument.findFirst({
    where: { id },
    select: {
      id: true,
      storageKey: true,
      originalName: true,
      bookingFormId: true,
      documentType: { select: { key: true, label: true } },
    },
  });
  if (!document) return notFound();

  // Access is a property of the booking, not of the document row.
  const access = await authoriseFormAccess(user, document.bookingFormId);
  if (!access) return notFound();

  const sensitive = isSensitiveDocumentType(document.documentType.key);

  /**
   * What gets logged, and why not simply everything.
   *
   * The brief requires every view of a PAN or Aadhaar to be logged, so those
   * always produce a VIEW_SENSITIVE entry — including the creator's own, and
   * including a thumbnail load.
   *
   * For the rest (photograph, cost sheet, mail, payment screenshot) the useful
   * fact is that *somebody other than the person who attached it* looked at
   * the booking. Logging the creator's own thumbnail loads as well would add a
   * row every time they open their own draft, and an audit trail nobody can
   * read is not an audit trail.
   */
  const shouldAudit = sensitive || !access.isCreator;

  if (shouldAudit) {
    await audit({
      organizationId: user.organizationId,
      userId: user.id,
      bookingFormId: document.bookingFormId,
      action: sensitive ? 'VIEW_SENSITIVE' : 'EXPORT',
      detail: `Viewed supporting document "${document.documentType.label}" (${document.documentType.key}).`,
    });
  }

  let signedUrl: string;
  try {
    signedUrl = await storage().createSignedDownloadUrl(
      document.storageKey,
      DOWNLOAD_URL_TTL_SECONDS,
    );
  } catch (error) {
    console.error('[documents] could not sign a download URL', {
      documentId: document.id,
      error,
    });
    return new Response('The document could not be opened. Please try again.', { status: 502 });
  }

  // 302, not 307: the browser must not replay a PUT or POST to the signed URL.
  return new Response(null, {
    status: 302,
    headers: {
      location: signedUrl,
      // The redirect itself is per-user and short lived. Nothing may cache it.
      'cache-control': 'no-store, private',
    },
  });
}
