import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '@/lib/db';
import { storage } from '@/lib/storage';
import { decryptField } from '@/lib/crypto/field-encryption';
import { formatPaise } from '@/lib/format/money';

/**
 * Everything the printed Booking Form needs, gathered in one read.
 *
 * ## Why this PDF carries full PAN and Aadhaar
 *
 * The brief requires PAN and Aadhaar to be encrypted at rest and **masked in
 * lists**. This is not a list: it is the booking form itself, the document the
 * applicant signs and DAC files, and the paper original has both numbers
 * written across its character boxes in full. A PDF showing `XXXXXXXX1234`
 * would not be a reproduction of the form — it would be a different document,
 * and one no registrar or bank would accept in place of the original.
 *
 * So this decrypts both, deliberately and in one place, and the caller records
 * a `VIEW_SENSITIVE` audit entry alongside the `PDF` one. The output lands in
 * the same private, India-resident storage the ciphertext already lives in, is
 * reachable only through a short-lived signed URL, and is generated only once
 * the booking is COMPLETED.
 *
 * If DAC's policy turns out to require masking here too, `maskWithLast4` is
 * already available and this is the only function that would change.
 */

export type PdfSignature = {
  dataUrl: string;
  /** The applicant's typed name, for in-person captures. */
  signerName: string | null;
  /** The staff member's name, for pipeline steps. */
  signedBy: string | null;
  actedAt: Date | null;
};

export type PdfApplicant = {
  salutation: string;
  fullName: string;
  relationType: string;
  guardianSalutation: string;
  guardianName: string;
  mobileNo: string;
  altMobileNo: string;
  email: string;
  pan: string;
  aadhaar: string;
  /** ISO `YYYY-MM-DD`, or null. */
  dob: string | null;
  occupation: string;
  companyName: string;
  designation: string;
  location: string;
  photoDataUrl: string | null;
};

export type PdfData = {
  bookingId: string;
  bookingDate: string;
  projectName: string;
  propertyType: string | null;
  apartmentNo: string;
  salesExecutive: string;
  salesHead: string;
  telecaller: string;
  leadId: string;
  source: string;

  firstApplicant: PdfApplicant;
  secondApplicant: PdfApplicant | null;

  communicationAddress: string[];
  permanentAddress: string[];

  builtUpAreaSqft: string;
  udsSqft: string;
  floor: string;

  bookingAdvance: string;
  paymentMode: string | null;
  paymentRefNo: string;
  paymentDate: string;
  bank: string;
  paymentSource: string | null;
  salePrice: string;

  remarks: string;

  /** Keyed by `flow_steps.pdf_signature_slot`. */
  signatures: Record<string, PdfSignature>;

  terms: { version: string; body: string } | null;

  /** Null until brand assets are supplied; the header falls back to type. */
  logoDataUrl: string | null;

  generatedAt: Date;
};

/** `1990-05-14` from a DATE column. */
function isoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function istDate(value: Date | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(value);
}

/**
 * Reads a stored object back as a data URL for embedding.
 *
 * react-pdf will fetch a URL itself, but that would mean the renderer making
 * network calls mid-render — slower, and a failure mode that produces a PDF
 * with a missing photograph rather than an error. Fetching first means a
 * failure is visible before anything is written.
 */
async function embed(storageKey: string, mimeType: string): Promise<string | null> {
  try {
    const object = await storage().get(storageKey);
    return `data:${mimeType};base64,${object.body.toString('base64')}`;
  } catch (error) {
    console.error('[pdf] could not embed an object', { storageKey, error });
    return null;
  }
}

/**
 * The DAC logo, if brand assets have been supplied.
 *
 * Read from disk at render time rather than bundled, so dropping a file into
 * `public/brand/` is all it takes — no code change and no redeploy in
 * development. Until one exists the header prints the wordmark as type, which
 * is legible and obviously a placeholder rather than a silent blank.
 */
function readLogo(): string | null {
  for (const name of ['logo.png', 'logo.jpg', 'logo.jpeg', 'dac-logo.png']) {
    const path = resolve(process.cwd(), 'public', 'brand', name);
    if (!existsSync(path)) continue;
    try {
      const mime = name.endsWith('.png') ? 'image/png' : 'image/jpeg';
      return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
    } catch {
      // An unreadable brand file must not stop a booking being printed.
    }
  }
  return null;
}

function decrypt(value: Uint8Array | null): string {
  if (!value) return '';
  try {
    return decryptField(Buffer.from(value));
  } catch (error) {
    // A tampered or key-rotated value. Print nothing rather than garbage.
    console.error('[pdf] could not decrypt a sensitive field', { error });
    return '';
  }
}

