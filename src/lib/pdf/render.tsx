import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { renderToBuffer } from '@react-pdf/renderer';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/auth/session';
import { audit } from '@/lib/audit/log';
import { storage } from '@/lib/storage';
import { buildPdfKey } from '@/lib/storage/keys';
import { writeLocalObject } from '@/lib/storage/local';
import { BookingFormPdf } from '@/components/pdf/booking-form-pdf';
import { gatherPdfData } from './data';

/**
 * Generating and storing the final Booking Form PDF.
 *
 * **Write-once.** A booking produces exactly one PDF, at completion, and it is
 * never regenerated. That is the whole point of storing a SHA-256 beside it:
 * the hash is worth nothing if the document behind it can quietly change. A
 * later request serves the stored bytes, it does not re-render — so a tweak to
 * the layout, a renamed project or a corrected T&C version can never silently
 * alter a document somebody has already signed and filed.
 *
 * Only a COMPLETED booking gets one. Before that the signature grid would be
 * half empty, and a half-finished PDF in circulation is worse than none.
 */

export type PdfRecord = {
  id: string;
  storageKey: string;
  sha256: string;
  sizeBytes: number;
  generatedAt: Date;
};

export type PdfResult =
  | { ok: true; pdf: PdfRecord; freshlyGenerated: boolean }
  | { ok: false; error: string };

/** Renders the document to bytes. Separated so the harness can render without storing. */
export async function renderBookingPdf(bookingFormId: string): Promise<Buffer | null> {
  const data = await gatherPdfData(bookingFormId);
  if (!data) return null;

  // `renderToBuffer` wants the element, not a rendered tree.
  return renderToBuffer(<BookingFormPdf data={data} />);
}

/**
 * The stored PDF for a booking, generating it on first request.
 *
 * Decrypting PAN and Aadhaar to print them is deliberate (see `data.ts`), so
 * generation writes a `VIEW_SENSITIVE` entry as well as a `PDF` one. Serving
 * an already-stored PDF writes neither: the bytes are not being produced
 * again, and the signed-URL redirect is what the reader actually receives.
 */
export async function getOrCreatePdf(
  user: SessionUser,
  bookingFormId: string,
): Promise<PdfResult> {
  const form = await prisma.bookingForm.findFirst({
    where: { id: bookingFormId, organizationId: user.organizationId },
    select: { id: true, bookingId: true, status: true },
  });
  if (!form) return { ok: false, error: 'Booking not found.' };

  const existing = await prisma.generatedPdf.findFirst({
    where: { bookingFormId: form.id },
    orderBy: { generatedAt: 'desc' },
    select: { id: true, storageKey: true, sha256: true, sizeBytes: true, generatedAt: true },
  });
  if (existing) return { ok: true, pdf: existing, freshlyGenerated: false };

  if (form.status !== 'COMPLETED') {
    return {
      ok: false,
      error:
        'The PDF is produced once every signature is collected. This booking is still in the ' +
        'signature flow.',
    };
  }

  const bytes = await renderBookingPdf(form.id);
  if (!bytes) return { ok: false, error: 'The booking could not be read.' };

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const storageKey = buildPdfKey({ bookingFormId: form.id, unique: randomUUID() });
  const driver = storage();

  // Storage first, as with signatures: a row pointing at bytes that were never
  // written is unrecoverable, an unreferenced object is not.
  if (driver.name === 'local') {
    await writeLocalObject(storageKey, bytes, 'application/pdf');
  } else {
    const upload = await driver.createSignedUpload(storageKey, 'application/pdf', 300, '');
    const response = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: new Uint8Array(bytes),
    });
    if (!response.ok) {
      return { ok: false, error: `The PDF could not be stored (${response.status}).` };
    }
  }

  let pdf: PdfRecord;
  try {
    pdf = await prisma.generatedPdf.create({
      data: {
        bookingFormId: form.id,
        storageKey,
        sha256,
        sizeBytes: bytes.byteLength,
      },
      select: { id: true, storageKey: true, sha256: true, sizeBytes: true, generatedAt: true },
    });
  } catch (error) {
    await driver.remove(storageKey).catch(() => undefined);
    throw error;
  }

  await audit({
    organizationId: user.organizationId,
    userId: user.id,
    bookingFormId: form.id,
    action: 'VIEW_SENSITIVE',
    detail: `PAN and Adhaar decrypted to print the booking form for ${form.bookingId ?? form.id}.`,
  });

  await audit({
    organizationId: user.organizationId,
    userId: user.id,
    bookingFormId: form.id,
    action: 'PDF',
    detail: `Generated the booking form PDF (${bytes.byteLength} bytes, sha256 ${sha256.slice(0, 12)}…).`,
  });

  return { ok: true, pdf, freshlyGenerated: true };
}
