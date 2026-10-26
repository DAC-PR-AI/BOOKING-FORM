import 'dotenv/config';
import type { Role, User } from '@prisma/client';
import { prisma } from '../src/lib/db';
import { storage } from '../src/lib/storage';
import { performSubmit } from '../src/lib/forms/submit';
import { returnStep, signStep } from '../src/lib/flow/sign';
import { unreadCount } from '../src/lib/notify/dispatch';
import { runProjectSync, syncStatus } from '../src/lib/projects/sync';
import { samplePngDataUrl } from '../src/lib/pdf/sample-image';
import { encryptField, last4, toDbBytes } from '../src/lib/crypto/field-encryption';
import { verhoeffCheckDigit } from '../src/lib/validation/aadhaar';

/**
 * End-to-end check of Phase 7's notifications and the project sync.
 *
 * The wording is unit tested; what needs the real database is **who gets
 * told**. A staff step is unassigned until somebody claims it, so it has to
 * reach every active holder of the role — tell one named person and you tell
 * the wrong person half the time. That rule, and the rule that a notification
 * never blocks a signature, are what this checks.
 *
 * Run:  npm run verify:notify
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

const SIGNATURE = samplePngDataUrl(480, 140);
const created: string[] = [];
let sequenceBefore: { year: number; lastValue: number } | null = null;
let extraAgmId: string | null = null;

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
  const agm = await userWithRole('AGM');
  const coordinator = await userWithRole('SALES_COORDINATOR');
  const mis = await userWithRole('MIS');

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

  function applicant(name: string, aadhaarPrefix: string) {
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

  async function submittedBooking(label: string): Promise<string> {
    const form = await prisma.bookingForm.create({
      data: {
        organizationId: organization.id,
        formTemplateId: template.id,
        createdById: creator.id,
        bookingDate: new Date(),
        status: 'DRAFT',
        remarks: `VERIFY-NOTIFY ${label}`,
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
          create: [{ applicantType: 'PRIMARY', ...applicant('RAVI KUMAR', '23456789012') }],
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

    const types = await prisma.documentType.findMany({
      where: { organizationId: organization.id, isActive: true, requirement: { isMandatory: true } },
    });
    const applicants = await prisma.applicant.findMany({ where: { bookingFormId: form.id } });
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

    const submitted = await performSubmit(creator, form.id, { tncAccepted: true });
    if (!submitted.ok) fail('fixture', `could not submit: ${submitted.error}`);
    return form.id;
  }

  /** Notifications for one user about one booking, newest first. */
  async function inboxFor(userId: string, formId: string) {
    return prisma.notification.findMany({
      where: { userId, link: { contains: formId } },
      orderBy: { createdAt: 'desc' },
    });
  }

  const driver = storage();

  try {
    // --- submit opens step 1, which is the creator's own capture ----------
    console.log('\nWhen a booking is submitted');
    const formId = await submittedBooking('flow');

    const creatorInbox = await inboxFor(creator.id, formId);
    if (creatorInbox.length !== 1) {
      fail('notify', `the creator has ${creatorInbox.length} notifications, expected 1`);
    }
    if (!creatorInbox[0]?.title.includes('applicant signature')) {
      fail('notify', `wrong notification: "${creatorInbox[0]?.title}"`);
    }
    ok('the creator is told to capture the applicant signature');

    const agmTooEarly = await inboxFor(agm.id, formId);
    if (agmTooEarly.length !== 0) {
      fail('notify', 'the AGM was told about a booking still on the applicant step');
    }
    ok('nobody downstream is told before their turn');

    // --- a second holder of the role, to prove the fan-out ----------------
    const extraAgm = await prisma.user.create({
      data: {
        email: 'agm2@dac.test',
        name: 'Second AGM',
        roleId: agm.roleId,
        organizationId: organization.id,
        passwordHash: 'not-a-real-hash',
        isActive: true,
      },
    });
    extraAgmId = extraAgm.id;

    // --- signing advances, and the next step's role is told ---------------
    console.log('\nWhen a step is signed');
    const signed = await signStep(creator, {
      formId,
      orderIndex: 1,
      signatureDataUrl: SIGNATURE,
      signerName: 'RAVI KUMAR',
    });
    if (!signed.ok) fail('fixture', signed.error);

    // Sole applicant, so step 2 is skipped and the AGM is next.
    const agmInbox = await inboxFor(agm.id, formId);
    if (agmInbox.length !== 1) {
      fail('notify', `the AGM has ${agmInbox.length} notifications, expected 1`);
    }
    if (!agmInbox[0]?.title.includes('waiting on you')) {
      fail('notify', `wrong notification: "${agmInbox[0]?.title}"`);
    }
    ok('the next step’s role is told as soon as it opens');

    const extraInbox = await inboxFor(extraAgm.id, formId);
    if (extraInbox.length !== 1) {
      fail(
        'notify',
        `the second AGM has ${extraInbox.length} notifications — an unclaimed step must reach every holder of the role`,
      );
    }
    ok('every active holder of the role is told, not just one');

    const misInbox = await inboxFor(mis.id, formId);
    if (misInbox.length !== 0) fail('notify', 'MIS was told about a step sitting on the AGM');
    ok('other roles are still not told');

    // --- the queue and the bell agree -------------------------------------
    const unread = await unreadCount(agm.id);
    if (unread < 1) fail('notify', 'the unread count does not see the new notification');
    ok('the unread count picks it up', `${unread} unread for the AGM`);

    // --- claiming removes the others from contention ----------------------
    await signStep(agm, { formId, orderIndex: 3, signatureDataUrl: SIGNATURE });
    await signStep(await userWithRole('DGM_GM'), {
      formId,
      orderIndex: 4,
      signatureDataUrl: SIGNATURE,
    });
    await signStep(await userWithRole('VP_SALES'), {
      formId,
      orderIndex: 5,
      signatureDataUrl: SIGNATURE,
    });

    const coordinatorInbox = await inboxFor(coordinator.id, formId);
    if (coordinatorInbox.length !== 1) {
      fail('notify', `the Co-ordinator has ${coordinatorInbox.length} notifications, expected 1`);
    }
    if (!coordinatorInbox[0]?.body.includes('validate')) {
      fail('notify', 'the Co-ordinator was not asked to validate, only to sign');
    }
    ok('the Co-ordinator is asked to validate, not merely to sign');

    // --- returning tells the creator, with the reason ---------------------
    console.log('\nWhen a booking is sent back');
    const before = (await inboxFor(creator.id, formId)).length;
    const returned = await returnStep(coordinator, {
      formId,
      orderIndex: 6,
      comment: 'The bank name does not match the cheque.',
    });
    if (!returned.ok) fail('fixture', returned.error);

    const afterReturn = await inboxFor(creator.id, formId);
    if (afterReturn.length !== before + 1) {
      fail('notify', 'the creator was not told their booking came back');
    }
    const returnNote = afterReturn[0];
    if (!returnNote?.body.includes('The bank name does not match the cheque.')) {
      fail('notify', 'the return reason did not reach the creator');
    }
    if (!returnNote.link?.endsWith('/edit')) {
      fail('notify', `the return links to ${returnNote.link}, not to the editor`);
    }
    ok('the creator gets the reason, and a link straight to the editor');

    const coordinatorAfter = await inboxFor(coordinator.id, formId);
    if (coordinatorAfter.length !== 1) {
      fail('notify', 'the person who returned it was notified about their own action');
    }
    ok('the person who sent it back is not told about their own action');

    // --- completion -------------------------------------------------------
    console.log('\nWhen a booking completes');
    const resubmitted = await performSubmit(creator, formId, { tncAccepted: true });
    if (!resubmitted.ok) fail('fixture', resubmitted.error);

    await signStep(coordinator, {
      formId,
      orderIndex: 6,
      signatureDataUrl: SIGNATURE,
      validated: true,
    });
    for (const [order, role] of [
      [7, 'MIS'],
      [8, 'DIRECTOR'],
      [9, 'CRM'],
    ] as const) {
      const signer = await userWithRole(role);
      const result = await signStep(signer, { formId, orderIndex: order, signatureDataUrl: SIGNATURE });
      if (!result.ok) fail('fixture', `step ${order}: ${result.error}`);
    }

    const completion = (await inboxFor(creator.id, formId)).find((n) =>
      n.title.includes('complete'),
    );
    if (!completion) fail('notify', 'the creator was not told their booking completed');
    if (!completion.body.includes('PDF')) {
      fail('notify', 'the completion note does not mention the PDF that is now available');
    }
    ok('the creator is told it is done, and that the PDF is ready');

    // --- a notification never blocks a signature --------------------------
    const signatureCount = await prisma.formStepRecord.count({
      where: {
        flowInstance: { bookingFormId: formId },
        status: { in: ['SIGNED', 'VALIDATED'] },
      },
    });
    if (signatureCount !== 8) {
      fail('flow', `${signatureCount} steps signed, expected 8 (step 2 skipped)`);
    }
    ok('every signature landed alongside its notifications');

    // --- no regulated identifier in anything that may reach email ---------
    console.log('\nWhat notifications may carry');
    const all = await prisma.notification.findMany({
      where: { link: { contains: formId } },
      select: { title: true, body: true },
    });
    for (const note of all) {
      const text = `${note.title} ${note.body}`;
      if (/\b\d{12}\b/.test(text)) fail('privacy', 'a notification carries an Adhaar number.');
      if (/\b[A-Z]{5}\d{4}[A-Z]\b/.test(text)) fail('privacy', 'a notification carries a PAN.');
    }
    ok(`${all.length} notifications checked — no PAN or Adhaar in any of them`);

    // --- the project sync, unconfigured -----------------------------------
    console.log('\nProject sync');
    const status = await syncStatus(organization.id);
    const outcome = await runProjectSync({ organizationId: organization.id, dryRun: true });

    if (status.configured) {
      if (!outcome.ok) fail('sync', `a configured sheet failed to read: ${outcome.error}`);
      ok('the sheet reads', `${outcome.created} new, ${outcome.updated} changed`);
    } else {
      if (outcome.ok) fail('sync', 'an unconfigured sync reported success.');
      if (!outcome.error.includes('not configured')) {
        fail('sync', `unhelpful message when unconfigured: ${outcome.error}`);
      }
      ok('reports itself as not configured, rather than failing obscurely');
      ok(
        'the project list still works by hand',
        `${status.activeProjects} active, ${status.handAddedProjects} added by hand`,
      );
    }
  } finally {
    console.log('\nCleanup');
    for (const id of created) {
      const assets = await prisma.signatureAsset.findMany({
        where: { stepRecord: { flowInstance: { bookingFormId: id } } },
        select: { id: true, storageKey: true },
      });
      for (const asset of assets) await driver.remove(asset.storageKey).catch(() => undefined);

      await prisma.notification.deleteMany({ where: { link: { contains: id } } });
      await prisma.bookingForm.delete({ where: { id } }).catch(() => undefined);
      await prisma.signatureAsset
        .deleteMany({ where: { id: { in: assets.map((a) => a.id) } } })
        .catch(() => undefined);
    }
    if (extraAgmId) {
      await prisma.user.delete({ where: { id: extraAgmId } }).catch(() => undefined);
    }
    ok(`${created.length} throwaway bookings, their notifications and the extra user deleted`);

    const org = await prisma.organization.findFirst();
    if (org && sequenceBefore) {
      await prisma.bookingSequence
        .update({
          where: { organizationId_year: { organizationId: org.id, year: sequenceBefore.year } },
          data: { lastValue: sequenceBefore.lastValue },
        })
        .catch(() => undefined);
      ok(`Booking ID sequence restored to ${sequenceBefore.lastValue}`);
    }
    await prisma.$disconnect();
  }

  console.log('\nAll notification and sync checks passed.\n');
}

main().catch(async (error) => {
  console.error('\nVerification failed:\n', error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
