import { type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { verifyUploadToken } from '@/lib/storage/upload-token';
import { writeLocalObject } from '@/lib/storage/local';
import { storage } from '@/lib/storage';

/**
 * Receives the bytes for the LOCAL storage driver.
 *
 * In production the browser PUTs straight to the storage provider and this
 * route is never reached — `storage()` returns the Supabase driver and refuses
 * to hand out a local upload URL. The guard below makes that explicit rather
 * than relying on it.
 *
 * Authorisation is the upload grant, which is HMAC-signed and names the key,
 * the content type and the size ceiling. The route never takes a key from the
 * request, so a caller cannot choose where the bytes land. The session is
 * checked as well and must belong to the same user the grant was issued to.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function problem(status: number, detail: string): Response {
  return Response.json({ error: detail }, { status });
}

export async function PUT(request: NextRequest): Promise<Response> {
  if (storage().name !== 'local') {
    return problem(404, 'Not found.');
  }

  const token = request.nextUrl.searchParams.get('token');
  if (!token) return problem(400, 'Missing upload grant.');

  const secret = process.env.SESSION_SECRET;
  if (!secret) return problem(500, 'Server is not configured.');

  const verified = verifyUploadToken(token, secret);
  if (!verified.ok) {
    return problem(
      verified.reason === 'expired' ? 410 : 403,
      verified.reason === 'expired'
        ? 'This upload took too long and the grant expired. Please try again.'
        : 'Invalid upload grant.',
    );
  }
  const grant = verified.grant;

  const user = await getSessionUser();
  if (!user || user.id !== grant.userId) {
    return problem(403, 'Invalid upload grant.');
  }

  // Reject on the declared length before reading, so an oversized body is not
  // buffered in memory first.
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > grant.maxBytes) {
    return problem(413, 'That file is larger than this document type allows.');
  }

  const body = Buffer.from(await request.arrayBuffer());
  if (body.byteLength === 0) return problem(400, 'The file was empty.');
  if (body.byteLength > grant.maxBytes) {
    return problem(413, 'That file is larger than this document type allows.');
  }

  // The content type comes from the grant, not from the request header: the
  // server already decided what this object is allowed to be.
  await writeLocalObject(grant.storageKey, body, grant.contentType);

  return new Response(null, { status: 204 });
}
