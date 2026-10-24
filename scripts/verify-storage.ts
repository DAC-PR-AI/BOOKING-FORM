import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/db';
import { storage, storageStatus } from '../src/lib/storage';
import { buildDocumentKey } from '../src/lib/storage/keys';
import {
  createUploadToken,
  verifyUploadToken,
  UPLOAD_GRANT_TTL_SECONDS,
} from '../src/lib/storage/upload-token';
import { buildChecklist, checklistProgress } from '../src/lib/documents/checklist';

/**
 * End-to-end check of the document pipeline against the real database and the
 * configured storage driver.
 *
 * Unit tests cover the pure parts; this covers the parts that only break in
 * reality — that the driver can actually write and read back, that a signed
 * URL verifies, that the Prisma writes line up with the schema, and that the
 * checklist agrees with what is in the database.
 *
 * Run:  npx tsx scripts/verify-storage.ts
 *
 * It creates a throwaway booking form, then deletes it and its object. Safe to
 * run repeatedly. Refuses to run against production.
 */

const SAMPLE_PNG = Buffer.from(
  // 1×1 transparent PNG.
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function ok(label: string, detail = ''): void {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Throws rather than calling process.exit, so the `finally` block still runs
 * and a failed run does not leave its test object behind in storage.
 */
function fail(label: string, detail: string): never {
  throw new Error(`${label} — ${detail}`);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the verification script against production.');
  }

  console.log('\nStorage configuration');
  const status = storageStatus();
  ok(`driver: ${status.driver}`);
  if (status.residency.inIndia) {
    ok('residency', status.residency.detail);
  } else {
    console.warn(`  ! residency NOT confirmed — ${status.residency.detail}`);
  }

  const driver = storage();

  // --- fixtures -----------------------------------------------------------
  const organization = await prisma.organization.findFirst();
  if (!organization) fail('seed data', 'no organisation found. Run `npm run db:seed`.');

  const user = await prisma.user.findFirst({
    where: { organizationId: organization.id, role: { name: 'SALES_EXECUTIVE' } },
    include: { role: true },
  });
  if (!user) fail('seed data', 'no sales executive found. Run `npm run db:seed`.');

  const template = await prisma.formTemplate.findFirst({
    where: { organizationId: organization.id, key: 'booking_form' },
  });
  if (!template) fail('seed data', 'booking form template missing. Run `npm run db:seed`.');

  const documentType = await prisma.documentType.findFirst({
    where: { organizationId: organization.id, key: 'photo_applicant_1' },
  });
  if (!documentType) fail('seed data', 'document types missing. Run `npm run db:seed`.');

  console.log('\nFixtures');
  const form = await prisma.bookingForm.create({
    data: {
      organizationId: organization.id,
      formTemplateId: template.id,
      createdById: user.id,
      bookingDate: new Date(),
      status: 'DRAFT',
      remarks: 'VERIFY-STORAGE throwaway',
      applicants: { create: [{ applicantType: 'PRIMARY', fullName: 'VERIFY TEST' }] },
    },
    include: { applicants: true },
  });
  ok('created a throwaway draft', form.id);

  const applicant = form.applicants[0];
  if (!applicant) fail('fixtures', 'the draft has no primary applicant row.');

  let storageKey: string | null = null;

  try {
    // --- grant ------------------------------------------------------------
    console.log('\nUpload grant');
    storageKey = buildDocumentKey({
      bookingFormId: form.id,
      documentTypeKey: documentType.key,
      mimeType: 'image/png',
      unique: randomUUID(),
    });
    ok('built a storage key', storageKey);

    const secret = process.env.SESSION_SECRET;
    if (!secret) fail('environment', 'SESSION_SECRET is not set.');

    const token = createUploadToken(
      {
        userId: user.id,
        bookingFormId: form.id,
        documentTypeId: documentType.id,
        applicantId: applicant.id,
        storageKey,
        contentType: 'image/png',
        maxBytes: documentType.maxBytes,
        expiresAt: Math.floor(Date.now() / 1000) + UPLOAD_GRANT_TTL_SECONDS,
      },
      secret,
    );

    const verified = verifyUploadToken(token, secret);
    if (!verified.ok) fail('grant verification', verified.reason);
    if (verified.grant.storageKey !== storageKey) {
      fail('grant verification', 'the key did not survive the round trip.');
    }
    ok('grant signed and verified', `${token.length} chars`);

    const ticket = await driver.createSignedUpload(
      storageKey,
      'image/png',
      UPLOAD_GRANT_TTL_SECONDS,
      token,
    );
    ok('signed upload URL', ticket.url.slice(0, 72) + (ticket.url.length > 72 ? '…' : ''));

    // --- write / read back ------------------------------------------------
    // The browser would PUT to the URL above. The driver write below is the
    // same operation the upload route performs once the grant checks out.
    console.log('\nStorage round trip');
    const { writeLocalObject } = await import('../src/lib/storage/local');
    if (driver.name === 'local') {
      await writeLocalObject(storageKey, SAMPLE_PNG, 'image/png');
    } else {
      const response = await fetch(ticket.url, {
        method: ticket.method,
        headers: ticket.headers,
        body: new Uint8Array(SAMPLE_PNG),
      });
      if (!response.ok) {
        fail('upload', `${response.status} ${await response.text()}`);
      }
    }
    ok('wrote the object');

    const stat = await driver.stat(storageKey);
    if (!stat) fail('stat', 'the object was not found after writing it.');
    if (stat.sizeBytes !== SAMPLE_PNG.byteLength) {
      fail('stat', `size was ${stat.sizeBytes}, expected ${SAMPLE_PNG.byteLength}.`);
    }
    ok('stat agrees', `${stat.sizeBytes} bytes, ${stat.contentType}`);

    const fetched = await driver.get(storageKey);
    if (!fetched.body.equals(SAMPLE_PNG)) fail('read back', 'the bytes differ.');
    ok('read back byte-identical');

    const signedUrl = await driver.createSignedDownloadUrl(storageKey, 60);
    ok('signed download URL', signedUrl.slice(0, 72) + (signedUrl.length > 72 ? '…' : ''));

    if (driver.name === 'local') {
      const { verifyLocalSignature } = await import('../src/lib/storage/local');
      const params = new URLSearchParams(signedUrl.split('?')[1] ?? '');
      const key = params.get('key') ?? '';
      const exp = Number(params.get('exp'));
      const sig = params.get('sig') ?? '';

      if (!verifyLocalSignature(key, exp, sig)) fail('signature', 'a fresh URL did not verify.');
      ok('signature verifies');

      if (verifyLocalSignature(key, exp, `${sig.slice(0, -1)}X`)) {
        fail('signature', 'a tampered signature was accepted.');
      }
      ok('tampered signature rejected');

      if (verifyLocalSignature(key, Math.floor(Date.now() / 1000) - 1, sig)) {
        fail('signature', 'an expired URL was accepted.');
      }
      ok('expired URL rejected');
    }

    // --- the document row -------------------------------------------------
    console.log('\nDocument row and checklist');
    const document = await prisma.formDocument.create({
      data: {
        bookingFormId: form.id,
        documentTypeId: documentType.id,
        applicantId: applicant.id,
        storageKey,
        originalName: 'verify.png',
        mimeType: 'image/png',
        sizeBytes: stat.sizeBytes,
        uploadedById: user.id,
      },
    });
    ok('recorded the document', document.id);

    const types = await prisma.documentType.findMany({
      where: { organizationId: organization.id, isActive: true },
      include: { requirement: true },
      orderBy: { sortOrder: 'asc' },
    });
    const documents = await prisma.formDocument.findMany({
      where: { bookingFormId: form.id },
      select: {
        id: true,
        documentTypeId: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        uploadedAt: true,
      },
    });

    const slots = buildChecklist({
      types: types.map((t) => ({
        id: t.id,
        key: t.key,
        label: t.label,
        helpText: t.helpText,
        scope: t.scope,
        appliesTo: t.appliesTo,
        acceptedMimeTypes: t.acceptedMimeTypes,
        maxBytes: t.maxBytes,
        sortOrder: t.sortOrder,
        requirement: t.requirement
          ? {
              isMandatory: t.requirement.isMandatory,
              requiredIfSecondApplicant: t.requirement.requiredIfSecondApplicant,
            }
          : null,
      })),
      documents,
      hasSecondApplicant: false,
    });

    const progress = checklistProgress(slots);
    ok(
      'checklist built',
      `${slots.length} rows, ${progress.requiredSatisfied}/${progress.requiredTotal} required attached`,
    );

    const photoSlot = slots.find((s) => s.type.key === 'photo_applicant_1');
    if (!photoSlot?.document) fail('checklist', 'the uploaded photo was not matched to its slot.');
    ok('the upload is matched to its slot');

    if (slots.some((s) => s.type.appliesTo === 'SECONDARY')) {
      fail('checklist', 'second-applicant rows appeared for a sole applicant.');
    }
    ok('second-applicant rows correctly hidden');

    console.log(`\n  Still needed: ${progress.missing.join(', ') || '(nothing)'}`);
  } finally {
    // --- cleanup ----------------------------------------------------------
    console.log('\nCleanup');
    if (storageKey) {
      await driver.remove(storageKey).catch(() => undefined);
      const gone = await driver.stat(storageKey).catch(() => null);
      if (gone) {
        console.warn(`  ! object still present: ${storageKey}`);
      } else {
        ok('object deleted');
      }
    }
    await prisma.bookingForm.delete({ where: { id: form.id } });
    ok('throwaway draft deleted');
    await prisma.$disconnect();
  }

  console.log('\nAll storage checks passed.\n');
}

main().catch(async (error) => {
  console.error('\nVerification failed:\n', error);
  await prisma.$disconnect();
  process.exit(1);
});
