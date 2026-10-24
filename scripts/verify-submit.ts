import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { allocateBookingId } from '../src/lib/forms/allocate';
import { parseBookingId } from '../src/lib/forms/booking-id';
import { assessForm, loadFormForGate } from '../src/lib/forms/readiness';
import { activeTermsVersion } from '../src/lib/forms/terms';
import { resumeFlow, startFlow } from '../src/lib/flow/engine';
import { performSubmit } from '../src/lib/forms/submit';
import { encryptField, last4, toDbBytes } from '../src/lib/crypto/field-encryption';
import { verhoeffCheckDigit } from '../src/lib/validation/aadhaar';

/**
 * End-to-end check of the Phase 4 submit path against the real database.
 *
 * The pure parts — the gate, the flow planner, the Booking ID format — are
 * covered by unit tests. This covers what only breaks for real: that the gate
 * agrees with what is actually stored, that Booking ID allocation survives
 * concurrency, and that starting and resuming a flow writes the step records
 * the planner intended.
 *
 * Run:  npx tsx --conditions=react-server scripts/verify-submit.ts
 *
 * Creates throwaway bookings and deletes them again. Safe to run repeatedly.
 */

function ok(label: string, detail = ''): void {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

/** Throws rather than exiting, so the cleanup in `finally` always runs. */
function fail(label: string, detail: string): never {
  throw new Error(`${label} — ${detail}`);
}

/**
 * Asserts a seed lookup found something, and hands back a non-null value.
 *
 * Needed because narrowing from a `never`-returning call does not reach into
 * the nested helpers below, which all close over these fixtures.
 */
function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    fail('seed data', `${what}. Run \`npm run db:seed\`.`);
  }
  return value;
}

/** A 12-digit Aadhaar with a correct Verhoeff check digit. */
function validAadhaar(prefix: string): string {
  return `${prefix}${verhoeffCheckDigit(prefix)}`;
}

const created: string[] = [];

/**
 * The Booking ID sequence this script advances, so it can be put back.
 *
 * Allocation is gap-free by design, which means the concurrency check really
 * does consume a dozen numbers. Leaving them spent would make the first real
 * booking in a fresh development database DAC/2026/00012, which looks like
 * eleven bookings went missing. Restoring is safe here only because this is a
 * development database with nobody else submitting; it is never done in
 * production, and the script refuses to run there.
 */
