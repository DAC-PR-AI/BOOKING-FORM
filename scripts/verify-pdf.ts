import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Role, User } from '@prisma/client';
import { prisma } from '../src/lib/db';
import { storage } from '../src/lib/storage';
import { performSubmit } from '../src/lib/forms/submit';
import { signStep } from '../src/lib/flow/sign';
import { getOrCreatePdf, renderBookingPdf } from '../src/lib/pdf/render';
import { SIGNATURE_GRID } from '../src/lib/pdf/form-layout';
import { appearInOrder, containsLabel, extractText } from '../src/lib/pdf/extract-text';
import { samplePng } from '../src/lib/pdf/sample-image';
import { encryptField, last4, toDbBytes } from '../src/lib/crypto/field-encryption';
import { verhoeffCheckDigit } from '../src/lib/validation/aadhaar';

/**
 * End-to-end check of PDF generation.
 *
 * Builds a complete booking, signs all nine steps, generates the PDF and
 * inspects it: that it is a real PDF, has both pages, is write-once, and that
 * its stored hash matches the stored bytes.
 *
 * Run:  npx tsx --conditions=react-server scripts/verify-pdf.ts [--keep <path>]
 *
 * `--keep` writes a copy of the PDF out for the fidelity pass against the
 * photograph, which is a human judgement and not something a script can make.
 */

type SessionUser = User & { role: Role };

function ok(label: string, detail = ''): void {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label: string, detail: string): never {
  throw new Error(`${label} — ${detail}`);
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) fail('seed data', `${what}. Run \`npm run db:seed\`.`);
  return value;
}

const SIGNATURE = samplePng(480, 140);
const SIGNATURE_URL = `data:image/png;base64,${SIGNATURE.toString('base64')}`;
const PHOTO = samplePng(240, 320);

const created: string[] = [];
let sequenceBefore: { year: number; lastValue: number } | null = null;

