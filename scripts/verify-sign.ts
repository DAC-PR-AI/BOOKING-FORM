import 'dotenv/config';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { Role, User } from '@prisma/client';
import { prisma } from '../src/lib/db';
import { storage } from '../src/lib/storage';
import { performSubmit } from '../src/lib/forms/submit';
import { returnStep, signStep } from '../src/lib/flow/sign';
import { canActOnStep, type FormStatus } from '../src/lib/flow/act';
import { pendingForUserWhere } from '../src/lib/flow/queue';
import { encryptField, last4, toDbBytes } from '../src/lib/crypto/field-encryption';
import { verhoeffCheckDigit } from '../src/lib/validation/aadhaar';

/**
 * End-to-end check of the Phase 5 signature flow against the real database and
 * the configured storage driver.
 *
 * The decision rules are unit tested in `act.test.ts`; this covers what only
 * breaks for real: that signing writes the image, advances the pipeline, flips
 * the form's status at the right moments, and refuses the wrong person — and
 * that the queue query agrees with `canActOnStep`, which is the one place the
 * two could silently diverge.
 *
 * Run:  npx tsx --conditions=react-server scripts/verify-sign.ts
 *
 * Creates throwaway bookings and deletes them, with their signature objects.
 */

type SessionUser = User & { role: Role };

function ok(label: string, detail = ''): void {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

/** Throws rather than exiting, so the cleanup in `finally` always runs. */
function fail(label: string, detail: string): never {
  throw new Error(`${label} — ${detail}`);
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    fail('seed data', `${what}. Run \`npm run db:seed\`.`);
  }
  return value;
}

// --- a structurally valid PNG, big enough to pass the blank-pad heuristic ---

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function signaturePng(): Buffer {
  const width = 600;
  const height = 200;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  const parts = [PNG_MAGIC, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw))];
  const current = parts.reduce((n, p) => n + p.byteLength, 0);
  // Pad past MIN_SIGNATURE_BYTES, as real ink would.
  if (current < 4096) parts.push(chunk('teXt', Buffer.alloc(4096 - current, 0x41)));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

const SIGNATURE = signaturePng();
const SIGNATURE_URL = `data:image/png;base64,${SIGNATURE.toString('base64')}`;

