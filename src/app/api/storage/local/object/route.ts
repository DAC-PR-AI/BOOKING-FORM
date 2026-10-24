import { type NextRequest } from 'next/server';
import { localDriver, verifyLocalSignature } from '@/lib/storage/local';
import { storage } from '@/lib/storage';

/**
 * Serves a stored object for the LOCAL driver, against a short-lived signature.
 *
 * This is the local stand-in for a provider's signed URL, and it is reached the
 * same way: `/api/documents/{id}` authorises the request, audits the view, and
 * redirects here. The signature is therefore the authorisation at this point —
 * exactly as it would be for a Supabase signed URL, which also carries no
 * session.
 *
 * `Cache-Control: no-store` is not optional. These bytes are personal data and
 * must not be cached by a CDN or a shared proxy (brief §3).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  if (storage().name !== 'local') {
    return new Response('Not found', { status: 404 });
  }

  const params = request.nextUrl.searchParams;
  const key = params.get('key');
  const exp = Number(params.get('exp') ?? '0');
  const sig = params.get('sig');

  if (!key || !sig || !Number.isFinite(exp)) {
    return new Response('Not found', { status: 404 });
  }

  if (!verifyLocalSignature(key, exp, sig)) {
    // Expired and forged are deliberately indistinguishable.
    return new Response('Not found', { status: 404 });
  }

  let object;
  try {
    object = await localDriver.get(key);
  } catch {
    return new Response('Not found', { status: 404 });
  }

  return new Response(new Uint8Array(object.body), {
    status: 200,
    headers: {
      'content-type': object.contentType,
      'content-length': String(object.sizeBytes),
      'cache-control': 'no-store, private',
      // Never let a stored file be interpreted as a document in our origin.
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
    },
  });
}