let sequenceBefore: { year: number; lastValue: number } | null = null;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the verification script against production.');
  }

  const organization = required(await prisma.organization.findFirst(), 'no organisation');

  const creator = required(
    await prisma.user.findFirst({
      where: { organizationId: organization.id, role: { name: 'SALES_EXECUTIVE' } },
    }),
    'no sales executive',
  );

  const template = required(
    await prisma.formTemplate.findFirst({
      where: { organizationId: organization.id, key: 'booking_form' },
    }),
    'no booking form template',
  );

  const project = required(
    await prisma.project.findFirst({
      where: { organizationId: organization.id, isActive: true },
    }),
    'no active project',
  );

  const source = required(
    await prisma.sourceOption.findFirst({ where: { isActive: true } }),
    'no source options',
  );

  const mandatoryTypes = await prisma.documentType.findMany({
    where: { organizationId: organization.id, isActive: true, requirement: { isMandatory: true } },
  });

  const secondApplicantTypes = await prisma.documentType.findMany({
    where: {
      organizationId: organization.id,
      isActive: true,
      requirement: { requiredIfSecondApplicant: true },
    },
  });

  async function makeDraft(label: string): Promise<string> {
    const form = await prisma.bookingForm.create({
      data: {
        organizationId: organization.id,
        formTemplateId: template.id,
        createdById: creator.id,
        bookingDate: new Date(),
        status: 'DRAFT',
        remarks: `VERIFY-SUBMIT ${label}`,
        applicants: { create: [{ applicantType: 'PRIMARY' }] },
        addresses: { create: [{ type: 'COMMUNICATION' }, { type: 'PERMANENT' }] },
      },
    });
    created.push(form.id);
    return form.id;
  }

  function applicantData(name: string, aadhaarPrefix: string) {
    const pan = 'ABCPK1234A';
    const aadhaar = validAadhaar(aadhaarPrefix);
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

  /** Fills every gate-relevant field and attaches the mandatory documents. */
  async function complete(formId: string, withSecondApplicant: boolean): Promise<void> {
    await prisma.bookingForm.update({
      where: { id: formId },
      data: {
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
      },
    });

    await prisma.applicant.update({
      where: { bookingFormId_applicantType: { bookingFormId: formId, applicantType: 'PRIMARY' } },
      data: applicantData('RAVI KUMAR', '23456789012'),
    });

    if (withSecondApplicant) {
      await prisma.applicant.create({
        data: {
          bookingFormId: formId,
          applicantType: 'SECONDARY',
          ...applicantData('MEENA KUMARI', '34567890123'),
        },
      });
    }

    for (const type of ['COMMUNICATION', 'PERMANENT'] as const) {
      await prisma.address.update({
        where: { bookingFormId_type: { bookingFormId: formId, type } },
        data: { line1: '12 GANDHI STREET', line2: 'ADYAR', line3: 'CHENNAI 600020' },
      });
    }

    // The gate reads rows, not bytes, so no objects are written here — the
    // storage round trip is covered by scripts/verify-storage.ts.
    const types = withSecondApplicant
      ? [...mandatoryTypes, ...secondApplicantTypes]
      : mandatoryTypes;

    const applicants = await prisma.applicant.findMany({ where: { bookingFormId: formId } });

    for (const type of types) {
      const applicantId =
        type.scope === 'APPLICANT'
          ? applicants.find((a) => a.applicantType === type.appliesTo)?.id ?? null
          : null;

      await prisma.formDocument.create({
        data: {
          bookingFormId: formId,
          documentTypeId: type.id,
          applicantId,
          storageKey: `bookings/${formId}/${type.key}/verify.pdf`,
          originalName: 'verify.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          uploadedById: creator.id,
        },
      });
    }
  }

  async function setRecord(
    formId: string,
    orderIndex: number,
    status: 'SIGNED' | 'RETURNED',
  ): Promise<void> {
    const record = await prisma.formStepRecord.findFirstOrThrow({
      where: { flowInstance: { bookingFormId: formId }, orderIndex },
    });
    await prisma.formStepRecord.update({
      where: { id: record.id },
      data: {
        status,
        actedAt: new Date(),
        comment: status === 'RETURNED' ? 'Fix the bank.' : null,
      },
    });
  }

  async function gateOf(formId: string) {
    const form = await loadFormForGate(formId, organization.id);
    if (!form) fail('gate', `form ${formId} disappeared.`);
    return assessForm(form, organization.id);
  }

  try {
    // --- the gate ---------------------------------------------------------
    console.log('\nSubmit gate');
    const emptyId = await makeDraft('empty');
    const empty = await gateOf(emptyId);
    if (empty.readiness.ready) fail('gate', 'an empty draft was reported ready to submit.');
    ok(
      'blocks an empty draft',
      `${empty.readiness.fieldIssueCount} field + ${empty.readiness.documentIssueCount} document issues`,
    );

    const sections = new Set(empty.readiness.issues.map((i) => i.section));
    for (const expected of ['header', 'firstApplicant', 'payment', 'documents']) {
      if (!sections.has(expected as never)) {
        fail('gate', `no issue reported for the "${expected}" section.`);
      }
    }
    ok('reports every block of the paper form', [...sections].join(', '));

    await complete(emptyId, false);
    const filled = await gateOf(emptyId);
    if (!filled.readiness.ready) {
      fail(
        'gate',
        `a completed draft was still blocked: ${filled.readiness.issues
          .map((i) => `${i.field}: ${i.message}`)
          .join('; ')}`,
      );
    }
    ok('passes a completed draft');

    // PAN/Aadhaar are never decrypted; the stored last-4 is what the gate reads.
    await prisma.applicant.update({
      where: { bookingFormId_applicantType: { bookingFormId: emptyId, applicantType: 'PRIMARY' } },
      data: { panLast4: null },
    });
    const noPan = await gateOf(emptyId);
    if (noPan.readiness.ready) fail('gate', 'a form with no stored PAN passed.');
    if (!noPan.readiness.issues.some((i) => i.field === 'PAN card number')) {
      fail('gate', 'the missing PAN was not named.');
    }
    ok('blocks a missing PAN without decrypting anything');

    await prisma.applicant.update({
      where: { bookingFormId_applicantType: { bookingFormId: emptyId, applicantType: 'PRIMARY' } },
      data: { panLast4: '234A' },
    });

    // An inactive project must not print on a booking.
    await prisma.project.update({ where: { id: project.id }, data: { isActive: false } });
    const inactive = await gateOf(emptyId);
    await prisma.project.update({ where: { id: project.id }, data: { isActive: true } });
    if (inactive.readiness.ready) fail('gate', 'an inactive project passed the gate.');
    ok('blocks a project that is no longer active');

    // --- Booking ID -------------------------------------------------------
    console.log('\nBooking ID allocation');
    sequenceBefore =
      (await prisma.bookingSequence.findFirst({
        where: { organizationId: organization.id },
        orderBy: { year: 'desc' },
        select: { year: true, lastValue: true },
      })) ?? null;

    const first = await prisma.$transaction((tx) => allocateBookingId(tx, organization.id));
    const second = await prisma.$transaction((tx) => allocateBookingId(tx, organization.id));
    const a = parseBookingId(first);
    const b = parseBookingId(second);
    if (!a || !b) fail('booking id', `unparseable: ${first}, ${second}`);
    if (b.sequence !== a.sequence + 1) {
      fail('booking id', `not sequential: ${first} then ${second}`);
    }
    ok('is sequential', `${first} then ${second}`);

    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () =>
        prisma.$transaction((tx) => allocateBookingId(tx, organization.id)),
      ),
    );
    const unique = new Set(concurrent);
    if (unique.size !== concurrent.length) {
      fail('booking id', `8 concurrent allocations produced ${unique.size} distinct ids.`);
    }
    const sequences = concurrent.map((id) => parseBookingId(id)?.sequence ?? -1).sort((x, y) => x - y);
    const gapFree = sequences.every((value, index) =>
      index === 0 ? true : value === (sequences[index - 1] as number) + 1,
    );
    if (!gapFree) fail('booking id', `concurrent allocations left a gap: ${sequences.join(',')}`);
    ok('survives 8 concurrent allocations, gap-free', sequences.join(', '));

    const rolledBack = await prisma
      .$transaction(async (tx) => {
        await allocateBookingId(tx, organization.id);
        throw new Error('deliberate rollback');
      })
      .catch(() => null);
    if (rolledBack !== null) fail('booking id', 'the rollback transaction did not throw.');

    const afterRollback = await prisma.$transaction((tx) =>
      allocateBookingId(tx, organization.id),
    );
    // The highest number issued, not the last promise to resolve: Promise.all
    // preserves call order, which says nothing about allocation order.
    const expected = Math.max(...sequences);
    if ((parseBookingId(afterRollback)?.sequence ?? 0) !== expected + 1) {
      fail('booking id', `a failed submit consumed a number: next was ${afterRollback}`);
    }
    ok('a rolled-back submit consumes no number', afterRollback);

    // --- starting a flow --------------------------------------------------
    console.log('\nStarting the flow');
    const soleId = await makeDraft('sole');
    await complete(soleId, false);

    const soleOrder = await prisma.$transaction((tx) =>
      startFlow(
        tx,
        { id: soleId, formTemplateId: template.id, createdById: creator.id },
        { hasSecondApplicant: false },
      ),
    );
    if (soleOrder !== 1) fail('startFlow', `expected to wait on step 1, got ${soleOrder}`);

    const soleRecords = await prisma.formStepRecord.findMany({
      where: { flowInstance: { bookingFormId: soleId } },
      orderBy: { orderIndex: 'asc' },
      select: { orderIndex: true, status: true, assigneeId: true },
    });
    if (soleRecords.length !== 9) fail('startFlow', `expected 9 records, got ${soleRecords.length}`);
    ok('creates all nine step records');

    const byOrder = new Map(soleRecords.map((r) => [r.orderIndex, r]));
    if (byOrder.get(1)?.status !== 'PENDING') fail('startFlow', 'step 1 is not PENDING.');
    if (byOrder.get(1)?.assigneeId !== creator.id) {
      fail('startFlow', 'step 1 was not assigned to the creator for in-person capture.');
    }
    ok('opens step 1, assigned to the creator');

    if (byOrder.get(2)?.status !== 'SKIPPED') {
      fail('startFlow', 'step 2 was not skipped for a sole applicant.');
    }
    ok('skips the second-applicant step for a sole applicant');

    for (const order of [3, 4, 5, 6, 7, 8, 9]) {
      if (byOrder.get(order)?.status !== 'LOCKED') {
        fail('startFlow', `step ${order} is ${byOrder.get(order)?.status}, expected LOCKED`);
      }
      if (byOrder.get(order)?.assigneeId !== null) {
        fail('startFlow', `step ${order} was pinned to one person.`);
      }
    }
    ok('locks steps 3-9 and leaves them claimable by any holder of the role');

    const jointId = await makeDraft('joint');
    await complete(jointId, true);
    await prisma.$transaction((tx) =>
      startFlow(
        tx,
        { id: jointId, formTemplateId: template.id, createdById: creator.id },
        { hasSecondApplicant: true },
      ),
    );
    const jointStep2 = await prisma.formStepRecord.findFirst({
      where: { flowInstance: { bookingFormId: jointId }, orderIndex: 2 },
      select: { status: true, assigneeId: true },
    });
    if (jointStep2?.status !== 'LOCKED') {
      fail('startFlow', `step 2 for a joint booking is ${jointStep2?.status}, expected LOCKED`);
    }
    ok('keeps the second-applicant step for a joint booking');

    // --- resuming after a return ------------------------------------------
    console.log('\nResuming a returned form');
    for (const order of [1, 3, 4, 5]) await setRecord(soleId, order, 'SIGNED');
    await setRecord(soleId, 6, 'RETURNED');
    await prisma.bookingForm.update({
      where: { id: soleId },
      data: { status: 'RETURNED', returnToStepOrder: 6 },
    });

    const resumed = await prisma.$transaction((tx) =>
      resumeFlow(
        tx,
        {
          id: soleId,
          formTemplateId: template.id,
          createdById: creator.id,
          returnToStepOrder: 6,
        },
        { hasSecondApplicant: false },
      ),
    );
    if (resumed.resumeAtOrder !== 6) {
      fail('resumeFlow', `resumed at ${resumed.resumeAtOrder}, expected 6`);
    }
    ok('resumes at the step that returned it, not at step 1');

    const afterResume = new Map(
      (
        await prisma.formStepRecord.findMany({
          where: { flowInstance: { bookingFormId: soleId } },
          select: { orderIndex: true, status: true, comment: true },
        })
      ).map((r) => [r.orderIndex, r]),
    );
    for (const order of [1, 3, 4, 5]) {
      if (afterResume.get(order)?.status !== 'SIGNED') {
        fail('resumeFlow', `step ${order} lost its signature (${afterResume.get(order)?.status})`);
      }
    }
    ok('leaves the four signatures already collected untouched');

    if (afterResume.get(6)?.status !== 'PENDING') {
      fail('resumeFlow', `step 6 is ${afterResume.get(6)?.status}, expected PENDING`);
    }
    if (afterResume.get(6)?.comment !== null) {
      fail('resumeFlow', 'the previous return comment was left hanging off a live step.');
    }
    ok('reopens step 6 and clears its stale return comment');

    // A second applicant added while the form was back with the creator.
    await prisma.applicant.create({
      data: {
        bookingFormId: soleId,
        applicantType: 'SECONDARY',
        ...applicantData('LATE ADDITION', '45678901234'),
      },
    });
    await prisma.bookingForm.update({
      where: { id: soleId },
      data: { status: 'RETURNED', returnToStepOrder: 6 },
    });

    const rewound = await prisma.$transaction((tx) =>
      resumeFlow(
        tx,
        {
          id: soleId,
          formTemplateId: template.id,
          createdById: creator.id,
          returnToStepOrder: 6,
        },
        { hasSecondApplicant: true },
      ),
    );
    if (rewound.resumeAtOrder !== 2 || !rewound.rewoundForNewApplicant) {
      fail(
        'resumeFlow',
        `a newly added second applicant did not rewind the flow (resumed at ${rewound.resumeAtOrder})`,
      );
    }
    ok('rewinds to step 2 when a second applicant is added after a return');

    const afterRewind = new Map(
      (
        await prisma.formStepRecord.findMany({
          where: { flowInstance: { bookingFormId: soleId } },
          select: { orderIndex: true, status: true },
        })
      ).map((r) => [r.orderIndex, r.status]),
    );
    if (afterRewind.get(1) !== 'SIGNED') {
      fail('resumeFlow', 'the first applicant had to sign again for no reason.');
    }
    if (afterRewind.get(2) !== 'PENDING') {
      fail('resumeFlow', `step 2 is ${afterRewind.get(2)}, expected PENDING`);
    }
    for (const order of [3, 4, 5]) {
      if (afterRewind.get(order) !== 'LOCKED') {
        fail(
          'resumeFlow',
          `step ${order} is ${afterRewind.get(order)}; approvals after a new applicant must be re-collected`,
        );
      }
    }
    ok('keeps step 1 signed and re-opens the approvals that came after it');

    // --- the whole submit, through performSubmit --------------------------
    console.log('\nSubmitting');
    const actingUser = required(
      await prisma.user.findUnique({ where: { id: creator.id }, include: { role: true } }),
      'the creator could not be reloaded with their role',
    );

    const incompleteId = await makeDraft('incomplete');
    const blocked = await performSubmit(actingUser, incompleteId, { tncAccepted: true });
    if (blocked.ok) fail('performSubmit', 'an incomplete draft was submitted.');
    if (!blocked.issues || blocked.issues.length === 0) {
      fail('performSubmit', 'a blocked submit returned no issues to show the user.');
    }
    ok('refuses an incomplete draft', `${blocked.issues.length} issues returned`);

    const readyId = await makeDraft('ready');
    await complete(readyId, false);

    const unaccepted = await performSubmit(actingUser, readyId, { tncAccepted: false });
    if (unaccepted.ok) fail('performSubmit', 'submitted without the T&C being accepted.');
    ok('refuses to submit without the T&C accepted');

    const submitted = await performSubmit(actingUser, readyId, { tncAccepted: true });
    if (!submitted.ok) fail('performSubmit', `a complete draft was refused: ${submitted.error}`);
    ok(
      'submits a complete draft',
      `${submitted.bookingId}, waiting on step ${submitted.currentStepOrder}`,
    );

    const stored = await prisma.bookingForm.findUniqueOrThrow({
      where: { id: readyId },
      select: {
        bookingId: true,
        status: true,
        currentStepOrder: true,
        submittedAt: true,
        tncVersionId: true,
        tncAcceptedAt: true,
      },
    });
    if (stored.status !== 'SUBMITTED') fail('performSubmit', `status is ${stored.status}`);
    if (!stored.bookingId) fail('performSubmit', 'no Booking ID was allocated.');
    if (stored.currentStepOrder !== 1) {
      fail('performSubmit', `currentStepOrder is ${stored.currentStepOrder}, expected 1`);
    }
    if (!stored.submittedAt) fail('performSubmit', 'submittedAt was not set.');
    if (!stored.tncVersionId || !stored.tncAcceptedAt) {
      fail('performSubmit', 'the T&C version and acceptance time were not recorded.');
    }
    ok('records status, Booking ID, submit time and the accepted T&C version');

    const builtSteps = await prisma.formStepRecord.count({
      where: { flowInstance: { bookingFormId: readyId } },
    });
    if (builtSteps !== 9) fail('performSubmit', `built ${builtSteps} step records, expected 9`);
    ok('builds the nine-step pipeline in the same transaction');

    const submitAudit = await prisma.auditLog.findFirst({
      where: { bookingFormId: readyId, action: 'SUBMIT' },
      select: { detail: true },
    });
    if (!submitAudit) fail('performSubmit', 'no SUBMIT audit entry was written.');
    ok('writes a SUBMIT audit entry', submitAudit.detail?.slice(0, 56) ?? '');

    const twice = await performSubmit(actingUser, readyId, { tncAccepted: true });
    if (twice.ok) fail('performSubmit', 'the same booking was submitted twice.');
    ok('refuses a second submit of the same booking', twice.error);

    const otherUser = await prisma.user.findFirst({
      where: { organizationId: organization.id, role: { name: 'AGM' } },
      include: { role: true },
    });
    if (otherUser) {
      const stranger = await performSubmit(otherUser, readyId, { tncAccepted: true });
      if (stranger.ok) fail('performSubmit', 'someone other than the creator submitted it.');
      if (stranger.error !== 'Form not found.') {
        fail('performSubmit', `leaked existence with: "${stranger.error}"`);
      }
      ok('tells a non-creator only that the form does not exist');
    }

    // Resubmission keeps the Booking ID and resumes at the returning step.
    await setRecord(readyId, 1, 'SIGNED');
    await setRecord(readyId, 3, 'RETURNED');
    await prisma.bookingForm.update({
      where: { id: readyId },
      data: { status: 'RETURNED', returnToStepOrder: 3 },
    });

    const again = await performSubmit(actingUser, readyId, { tncAccepted: true });
    if (!again.ok) fail('performSubmit', `resubmission was refused: ${again.error}`);
    if (again.bookingId !== stored.bookingId) {
      fail('performSubmit', `the Booking ID changed on resubmit: ${again.bookingId}`);
    }
    if (again.currentStepOrder !== 3) {
      fail('performSubmit', `resumed at step ${again.currentStepOrder}, expected 3`);
    }
    ok('resubmits with the same Booking ID, resuming at step 3');

    const afterResubmit = await prisma.bookingForm.findUniqueOrThrow({
      where: { id: readyId },
      select: { returnToStepOrder: true, status: true },
    });
    if (afterResubmit.returnToStepOrder !== null) {
      fail('performSubmit', 'the return marker was left set after resubmission.');
    }
    if (afterResubmit.status !== 'SUBMITTED') {
      fail('performSubmit', `status after resubmit is ${afterResubmit.status}`);
    }
    ok('clears the return marker and goes back to SUBMITTED');

    // --- terms ------------------------------------------------------------
    console.log('\nTerms & Conditions');
    const terms = await activeTermsVersion(organization.id);
    if (!terms) fail('terms', 'no T&C version is available at all.');
    if (terms.body.startsWith('>')) {
      fail('terms', 'the stored body still begins with the internal review warning.');
    }
    if (!terms.body.startsWith('# TERMS & CONDITIONS')) {
      fail('terms', `the stored body starts with: ${terms.body.slice(0, 40)}`);
    }
    ok('stored body is the customer-facing text only', `${terms.body.length} chars`);
    ok(
      `version ${terms.version}, approved: ${terms.isApproved}`,
      `sha256 ${terms.bodySha256.slice(0, 12)}…`,
    );
    if (terms.isApproved) {
      ok('an approved version is in place');
    } else {
      console.log(
        '  ! not approved — development falls back to it; production would refuse to submit.',
      );
    }
  } finally {
    console.log('\nCleanup');
    for (const id of created) {
      await prisma.bookingForm.delete({ where: { id } }).catch(() => undefined);
    }
    const leftover = await prisma.bookingForm.count({
      where: { remarks: { startsWith: 'VERIFY-SUBMIT' } },
    });
    if (leftover > 0) console.warn(`  ! ${leftover} throwaway booking(s) left behind`);
    else ok(`${created.length} throwaway bookings deleted`);

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
        // There was no row before this run, so the numbers it burned are its own.
        const deleted = await prisma.bookingSequence
          .deleteMany({ where: { organizationId: org.id } })
          .catch(() => ({ count: 0 }));
        if (deleted.count > 0) ok('Booking ID sequence reset');
      }
    }
    await prisma.$disconnect();
  }

  console.log('\nAll submit checks passed.\n');
}

main().catch(async (error) => {
  console.error('\nVerification failed:\n', error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