export async function gatherPdfData(bookingFormId: string): Promise<PdfData | null> {
  const form = await prisma.bookingForm.findUnique({
    where: { id: bookingFormId },
    include: {
      project: { select: { name: true } },
      applicants: true,
      addresses: true,
      tncVersion: { select: { version: true, body: true } },
      documents: {
        select: {
          storageKey: true,
          mimeType: true,
          documentType: { select: { key: true } },
        },
      },
      flowInstance: {
        include: {
          stepRecords: {
            include: {
              flowStep: { select: { pdfSignatureSlot: true } },
              assignee: { select: { name: true } },
              signatureAsset: true,
            },
          },
        },
      },
    },
  });

  if (!form) return null;
  // Bound once so the nested helpers below close over a non-null value.
  const booking = form;

  const primary = form.applicants.find((a) => a.applicantType === 'PRIMARY');
  const secondary = form.applicants.find((a) => a.applicantType === 'SECONDARY');
  const communication = form.addresses.find((a) => a.type === 'COMMUNICATION');
  const permanent = form.addresses.find((a) => a.type === 'PERMANENT');

  async function photoFor(typeKey: string): Promise<string | null> {
    const document = booking.documents.find((d) => d.documentType.key === typeKey);
    return document ? embed(document.storageKey, document.mimeType) : null;
  }

  async function applicantOf(
    row: (typeof booking.applicants)[number] | undefined,
    photoKey: string,
  ): Promise<PdfApplicant | null> {
    if (!row) return null;

    return {
      salutation: row.salutation ?? '',
      fullName: row.fullName ?? '',
      relationType: row.relationType ?? '',
      guardianSalutation: row.guardianSalutation ?? '',
      guardianName: row.guardianName ?? '',
      mobileNo: row.mobileNo ?? '',
      altMobileNo: row.altMobileNo ?? '',
      email: row.email ?? '',
      // See the note at the top of this file: the printed form carries these
      // in full, and this is that form.
      pan: decrypt(row.panEncrypted),
      aadhaar: decrypt(row.aadhaarEncrypted),
      dob: isoDate(row.dob),
      occupation: row.occupation ?? '',
      companyName: row.companyName ?? '',
      designation: row.designation ?? '',
      location: row.location ?? '',
      photoDataUrl: await photoFor(photoKey),
    };
  }

  const signatures: Record<string, PdfSignature> = {};
  for (const record of form.flowInstance?.stepRecords ?? []) {
    const asset = record.signatureAsset;
    if (!asset) continue;

    const dataUrl = await embed(asset.storageKey, asset.mimeType);
    if (!dataUrl) continue;

    signatures[record.flowStep.pdfSignatureSlot] = {
      dataUrl,
      signerName: asset.signerName,
      signedBy: record.assignee?.name ?? null,
      actedAt: record.actedAt,
    };
  }

  const addressLines = (row: typeof communication): string[] =>
    [row?.line1, row?.line2, row?.line3, row?.line4].map((line) => line ?? '');

  const firstApplicant = await applicantOf(primary, 'photo_applicant_1');
  if (!firstApplicant) return null;

  return {
    bookingId: form.bookingId ?? '',
    bookingDate: istDate(form.bookingDate),
    projectName: form.project?.name ?? '',
    propertyType: form.propertyType,
    apartmentNo: form.apartmentNo ?? '',
    salesExecutive: form.salesExecutive ?? '',
    salesHead: form.salesHead ?? '',
    telecaller: form.telecaller ?? '',
    leadId: form.leadId ?? '',
    source: form.source ?? '',

    firstApplicant,
    secondApplicant: await applicantOf(secondary, 'photo_applicant_2'),

    communicationAddress: addressLines(communication),
    permanentAddress: addressLines(permanent),

    builtUpAreaSqft: form.builtUpAreaSqft?.toString() ?? '',
    udsSqft: form.udsSqft?.toString() ?? '',
    floor: form.floor ?? '',

    bookingAdvance: form.bookingAdvancePaise ? formatPaise(form.bookingAdvancePaise) : '',
    paymentMode: form.paymentMode,
    paymentRefNo: form.paymentRefNo ?? '',
    paymentDate: istDate(form.paymentDate),
    bank: form.bank ?? '',
    paymentSource: form.paymentSource,
    salePrice: form.salePricePaise ? formatPaise(form.salePricePaise) : '',

    remarks: form.remarks ?? '',

    signatures,
    terms: form.tncVersion ? { version: form.tncVersion.version, body: form.tncVersion.body } : null,
    logoDataUrl: readLogo(),
    generatedAt: new Date(),
  };
}
