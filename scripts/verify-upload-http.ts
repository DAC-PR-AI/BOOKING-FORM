import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/db';
import { storage } from '../src/lib/storage';
import { buildDocumentKey } from '../src/lib/storage/keys';
import { createUploadToken, UPLOAD_GRANT_TTL_SECONDS } from '../src/lib/storage/upload-token';

/**
 * Exercises the two local-storage route handlers over real HTTP, against a
 * running dev server.
 *
 * `verify-storage.ts` proves the driver works; this proves the HTTP edges do —
 * that a valid grant is accepted, that an oversized body is refused, and that
 * a signed download URL actually serves the bytes back.
 *
 * Run:  npm run dev          (in another terminal)
 *       npx tsx --conditions=react-server scripts/verify-upload-http.ts <session-cookie> <booking-form-id>
 *
 * The cookie comes from `scripts/dev-session.ts`.
 */

const BASE = process.env.APP_URL ?? 'http://localhost:3000';
const SAMPLE = Buffer.from(
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
  const cookie = process.argv[2];
  const bookingFormId = process.argv[3];
  if (!cookie || !bookingFormId) {
    throw new Error('Usage: verify-upload-http.ts <session-cookie> <booking-form-id>');
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set.');

  const driver = storage();
  if (driver.name !== 'local') {
    console.log(`Driver is "${driver.name}", not local — these routes are not in play. Skipping.`);
    return;
  }

  const form = await prisma.bookingForm.findUniqueOrThrow({
    where: { id: bookingFormId },
    include: { applicants: true },
  });
  const applicant = form.applicants.find((a) => a.applicantType === 'PRIMARY');
  if (!applicant) fail('fixture', 'the form has no primary applicant.');

  const documentType = await prisma.documentType.findFirstOrThrow({
    where: { organizationId: form.organizationId, key: 'photo_applicant_1' },
  });

  const session = await prisma.session.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!session) fail('fixture', 'no session rows. Run scripts/dev-session.ts first.');

  const storageKey = buildDocumentKey({
    bookingFormId: form.id,
    documentTypeKey: documentType.key,
    mimeType: 'image/png',
    unique: randomUUID(),
  });

  const grant = {
    userId: session.userId,
    bookingFormId: form.id,
    documentTypeId: documentType.id,
    applicantId: applicant.id,
    storageKey,
    contentType: 'image/png',
    maxBytes: documentType.maxBytes,
    expiresAt: Math.floor(Date.now() / 1000) + UPLOAD_GRANT_TTL_SECONDS,
  };

  const headers = { cookie: `dac_session=${cookie}`, 'content-type': 'image/png' };

  try {
    console.log('\nUpload route, valid grant');
    const token = createUploadToken(grant, secret);
    const response = await fetch(
      `${BASE}/api/storage/local/upload?token=${encodeURIComponent(token)}`,
      { method: 'PUT', headers, body: new Uint8Array(SAMPLE) },
    );
    if (response.status !== 204) {
      fail('upload', `expected 204, got ${response.status}: ${await response.text()}`);
    }
    ok('accepted', '204');

    const stat = await driver.stat(storageKey);
    if (!stat) fail('upload', 'the route returned 204 but no object landed.');
    if (stat.sizeBytes !== SAMPLE.byteLength) {
      fail('upload', `stored ${stat.sizeBytes} bytes, sent ${SAMPLE.byteLength}.`);
    }
    ok('object landed', `${stat.sizeBytes} bytes, ${stat.contentType}`);

    console.log('\nUpload route, refusals');
    const tiny = createUploadToken({ ...grant, maxBytes: 10, storageKey: `${storageKey}.2` }, secret);
    const tooBig = await fetch(
      `${BASE}/api/storage/local/upload?token=${encodeURIComponent(tiny)}`,
      { method: 'PUT', headers, body: new Uint8Array(SAMPLE) },
    );
    if (tooBig.status !== 413) fail('size ceiling', `expected 413, got ${tooBig.status}`);
    ok('oversized body refused', '413');

    const expired = createUploadToken(
      { ...grant, expiresAt: Math.floor(Date.now() / 1000) - 1, storageKey: `${storageKey}.3` },
      secret,
    );
    const stale = await fetch(
      `${BASE}/api/storage/local/upload?token=${encodeURIComponent(expired)}`,
      { method: 'PUT', headers, body: new Uint8Array(SAMPLE) },
    );
    if (stale.status !== 410) fail('expiry', `expected 410, got ${stale.status}`);
    ok('expired grant refused', '410');

    const otherUser = createUploadToken(
      { ...grant, userId: randomUUID(), storageKey: `${storageKey}.4` },
      secret,
    );
    const mismatched = await fetch(
      `${BASE}/api/storage/local/upload?token=${encodeURIComponent(otherUser)}`,
      { method: 'PUT', headers, body: new Uint8Array(SAMPLE) },
    );
    if (mismatched.status !== 403) {
      fail('session binding', `expected 403, got ${mismatched.status}`);
    }
    ok("another user's grant refused", '403');

    const noSession = await fetch(
      `${BASE}/api/storage/local/upload?token=${encodeURIComponent(createUploadToken({ ...grant, storageKey: `${storageKey}.5` }, secret))}`,
      { method: 'PUT', headers: { 'content-type': 'image/png' }, body: new Uint8Array(SAMPLE) },
    );
    if (noSession.status !== 403) fail('session required', `expected 403, got ${noSession.status}`);
    ok('grant without a session refused', '403');

    console.log('\nObject route');
    const signedUrl = await driver.createSignedDownloadUrl(storageKey, 60);
    const served = await fetch(`${BASE}${signedUrl}`);
    if (!served.ok) fail('download', `expected 200, got ${served.status}`);

    const body = Buffer.from(await served.arrayBuffer());
    if (!body.equals(SAMPLE)) fail('download', 'the served bytes differ from what was uploaded.');
    ok('served byte-identical', `${body.byteLength} bytes`);

    const contentType = served.headers.get('content-type');
    if (contentType !== 'image/png') fail('download', `content-type was "${contentType}".`);
    ok('content type preserved', contentType);

    const cacheControl = served.headers.get('cache-control') ?? '';
    if (!cacheControl.includes('no-store')) {
      fail('download', `personal data served without no-store: "${cacheControl}".`);
    }
    ok('no-store set', cacheControl);

    // Flip the last character of the signature, leaving everything else intact.
    const tampered = new URL(signedUrl, BASE);
    const realSignature = tampered.searchParams.get('sig') ?? '';
    tampered.searchParams.set(
      'sig',
      realSignature.slice(0, -1) + (realSignature.endsWith('A') ? 'B' : 'A'),
    );
    if (tampered.searchParams.get('sig') === realSignature) {
      fail('download', 'the test failed to tamper with the signature.');
    }

    const forged = await fetch(tampered);
    if (forged.status !== 404) fail('download', `a forged signature returned ${forged.status}.`);
    ok('forged signature refused', '404');
  } finally {
    console.log('\nCleanup');
    for (const suffix of ['', '.2', '.3', '.4', '.5']) {
      await driver.remove(`${storageKey}${suffix}`).catch(() => undefined);
    }
    ok('objects deleted');
    await prisma.$disconnect();
  }

  console.log('\nAll HTTP upload checks passed.\n');
}

main().catch(async (error) => {
  console.error('\nVerification failed:\n', error);
  await prisma.$disconnect();
  process.exit(1);
});
