import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { renderToBuffer } from '@react-pdf/renderer';
import { BookingFormPdf } from '../src/components/pdf/booking-form-pdf';
import { SIGNATURE_GRID } from '../src/lib/pdf/form-layout';
import { samplePng } from '../src/lib/pdf/sample-image';
import type { PdfApplicant, PdfData, PdfSignature } from '../src/lib/pdf/data';

/**
 * Renders the Booking Form PDF from made-up data, with no database.
 *
 * Layout work needs fast feedback, and seeding a booking, signing nine steps
 * and generating takes the better part of a minute. This takes a second, and
 * it fails loudly with a stack trace when a react-pdf style is wrong — which
 * is the common way to break this file, because react-pdf silently accepts
 * some CSS and throws on the rest.
 *
 * Run:  npx tsx scripts/render-sample-pdf.tsx [out.pdf] [--form <booking id>]
 *
 * With `--form` it renders a real booking through `gatherPdfData` instead of
 * the sample, which is how a layout failure that only shows up on live data
 * gets a readable stack trace.
 */

/** Ink for the sample, from the shared encoder. */
function png(width: number, height: number): string {
  return `data:image/png;base64,${samplePng(width, height).toString('base64')}`;
}

function applicant(name: string, pan: string, aadhaar: string): PdfApplicant {
  return {
    salutation: 'MR',
    fullName: name,
    relationType: 'SON_OF',
    guardianSalutation: 'MR',
    guardianName: 'SURESH KUMAR',
    mobileNo: '9876543210',
    altMobileNo: '9123456780',
    email: 'ravi.kumar@example.com',
    pan,
    aadhaar,
    dob: '1990-05-14',
    occupation: 'SOFTWARE ENGINEER',
    companyName: 'ACME SYSTEMS PRIVATE LIMITED',
    designation: 'SENIOR MANAGER',
    location: 'CHENNAI',
    photoDataUrl: process.argv.includes('--no-photos') ? null : png(240, 320),
  };
}

const TERMS_BODY = [
  '# TERMS & CONDITIONS FOR PROVISIONAL ALLOTMENT',
  '',
  '## General Instructions:',
  '',
  'The price payable for the unit as mentioned overleaf is including the security deposit payable',
  'to the T.N.E.B. for the individual metered electricity supply to the unit, Registration charge,',
  'GST. Further, if the Government or statutory bodies involved introduce / increase later any',
  'Tax/Levies/Charges relating to the unit, the same shall become payable by the applicant/s.',
  '',
  '## Agreement of Sale Cum Construction:',
  '',
  'After the date of booking applicant/s are expected to enter into Sale cum construction agreement',
  'within 10 days, along with the particular stage payment, by way of Cheque/Online, which is',
  "subject to realization by the Company's banker.",
].join('\n');

/**
 * The real transcribed T&C when it is available, so the sample exercises the
 * same length and structure the generated PDF actually has. A short invented
 * body would not have caught the overflow this found.
 */
function realTermsBody(): string | null {
  if (process.argv.includes('--short-terms')) return null;

  const path = resolve(process.cwd(), 'content', 'terms', 'v1.md');
  if (!existsSync(path)) return null;

  const raw = readFileSync(path, 'utf8');
  const withoutFrontmatter = raw.replace(/^---[\s\S]*?\n---\n/, '');
  const [beforeChecklist] = withoutFrontmatter.split('# § REVIEW CHECKLIST');
  const text = (beforeChecklist ?? withoutFrontmatter).trim();
  const titleIndex = text.search(/^# /m);
  return titleIndex === -1 ? null : text.slice(titleIndex).trim();
}

function sampleData(): PdfData {
  const signature: PdfSignature = {
    dataUrl: png(480, 140),
    signerName: null,
    signedBy: 'Anita AGM',
    actedAt: new Date(),
  };

  const signatures: Record<string, PdfSignature> = {};
  if (process.argv.includes('--no-signatures')) return baseData(signatures);
  for (const cell of SIGNATURE_GRID) {
    signatures[cell.slot] = cell.slot.startsWith('applicant')
      ? { ...signature, signerName: 'RAVI KUMAR', signedBy: null }
      : signature;
  }

  return baseData(signatures);
}

function baseData(signatures: Record<string, PdfSignature>): PdfData {
  return {
    bookingId: 'DAC/2026/00042',
    bookingDate: '24/10/2026',
    projectName: 'DAC ARIYA PHASE II',
    propertyType: 'APARTMENT',
    apartmentNo: 'B-1204',
    salesExecutive: 'PRIYA S',
    salesHead: 'ARUN MURUGAN',
    telecaller: 'LAKSHMI R',
    leadId: 'LEAD-4471',
    source: 'WEBSITE',

    firstApplicant: applicant('RAVI KUMAR', 'ABCPK1234A', '234567890123'),
    secondApplicant: applicant('MEENA KUMARI', 'XYZPM5678B', '345678901234'),

    communicationAddress: ['12 GANDHI STREET', 'ADYAR', 'CHENNAI', 'TAMIL NADU 600020'],
    permanentAddress: ['12 GANDHI STREET', 'ADYAR', 'CHENNAI', 'TAMIL NADU 600020'],

    builtUpAreaSqft: '1450.00',
    udsSqft: '600.00',
    floor: '12',

    bookingAdvance: '₹5,00,000',
    paymentMode: 'ONLINE',
    paymentRefNo: 'TXN-99881',
    paymentDate: '24/10/2026',
    bank: 'HDFC BANK',
    paymentSource: 'HOME_LOAN',
    salePrice: '₹75,00,000',

    remarks: 'Corner unit facing the park, as discussed with the customer on 20 October.',

    signatures,
    terms: { version: 'v1', body: realTermsBody() ?? TERMS_BODY },
    logoDataUrl: null,
    generatedAt: new Date(),
  };
}

async function main(): Promise<void> {
  const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const formIndex = process.argv.indexOf('--form');
  const formId = formIndex === -1 ? null : process.argv[formIndex + 1];

  let data: PdfData;
  if (formId) {
    const { gatherPdfData } = await import('../src/lib/pdf/data');
    const live = await gatherPdfData(formId);
    if (!live) throw new Error(`No booking ${formId}, or it has no primary applicant.`);
    data = live;
    console.log(`Using live data for ${formId}`);
  } else {
    data = sampleData();
  }

  if (process.argv.includes('--dump')) {
    const redacted = JSON.parse(
      JSON.stringify(data, (key, value) =>
        typeof value === 'string' && value.startsWith('data:')
          ? `<${value.length} byte data url>`
          : value,
      ),
    ) as Record<string, unknown>;
    if (typeof redacted.terms === 'object' && redacted.terms !== null) {
      const terms = redacted.terms as { body?: string };
      terms.body = `<${terms.body?.length ?? 0} chars>`;
    }
    console.log(JSON.stringify(redacted, null, 2));
  }

  const target = resolve(
    positional.find((arg) => arg !== formId) ?? 'sample-booking-form.pdf',
  );
  const bytes = await renderToBuffer(<BookingFormPdf data={data} />);

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);

  console.log(`Rendered ${bytes.byteLength} bytes to ${target}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