const created: string[] = [];
let sequenceBefore: { year: number; lastValue: number } | null = null;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the verification script against production.');
  }

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
  const admin = await userWithRole('ADMIN');
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

  function applicantData(name: string, aadhaarPrefix: string) {
    const pan = 'ABCPK1234A';
    const aadhaar = `${aadhaarPrefix}${verhoeffCheckDigit(aadhaarPrefix)}`;
    return {
      salutation: 'MR' as const,
      fullName: name,
      relationType: 'SON_OF' as const,
      guardianSalutation: 'MR' as const,
      guardianName: 'SURESH KUMAR',
      mobileNo: '9876543210',
      email: 'verify@example.com',
      panEncrypted: toDbBytes(encryptField(pan)),
      panLast4: last4(pan),
      aadhaarEncrypted: toDbBytes(encryptField(aadhaar)),
      aadhaarLast4: last4(aadhaar),
      dob: new Date('1990-05-14T00:00:00Z'),
      occupation: 'ENGINEER',
    };
  }

  /** A complete, submitted booking. Joint by default, so all nine steps apply. */
  async function submittedBooking(label: string, joint = true): Promise<string> {
    const form = await prisma.bookingForm.create({
      data: {
        organizationId: organization.id,
        formTemplateId: template.id,
        createdById: creator.id,
        bookingDate: new Date(),
        status: 'DRAFT',
        remarks: `VERIFY-SIGN ${label}`,
        projectId: project.id,
        propertyType: 'VILLA',
        salesExecutive: 'PRIYA S',
        salesHead: 'ARUN M',
        leadId: 'LEAD-4471',
        source: source.value,
        builtUpAreaSqft: '1450',
        udsSqft: '600',
        bookingAdvancePaise: 50_000_000n,
        paymentMode: 'ONLINE',
        paymentRefNo: 'TXN-99881',
        paymentDate: new Date(),
        bank: 'HDFC BANK',
        paymentSource: 'OWN_FUNDS',
        salePricePaise: 750_000_000n,
        applicants: {
          create: joint
            ? [
                { applicantType: 'PRIMARY', ...applicantData('RAVI KUMAR', '23456789012') },
                { applicantType: 'SECONDARY', ...applicantData('MEENA KUMARI', '34567890123') },
              ]
            : [{ applicantType: 'PRIMARY', ...applicantData('RAVI KUMAR', '23456789012') }],
        },
        addresses: {
          create: (['COMMUNICATION', 'PERMANENT'] as const).map((type) => ({
            type,
            line1: '12 GANDHI STREET',
            line2: 'ADYAR',
            line3: 'CHENNAI 600020',
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
        requirement: joint
          ? { OR: [{ isMandatory: true }, { requiredIfSecondApplicant: true }] }
          : { isMandatory: true },
      },
    });
    for (const type of types) {
      await prisma.formDocument.create({
        data: {
          bookingFormId: form.id,
          documentTypeId: type.id,
          applicantId:
            type.scope === 'APPLICANT'
              ? applicants.find((a) => a.applicantType === type.appliesTo)?.id ?? null
              : null,
          storageKey: `bookings/${form.id}/${type.key}/verify.pdf`,
          originalName: 'verify.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          uploadedById: creator.id,
        },
      });
    }

    const result = await performSubmit(creator, form.id, { tncAccepted: true });
    if (!result.ok) fail('fixture', `could not submit: ${result.error}`);
    return form.id;
  }

  async function statusOf(formId: string) {
    return prisma.bookingForm.findUniqueOrThrow({
      where: { id: formId },
      select: {
        status: true,
        currentStepOrder: true,
        completedAt: true,
        returnToStepOrder: true,
      },
    });
  }

  async function stepOf(formId: string, orderIndex: number) {
    return prisma.formStepRecord.findFirstOrThrow({
      where: { orderIndex, flowInstance: { bookingFormId: formId } },
      include: { signatureAsset: true, flowStep: { select: { action: true } } },
    });
  }

  const driver = storage();

  try {
    // --- signing all nine steps ------------------------------------------
    console.log('\nSigning the whole pipeline');
    const formId = await submittedBooking('full');

    const before = await statusOf(formId);
    if (before.status !== 'SUBMITTED') fail('fixture', `status is ${before.status}`);
    ok('starts SUBMITTED, waiting on step 1', `step ${before.currentStepOrder}`);

    // An applicant step belongs to the creator, nobody else.
    const wrongPerson = await signStep(byStepRole[3] as SessionUser, {
      formId,
      orderIndex: 1,
      signatureDataUrl: SIGNATURE_URL,
      signerName: 'RAVI KUMAR',
    });
    if (wrongPerson.ok) fail('signStep', 'an AGM signed an in-person applicant step.');
    ok('refuses an applicant step to anyone but the creator');

    const noName = await signStep(creator, {
      formId,
      orderIndex: 1,
      signatureDataUrl: SIGNATURE_URL,
    });
    if (noName.ok) fail('signStep', 'an applicant signature was accepted with no name.');
    ok('requires the applicant’s typed name');

    const blankPad = await signStep(creator, {
      formId,
      orderIndex: 1,
      signatureDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      signerName: 'RAVI KUMAR',
    });
    if (blankPad.ok) fail('signStep', 'a truncated PNG was accepted.');
    ok('rejects a signature that is not a real PNG');

    // Out of order: step 3 is LOCKED until 1 and 2 are done.
    const outOfOrder = await signStep(byStepRole[3] as SessionUser, {
      formId,
      orderIndex: 3,
      signatureDataUrl: SIGNATURE_URL,
    });
    if (outOfOrder.ok) fail('signStep', 'a locked step was signed out of order.');
    ok('refuses a locked step, so the order cannot be jumped');

    const step1 = await signStep(creator, {
      formId,
      orderIndex: 1,
      signatureDataUrl: SIGNATURE_URL,
      signerName: 'Ravi Kumar',
    });
    if (!step1.ok) fail('signStep', `step 1 refused: ${step1.error}`);
    ok('signs step 1 in person', `now waiting on ${step1.nextLabel}`);

    const afterFirst = await statusOf(formId);
    if (afterFirst.status !== 'IN_REVIEW') {
      fail('signStep', `status after the first signature is ${afterFirst.status}, expected IN_REVIEW`);
    }
    ok('flips the form to IN_REVIEW on the first signature');

    const record1 = await stepOf(formId, 1);
    if (record1.status !== 'SIGNED') fail('signStep', `step 1 is ${record1.status}`);
    if (!record1.signatureAsset) fail('signStep', 'no signature asset was created.');
    if (record1.signatureAsset.signerName !== 'RAVI KUMAR') {
      fail('signStep', `signer name is ${record1.signatureAsset.signerName}`);
    }
    if (record1.signatureAsset.signedByUserId !== null) {
      fail('signStep', 'an applicant signature was attributed to a user account.');
    }
    if (record1.witnessUserId !== creator.id) {
      fail('signStep', 'the creator was not recorded as witness.');
    }
    ok('records the applicant as signer and the creator as witness');

    const stored = await driver.stat(record1.signatureAsset.storageKey);
    if (!stored) fail('signStep', 'the signature image was not written to storage.');
    const fetched = await driver.get(record1.signatureAsset.storageKey);
    if (!fetched.body.equals(SIGNATURE)) fail('signStep', 'the stored bytes differ.');
    const sha = createHash('sha256').update(SIGNATURE).digest('hex');
    if (record1.signatureAsset.sha256 !== sha) fail('signStep', 'the recorded hash is wrong.');
    ok('stores the image byte-identical, with its hash', `${stored.sizeBytes} bytes`);
    if (record1.signatureAsset.widthPx !== 600 || record1.signatureAsset.heightPx !== 200) {
      fail('signStep', 'the PNG dimensions were not read.');
    }
    ok('reads the PNG dimensions for the PDF to place it');

    // Re-signing a completed step must not work.
    const twice = await signStep(creator, {
      formId,
      orderIndex: 1,
      signatureDataUrl: SIGNATURE_URL,
      signerName: 'RAVI KUMAR',
    });
    if (twice.ok) fail('signStep', 'a signed step was signed again.');
    ok('refuses to sign a step twice');

    const step2 = await signStep(creator, {
      formId,
      orderIndex: 2,
      signatureDataUrl: SIGNATURE_URL,
      signerName: 'Meena Kumari',
    });
    if (!step2.ok) fail('signStep', `step 2 refused: ${step2.error}`);
    ok('signs the second applicant', `now waiting on ${step2.nextLabel}`);

    // Staff steps, in order, each by the right role.
    for (const order of [3, 4, 5]) {
      const signer = byStepRole[order] as SessionUser;

      const wrongRole = await signStep(byStepRole[9] as SessionUser, {
        formId,
        orderIndex: order,
        signatureDataUrl: SIGNATURE_URL,
      });
      if (wrongRole.ok) fail('signStep', `the CRM signed step ${order}.`);

      const adminAttempt = await signStep(admin, {
        formId,
        orderIndex: order,
        signatureDataUrl: SIGNATURE_URL,
      });
      if (adminAttempt.ok) fail('signStep', `an admin signed step ${order} as someone else.`);

      const result = await signStep(signer, {
        formId,
        orderIndex: order,
        signatureDataUrl: SIGNATURE_URL,
      });
      if (!result.ok) fail('signStep', `step ${order} refused: ${result.error}`);
    }
    ok('signs steps 3-5, refusing the wrong role and the admin at each');

    // The Co-ordinator must tick Validated.
    const coordinator = byStepRole[6] as SessionUser;
    const notValidated = await signStep(coordinator, {
      formId,
      orderIndex: 6,
      signatureDataUrl: SIGNATURE_URL,
    });
    if (notValidated.ok) fail('signStep', 'the Co-ordinator signed without validating.');
    ok('refuses the Co-ordinator’s signature without the validation tick');

    const validated = await signStep(coordinator, {
      formId,
      orderIndex: 6,
      signatureDataUrl: SIGNATURE_URL,
      validated: true,
    });
    if (!validated.ok) fail('signStep', `step 6 refused: ${validated.error}`);

    const record6 = await stepOf(formId, 6);
    if (record6.status !== 'VALIDATED') {
      fail('signStep', `step 6 is ${record6.status}, expected VALIDATED`);
    }
    if (!record6.validated) fail('signStep', 'the validated flag was not set.');
    ok('records step 6 as VALIDATED, keeping it distinct from a plain signature');

    for (const order of [7, 8]) {
      const result = await signStep(byStepRole[order] as SessionUser, {
        formId,
        orderIndex: order,
        signatureDataUrl: SIGNATURE_URL,
      });
      if (!result.ok) fail('signStep', `step ${order} refused: ${result.error}`);
    }
    ok('signs steps 7 and 8');

    const last = await signStep(byStepRole[9] as SessionUser, {
      formId,
      orderIndex: 9,
      signatureDataUrl: SIGNATURE_URL,
    });
    if (!last.ok) fail('signStep', `step 9 refused: ${last.error}`);
    if (!last.completed) fail('signStep', 'signing the last step did not complete the booking.');
    ok('signing step 9 completes the booking', last.bookingId ?? '');

    const done = await statusOf(formId);
    if (done.status !== 'COMPLETED') fail('signStep', `final status is ${done.status}`);
    if (done.currentStepOrder !== null) {
      fail('signStep', `currentStepOrder is ${done.currentStepOrder}, expected null`);
    }
    if (!done.completedAt) fail('signStep', 'completedAt was not set.');
    ok('sets COMPLETED, clears the current step and stamps completedAt');

    const signedCount = await prisma.formStepRecord.count({
      where: {
        flowInstance: { bookingFormId: formId },
        status: { in: ['SIGNED', 'VALIDATED'] },
      },
    });
    if (signedCount !== 9) fail('signStep', `${signedCount} steps signed, expected 9`);
    ok('all nine steps carry a signature');

    const afterComplete = await signStep(byStepRole[9] as SessionUser, {
      formId,
      orderIndex: 9,
      signatureDataUrl: SIGNATURE_URL,
    });
    if (afterComplete.ok) fail('signStep', 'a completed booking accepted another signature.');
    ok('refuses any signature once the booking is complete');

    const audits = await prisma.auditLog.count({
      where: { bookingFormId: formId, action: { in: ['SIGN', 'VALIDATE'] } },
    });
    if (audits !== 9) fail('signStep', `${audits} audit entries, expected 9`);
    ok('writes one audit entry per signature, in the same transaction');

    // --- returning --------------------------------------------------------
    console.log('\nReturning and resuming');
    const returnId = await submittedBooking('return');

    await signStep(creator, {
      formId: returnId,
      orderIndex: 1,
      signatureDataUrl: SIGNATURE_URL,
      signerName: 'RAVI KUMAR',
    });
    await signStep(creator, {
      formId: returnId,
      orderIndex: 2,
      signatureDataUrl: SIGNATURE_URL,
      signerName: 'MEENA KUMARI',
    });
    for (const order of [3, 4, 5]) {
      await signStep(byStepRole[order] as SessionUser, {
        formId: returnId,
        orderIndex: order,
        signatureDataUrl: SIGNATURE_URL,
      });
    }

    const terse = await returnStep(coordinator, {
      formId: returnId,
      orderIndex: 6,
      comment: 'no',
    });
    if (terse.ok) fail('returnStep', 'a return with a two-character reason was accepted.');
    ok('refuses a return with no real explanation');

    const returned = await returnStep(coordinator, {
      formId: returnId,
      orderIndex: 6,
      comment: '  The bank name   does not match the cheque. ',
    });
    if (!returned.ok) fail('returnStep', `the return was refused: ${returned.error}`);
    ok('returns the booking to its creator', returned.returnedToCreator);

    const afterReturn = await statusOf(returnId);
    if (afterReturn.status !== 'RETURNED') fail('returnStep', `status is ${afterReturn.status}`);
    if (afterReturn.returnToStepOrder !== 6) {
      fail('returnStep', `returnToStepOrder is ${afterReturn.returnToStepOrder}, expected 6`);
    }
    ok('records RETURNED and where to resume');

    const record6b = await stepOf(returnId, 6);
    if (record6b.comment !== 'The bank name does not match the cheque.') {
      fail('returnStep', `the comment was stored as "${record6b.comment}"`);
    }
    ok('stores the tidied comment, which is all the creator sees');

    const keptSignatures = await prisma.formStepRecord.count({
      where: {
        flowInstance: { bookingFormId: returnId },
        status: { in: ['SIGNED', 'VALIDATED'] },
      },
    });
    if (keptSignatures !== 5) {
      fail('returnStep', `${keptSignatures} signatures survived the return, expected 5`);
    }
    ok('keeps the five signatures already collected');

    const returnAudit = await prisma.auditLog.findFirst({
      where: { bookingFormId: returnId, action: 'RETURN' },
      select: { detail: true },
    });
    if (!returnAudit) fail('returnStep', 'no RETURN audit entry.');
    ok('writes a RETURN audit entry', returnAudit.detail?.slice(0, 48) ?? '');

    // The creator fixes it and resubmits.
    const resubmitted = await performSubmit(creator, returnId, { tncAccepted: true });
    if (!resubmitted.ok) fail('resubmit', `refused: ${resubmitted.error}`);
    if (resubmitted.currentStepOrder !== 6) {
      fail('resubmit', `resumed at ${resubmitted.currentStepOrder}, expected 6`);
    }
    ok('resumes at step 6, not step 1');

    const resumedSignatures = await prisma.formStepRecord.count({
      where: {
        flowInstance: { bookingFormId: returnId },
        status: { in: ['SIGNED', 'VALIDATED'] },
      },
    });
    if (resumedSignatures !== 5) fail('resubmit', 'signatures were lost on resubmission.');
    ok('the five signatures are still intact after resubmission');

    const signedAfterResume = await signStep(coordinator, {
      formId: returnId,
      orderIndex: 6,
      signatureDataUrl: SIGNATURE_URL,
      validated: true,
    });
    if (!signedAfterResume.ok) {
      fail('signStep', `step 6 refused after resume: ${signedAfterResume.error}`);
    }
    ok('the returning step can be signed once the form comes back');

    // --- the queue query agrees with the rules ----------------------------
    console.log('\nQueue query');
    const queueId = await submittedBooking('queue');

    const agm = byStepRole[3] as SessionUser;
    const notYetMine = await prisma.formStepRecord.count({
      where: { ...pendingForUserWhere(agm), flowInstance: { bookingForm: { id: queueId } } },
    });
    if (notYetMine !== 0) {
      fail('queue', 'the AGM sees a booking still waiting on the applicants.');
    }
    ok('a signatory sees nothing before their turn');

    await signStep(creator, {
      formId: queueId,
      orderIndex: 1,
      signatureDataUrl: SIGNATURE_URL,
      signerName: 'RAVI KUMAR',
    });
    await signStep(creator, {
      formId: queueId,
      orderIndex: 2,
      signatureDataUrl: SIGNATURE_URL,
      signerName: 'MEENA KUMARI',
    });

    const nowMine = await prisma.formStepRecord.findMany({
      where: { ...pendingForUserWhere(agm), flowInstance: { bookingForm: { id: queueId } } },
      include: { flowStep: { select: { roleId: true, action: true, actsOnCreatorDevice: true } } },
    });
    if (nowMine.length !== 1 || nowMine[0]?.orderIndex !== 3) {
      fail('queue', `the AGM sees ${nowMine.length} steps, expected step 3`);
    }
    ok('the booking appears the moment it reaches them');

    // The predicate and the rule must give the same answer.
    const queueForm = await statusOf(queueId);
    for (const record of nowMine) {
      const allowed = canActOnStep(
        { userId: agm.id, roleId: agm.roleId, isCreator: false },
        {
          orderIndex: record.orderIndex,
          status: record.status,
          assigneeId: record.assigneeId,
          roleId: record.flowStep.roleId,
          action: record.flowStep.action,
          actsOnCreatorDevice: record.flowStep.actsOnCreatorDevice,
        },
        queueForm.status as FormStatus,
      ).allowed;
      if (!allowed) fail('queue', 'the query offered a step that canActOnStep refuses.');
    }
    ok('every step the query offers is one canActOnStep allows');

    const misQueue = await prisma.formStepRecord.count({
      where: {
        ...pendingForUserWhere(byStepRole[7] as SessionUser),
        flowInstance: { bookingForm: { id: queueId } },
      },
    });
    if (misQueue !== 0) fail('queue', 'MIS sees a booking sitting on the AGM.');
    ok('another role still sees nothing');

    // Once claimed by one AGM, a colleague must not see it.
    await signStep(agm, { formId: queueId, orderIndex: 3, signatureDataUrl: SIGNATURE_URL });
    const afterAgm = await prisma.formStepRecord.count({
      where: { ...pendingForUserWhere(agm), flowInstance: { bookingForm: { id: queueId } } },
    });
    if (afterAgm !== 0) fail('queue', 'the AGM still sees the step after signing it.');
    ok('the step leaves their queue once signed');
  } finally {
    console.log('\nCleanup');
    let objects = 0;
    for (const id of created) {
      const assets = await prisma.signatureAsset.findMany({
        where: { stepRecord: { flowInstance: { bookingFormId: id } } },
        select: { storageKey: true },
      });
      for (const asset of assets) {
        await driver.remove(asset.storageKey).catch(() => undefined);
        objects += 1;
      }
      await prisma.bookingForm.delete({ where: { id } }).catch(() => undefined);
    }
    ok(`${created.length} throwaway bookings and ${objects} signature objects deleted`);

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

  console.log('\nAll signature-flow checks passed.\n');
}

main().catch(async (error) => {
  console.error('\nVerification failed:\n', error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