/** Counts page objects without a PDF library — react-pdf writes them plainly. */
function countPages(pdf: Buffer): number {
  const text = pdf.toString('latin1');
  return (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the verification script against production.');
  }

  const keepIndex = process.argv.indexOf('--keep');
  const keepPath = keepIndex !== -1 ? process.argv[keepIndex + 1] : undefined;

  const organization = required(await prisma.organization.findFirst(), 'no organisation');

  async function userWithRole(roleName: string): Promise<SessionUser> {
    return required(
      await prisma.user.findFirst({
        where: { organizationId: organization.id, role: { name: roleName as never } },
        include: { role: true },
      }),
      `no ${roleName} user`,
    );
  }

  const creator = await userWithRole('SALES_EXECUTIVE');
  const byStepRole: Record<number, SessionUser> = {
    3: await userWithRole('AGM'),
    4: await userWithRole('DGM_GM'),
    5: await userWithRole('VP_SALES'),
    6: await userWithRole('SALES_COORDINATOR'),
    7: await userWithRole('MIS'),
    8: await userWithRole('DIRECTOR'),
    9: await userWithRole('CRM'),
  };

  const template = required(
    await prisma.formTemplate.findFirst({
      where: { organizationId: organization.id, key: 'booking_form' },
    }),
    'no booking form template',
  );
  const project = required(
    await prisma.project.findFirst({ where: { organizationId: organization.id, isActive: true } }),
    'no active project',
  );
  const source = required(
    await prisma.sourceOption.findFirst({ where: { isActive: true } }),
    'no source options',
  );

  sequenceBefore =
    (await prisma.bookingSequence.findFirst({
      where: { organizationId: organization.id },
      orderBy: { year: 'desc' },
      select: { year: true, lastValue: true },
    })) ?? null;

  function applicantData(name: string, aadhaarPrefix: string, pan: string) {
    const aadhaar = `${aadhaarPrefix}${verhoeffCheckDigit(aadhaarPrefix)}`;
    return {
      salutation: 'MR' as const,
      fullName: name,
      relationType: 'SON_OF' as const,
      guardianSalutation: 'MR' as const,
      guardianName: 'SURESH KUMAR',
      mobileNo: '9876543210',
      altMobileNo: '9123456780',
      email: 'ravi@example.com',
      panEncrypted: toDbBytes(encryptField(pan)),
      panLast4: last4(pan),
      aadhaarEncrypted: toDbBytes(encryptField(aadhaar)),
      aadhaarLast4: last4(aadhaar),
      dob: new Date('1990-05-14T00:00:00Z'),
      occupation: 'SOFTWARE ENGINEER',
      companyName: 'ACME SYSTEMS',
      designation: 'SENIOR MANAGER',
      location: 'CHENNAI',
      aadhaarPlain: aadhaar,
    };
  }

  const primaryData = applicantData('RAVI KUMAR', '23456789012', 'ABCPK1234A');
  const secondaryData = applicantData('MEENA KUMARI', '34567890123', 'XYZPM5678B');

  const driver = storage();

  async function completedBooking(): Promise<string> {
    const { aadhaarPlain: _a, ...primary } = primaryData;
    const { aadhaarPlain: _b, ...secondary } = secondaryData;

    const form = await prisma.bookingForm.create({
      data: {
        organizationId: organization.id,
        formTemplateId: template.id,
        createdById: creator.id,
        bookingDate: new Date(),
        status: 'DRAFT',
        remarks:
          'VERIFY-PDF throwaway. Corner unit facing the park, as discussed with the customer.',
        projectId: project.id,
        propertyType: 'APARTMENT',
        apartmentNo: 'B-1204',
        salesExecutive: 'PRIYA S',
        salesHead: 'ARUN MURUGAN',
        telecaller: 'LAKSHMI R',
        leadId: 'LEAD-4471',
        source: source.value,
        builtUpAreaSqft: '1450',
        udsSqft: '600',
        floor: '12',
        bookingAdvancePaise: 50_000_000n,
        paymentMode: 'ONLINE',
        paymentRefNo: 'TXN-99881',
        paymentDate: new Date(),
        bank: 'HDFC BANK',
        paymentSource: 'HOME_LOAN',
        salePricePaise: 750_000_000n,
        applicants: {
          create: [
            { applicantType: 'PRIMARY', ...primary },
            { applicantType: 'SECONDARY', ...secondary },
          ],
        },
        addresses: {
          create: (['COMMUNICATION', 'PERMANENT'] as const).map((type) => ({
            type,
            line1: '12 GANDHI STREET',
            line2: 'ADYAR',
            line3: 'CHENNAI',
            line4: 'TAMIL NADU 600020',
          })),
        },
      },
    });
    created.push(form.id);

    const applicants = await prisma.applicant.findMany({ where: { bookingFormId: form.id } });
    const types = await prisma.documentType.findMany({
      where: {
        organizationId: organization.id,
        isActive: true,
        requirement: { OR: [{ isMandatory: true }, { requiredIfSecondApplicant: true }] },
      },
    });

    for (const type of types) {
      const applicantId =
        type.scope === 'APPLICANT'
          ? applicants.find((a) => a.applicantType === type.appliesTo)?.id ?? null
          : null;

      const storageKey = `bookings/${form.id}/${type.key}/verify.png`;
      // Photographs are embedded in the PDF, so these need real bytes.
      const { writeLocalObject } = await import('../src/lib/storage/local');
      if (driver.name === 'local') await writeLocalObject(storageKey, PHOTO, 'image/png');

      await prisma.formDocument.create({
        data: {
          bookingFormId: form.id,
          documentTypeId: type.id,
          applicantId,
          storageKey,
          originalName: 'verify.png',
          mimeType: 'image/png',
          sizeBytes: PHOTO.byteLength,
          uploadedById: creator.id,
        },
      });
    }

    const submitted = await performSubmit(creator, form.id, { tncAccepted: true });
    if (!submitted.ok) fail('fixture', `could not submit: ${submitted.error}`);

    return form.id;
  }

  try {
    console.log('\nBuilding a completed booking');
    const formId = await completedBooking();

    const tooEarly = await getOrCreatePdf(creator, formId);
    if (tooEarly.ok) fail('getOrCreatePdf', 'a PDF was produced before the booking completed.');
    ok('refuses to produce a PDF while the booking is still in the flow');

    await signStep(creator, {
      formId,
      orderIndex: 1,
      signatureDataUrl: SIGNATURE_URL,
      signerName: 'RAVI KUMAR',
    });
    await signStep(creator, {
      formId,
      orderIndex: 2,
      signatureDataUrl: SIGNATURE_URL,
      signerName: 'MEENA KUMARI',
    });
    for (const order of [3, 4, 5, 6, 7, 8, 9]) {
      const result = await signStep(byStepRole[order] as SessionUser, {
        formId,
        orderIndex: order,
        signatureDataUrl: SIGNATURE_URL,
        // Step 6 is the Co-ordinator's VALIDATE_AND_SIGN.
        ...(order === 6 ? { validated: true } : {}),
      });
      if (!result.ok) fail('fixture', `step ${order}: ${result.error}`);
    }
    ok('signed all nine steps');

    const completed = await prisma.bookingForm.findUniqueOrThrow({
      where: { id: formId },
      select: { status: true, bookingId: true },
    });
    if (completed.status !== 'COMPLETED') {
      fail('fixture', `booking is ${completed.status}, expected COMPLETED`);
    }
    ok('booking completed', completed.bookingId ?? '');

    // --- generation -------------------------------------------------------
    console.log('\nGenerating the PDF');
    const started = Date.now();
    const generated = await getOrCreatePdf(creator, formId);
    if (!generated.ok) fail('getOrCreatePdf', generated.error);
    if (!generated.freshlyGenerated) fail('getOrCreatePdf', 'expected a fresh generation.');
    ok('generated', `${generated.pdf.sizeBytes} bytes in ${Date.now() - started} ms`);

    const bytes = (await driver.get(generated.pdf.storageKey)).body;
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
      fail('pdf', `does not start with %PDF- (${bytes.subarray(0, 8).toString('ascii')})`);
    }
    ok('is a real PDF', bytes.subarray(0, 8).toString('ascii').trim());

    if (!bytes.subarray(-1024).toString('latin1').includes('%%EOF')) {
      fail('pdf', 'is truncated — no %%EOF trailer.');
    }
    ok('is complete, with an %%EOF trailer');

    const pages = countPages(bytes);
    if (pages !== 2) fail('pdf', `has ${pages} page object(s), expected 2`);
    ok('has both pages — the form and the terms');

    const storedHash = createHash('sha256').update(bytes).digest('hex');
    if (storedHash !== generated.pdf.sha256) {
      fail('pdf', 'the recorded SHA-256 does not match the stored bytes.');
    }
    ok('the recorded hash matches the stored bytes', `${storedHash.slice(0, 16)}…`);

    if (generated.pdf.sizeBytes !== bytes.byteLength) {
      fail('pdf', `recorded ${generated.pdf.sizeBytes} bytes, stored ${bytes.byteLength}`);
    }
    ok('the recorded size matches');

    // --- write-once -------------------------------------------------------
    console.log('\nWrite-once');
    const again = await getOrCreatePdf(creator, formId);
    if (!again.ok) fail('getOrCreatePdf', again.error);
    if (again.freshlyGenerated) fail('getOrCreatePdf', 'the PDF was regenerated on a second read.');
    if (again.pdf.id !== generated.pdf.id || again.pdf.sha256 !== generated.pdf.sha256) {
      fail('getOrCreatePdf', 'a second read produced a different document.');
    }
    ok('a second request serves the same stored document');

    const rowCount = await prisma.generatedPdf.count({ where: { bookingFormId: formId } });
    if (rowCount !== 1) fail('getOrCreatePdf', `${rowCount} generated_pdfs rows, expected 1`);
    ok('exactly one PDF row exists');

    // --- what the PDF actually contains -----------------------------------
    console.log('\nContents');
    const direct = await renderBookingPdf(formId);
    if (!direct) fail('renderBookingPdf', 'returned nothing.');
    ok('renders standalone, for the fidelity harness', `${direct.byteLength} bytes`);

    const signatureCount = await prisma.signatureAsset.count({
      where: { stepRecord: { flowInstance: { bookingFormId: formId } } },
    });
    if (signatureCount !== SIGNATURE_GRID.length) {
      fail('pdf', `${signatureCount} signatures stored, expected ${SIGNATURE_GRID.length}`);
    }
    ok(`all ${SIGNATURE_GRID.length} signature slots have an image to print`);

    const auditRows = await prisma.auditLog.findMany({
      where: { bookingFormId: formId, action: { in: ['PDF', 'VIEW_SENSITIVE'] } },
      select: { action: true },
    });
    if (!auditRows.some((r) => r.action === 'PDF')) fail('audit', 'no PDF entry.');
    if (!auditRows.some((r) => r.action === 'VIEW_SENSITIVE')) {
      fail('audit', 'decrypting PAN and Adhaar to print was not audited.');
    }
    ok('audits both the generation and the sensitive decrypt');

    // --- fidelity: every printed label reached the page -------------------
    console.log('\nFidelity against the paper form');
    const text = extractText(bytes);

    /** Read off the photograph, in the order the paper prints them. */
    const PAGE_1_LABELS = [
      'BOOKING FORM',
      'Booking Date',
      'Project Name',
      'Villa',
      'Plot',
      'Apartment No',
      'Sales Executive',
      'Sales Head',
      'Telecaller',
      'Lead ID',
      'Source',
      'Booking ID',
      'PERSONAL INFORMATION (TO BE FILLED IN CAPITAL LETTERS ONLY)',
      'Mr./Mrs./Ms.',
      'Son / Daughter / Wife of : Mr./Mrs./Ms.',
      'Mobile No',
      'Alternate',
      'Email ID',
      'PAN (Mandatory)',
      'Adhaar No',
      'D.O.B',
      'Occupation',
      'Company Name',
      'Designation',
      'Location',
      'COMMUNICATION ADDRESS',
      'PERMANENT ADDRESS',
      'PROPERTY DETAILS',
      'Built-up Area (Sq.Ft)',
      'UDS (Sq.Ft.)',
      'Floor',
      'PAYMENT DETAILS',
      'Booking Advance',
      'Chq',
      'Card',
      'Online',
      'Ref.No',
      'Bank',
      'Payment Source',
      'Own Funds',
      'Home Loan',
      'REMARKS (if any)',
      'Sale Price',
      '(Excluding GST & Registration charges)',
      'Managing Director',
      '1ST Applicant',
      'AGM',
      'VP Sales',
      'CRM',
      '2ND Applicant',
      'DGM / GM',
      'MIS',
      'Director',
      'Sales Co-ordinator',
    ];

    const PAGE_2_LABELS = [
      'TERMS & CONDITIONS FOR PROVISIONAL ALLOTMENT',
      'General Instructions:',
      'I hereby agreed and accepted the above-mentioned terms & condition of this provisional allotment.',
      'For DAC Developers Pvt Ltd,',
      'APPLICANT (1)',
      'APPLICANT (2)',
      'AUTHORIZED SIGNATORY',
    ];

    const missing = [...PAGE_1_LABELS, ...PAGE_2_LABELS].filter(
      (label) => !containsLabel(text, label),
    );
    if (missing.length > 0) {
      fail('fidelity', `${missing.length} printed label(s) missing: ${missing.join(' | ')}`);
    }
    ok(`all ${PAGE_1_LABELS.length + PAGE_2_LABELS.length} printed labels are on the page`);

    const ordered = appearInOrder(text, PAGE_1_LABELS);
    if (!ordered.ok) {
      fail('fidelity', `page 1 is out of order — "${ordered.failedAt}" is in the wrong place`);
    }
    ok('page 1 reads in the order the paper prints it');

    const orderedTerms = appearInOrder(text, PAGE_2_LABELS);
    if (!orderedTerms.ok) {
      fail('fidelity', `page 2 is out of order at "${orderedTerms.failedAt}"`);
    }
    ok('page 2 reads in order, ending with the three signature labels');

    // The vertical marginal note, which is easy to lose in a layout change.
    if (!containsLabel(text, 'Agreed terms mentioned in the booking form')) {
      fail('fidelity', 'the sideways note up the left margin is missing.');
    }
    ok('the sideways margin note is printed');

    // --- the data actually landed in the boxes ----------------------------
    const values: Array<[string, string]> = [
      ['Booking ID', completed.bookingId ?? ''],
      ['first applicant', 'RAVI KUMAR'],
      ['second applicant', 'MEENA KUMARI'],
      ['guardian', 'SURESH KUMAR'],
      ['project', 'Demo Project'],
      ['apartment number', 'B-1204'],
      ['bank', 'HDFC BANK'],
      ['payment reference', 'TXN-99881'],
      ['occupation', 'SOFTWARE ENGINEER'],
      ['address', 'GANDHI STREET'],
    ];
    const absent = values.filter(([, value]) => value && !containsLabel(text, value));
    if (absent.length > 0) {
      fail('fidelity', `values missing from the print: ${absent.map(([n]) => n).join(', ')}`);
    }
    ok('the booking’s values are printed, not just the labels');

    // PAN and Aadhaar are printed in full — the paper form carries them, and
    // this IS that form. Both are spread one character per box.
    if (!containsLabel(text, 'ABCPK1234A')) fail('fidelity', 'the first PAN is not printed.');
    if (!containsLabel(text, primaryData.aadhaarPlain)) {
      fail('fidelity', 'the Adhaar number is not spread across its twelve boxes.');
    }
    ok('PAN and Adhaar are printed in full, one character per box');

    // The ticked options, which carry real meaning on a booking.
    const tickCount = (text.match(/ X /g) ?? []).length;
    if (tickCount < 3) {
      fail('fidelity', `only ${tickCount} tick(s) marked; expected property type, mode and source`);
    }
    ok(`${tickCount} tick boxes marked`);

    if (keepPath) {
      const target = resolve(keepPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      ok('copy written for the fidelity pass', target);
    }
  } finally {
    console.log('\nCleanup');
    let objects = 0;
    for (const id of created) {
      const assets = await prisma.signatureAsset.findMany({
        where: { stepRecord: { flowInstance: { bookingFormId: id } } },
        select: { id: true, storageKey: true },
      });
      const pdfs = await prisma.generatedPdf.findMany({
        where: { bookingFormId: id },
        select: { storageKey: true },
      });
      const documents = await prisma.formDocument.findMany({
        where: { bookingFormId: id },
        select: { storageKey: true },
      });

      for (const key of [
        ...assets.map((a) => a.storageKey),
        ...pdfs.map((p) => p.storageKey),
        ...documents.map((d) => d.storageKey),
      ]) {
        await driver.remove(key).catch(() => undefined);
        objects += 1;
      }

      await prisma.bookingForm.delete({ where: { id } }).catch(() => undefined);
      await prisma.signatureAsset
        .deleteMany({ where: { id: { in: assets.map((a) => a.id) } } })
        .catch(() => undefined);
    }
    ok(`${created.length} throwaway bookings and ${objects} stored objects deleted`);

    const orphans = await prisma.signatureAsset.count({ where: { stepRecord: null } });
    if (orphans > 0) console.warn(`  ! ${orphans} orphaned signature_assets row(s)`);

    const org = await prisma.organization.findFirst();
    if (org) {
      if (sequenceBefore) {
        await prisma.bookingSequence
          .update({
            where: { organizationId_year: { organizationId: org.id, year: sequenceBefore.year } },
            data: { lastValue: sequenceBefore.lastValue },
          })
          .catch(() => undefined);
        ok(`Booking ID sequence restored to ${sequenceBefore.lastValue}`);
      } else {
        const deleted = await prisma.bookingSequence
          .deleteMany({ where: { organizationId: org.id } })
          .catch(() => ({ count: 0 }));
        if (deleted.count > 0) ok('Booking ID sequence reset');
      }
    }
    await prisma.$disconnect();
  }

  console.log('\nAll PDF checks passed.\n');
}

main().catch(async (error) => {
  console.error('\nVerification failed:\n', error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
