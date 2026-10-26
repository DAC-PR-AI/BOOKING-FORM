import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { encryptField, last4, toDbBytes } from '../src/lib/crypto/field-encryption';
import { verhoeffCheckDigit } from '../src/lib/validation/aadhaar';
import { performSubmit } from '../src/lib/forms/submit';
import { signStep } from '../src/lib/flow/sign';
import { samplePng } from '../src/lib/pdf/sample-image';

/**
 * Creates a realistic booking form in the development database, so the review
 * and submit screens can be clicked through without typing sixty fields by
 * hand every time.
 *
 * Run:  npx tsx --conditions=react-server scripts/dev-fixture.ts [--empty] [--joint]
 *
 *   (default)  a complete draft that passes the submit gate
 *   --empty    a bare draft, for seeing the gate's outstanding-items list
 *   --joint    adds a second applicant and their documents
 *   --submit   submits it as well, so the status page shows a live timeline
 *   --complete submits AND signs all nine steps, so the PDF can be downloaded
 *
 * Prints the form id and its URLs. Refuses to run in production: it writes
 * plausible-looking customer data, which has no business in a real database.
 */

function validAadhaar(prefix: string): string {
  return `${prefix}${verhoeffCheckDigit(prefix)}`;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to create fixture data in production.');
  }

  const empty = process.argv.includes('--empty');
  const joint = process.argv.includes('--joint');
  const complete = process.argv.includes('--complete');
  const submit = process.argv.includes('--submit') || complete;

  if (submit && empty) {
    throw new Error('--submit and --empty contradict each other: an empty draft cannot pass the gate.');
  }

  const organization = await prisma.organization.findFirstOrThrow();
  const creator = await prisma.user.findFirstOrThrow({
    where: { organizationId: organization.id, role: { name: 'SALES_EXECUTIVE' } },
  });
  const template = await prisma.formTemplate.findFirstOrThrow({
    where: { organizationId: organization.id, key: 'booking_form' },
  });

  const form = await prisma.bookingForm.create({
    data: {
      organizationId: organization.id,
      formTemplateId: template.id,
      createdById: creator.id,
      bookingDate: new Date(),
      status: 'DRAFT',
      salesExecutive: creator.name,
      applicants: { create: [{ applicantType: 'PRIMARY' }] },
      addresses: { create: [{ type: 'COMMUNICATION' }, { type: 'PERMANENT' }] },
    },
  });

  if (!empty) {
    const project = await prisma.project.findFirstOrThrow({
      where: { organizationId: organization.id, isActive: true },
    });
    const source = await prisma.sourceOption.findFirstOrThrow({ where: { isActive: true } });

    await prisma.bookingForm.update({
      where: { id: form.id },
      data: {
        projectId: project.id,
        propertyType: 'VILLA',
        salesHead: 'ARUN MURUGAN',
        telecaller: 'LAKSHMI R',
        leadId: 'LEAD-4471',
        source: source.value,
        builtUpAreaSqft: '1450',
        udsSqft: '600',
        floor: '2',
        bookingAdvancePaise: 50_000_000n, // ₹5,00,000
        paymentMode: 'ONLINE',
        paymentRefNo: 'TXN-99881',
        paymentDate: new Date(),
        bank: 'HDFC BANK',
        paymentSource: 'HOME_LOAN',
        salePricePaise: 750_000_000n, // ₹75,00,000
        remarks: 'Created by scripts/dev-fixture.ts.',
      },
    });

    const applicant = (name: string, guardian: string, aadhaarPrefix: string) => {
      const pan = 'ABCPK1234A';
      const aadhaar = validAadhaar(aadhaarPrefix);
      return {
        salutation: 'MR' as const,
        fullName: name,
        relationType: 'SON_OF' as const,
        guardianSalutation: 'MR' as const,
        guardianName: guardian,
        mobileNo: '9876543210',
        altMobileNo: '9123456780',
        email: `${name.split(' ')[0]?.toLowerCase()}@example.com`,
        panEncrypted: toDbBytes(encryptField(pan)),
        panLast4: last4(pan),
        aadhaarEncrypted: toDbBytes(encryptField(aadhaar)),
        aadhaarLast4: last4(aadhaar),
        dob: new Date('1990-05-14T00:00:00Z'),
        occupation: 'SOFTWARE ENGINEER',
        companyName: 'ACME SYSTEMS',
        designation: 'SENIOR MANAGER',
        location: 'CHENNAI',
      };
    };

    await prisma.applicant.update({
      where: {
        bookingFormId_applicantType: { bookingFormId: form.id, applicantType: 'PRIMARY' },
      },
      data: applicant('RAVI KUMAR', 'SURESH KUMAR', '23456789012'),
    });

    if (joint) {
      await prisma.applicant.create({
        data: {
          bookingFormId: form.id,
          applicantType: 'SECONDARY',
          ...applicant('MEENA KUMARI', 'RAMESH IYER', '34567890123'),
        },
      });
    }

    for (const type of ['COMMUNICATION', 'PERMANENT'] as const) {
      await prisma.address.update({
        where: { bookingFormId_type: { bookingFormId: form.id, type } },
        data: {
          line1: '12 GANDHI STREET',
          line2: 'ADYAR',
          line3: 'CHENNAI',
          line4: 'TAMIL NADU 600020',
        },
      });
    }

    // Document ROWS only — no bytes are written, so the files will not open.
    // That is enough for the submit gate, which reads rows; the storage round
    // trip is covered by scripts/verify-storage.ts.
    const types = await prisma.documentType.findMany({
      where: {
        organizationId: organization.id,
        isActive: true,
        requirement: joint
          ? { OR: [{ isMandatory: true }, { requiredIfSecondApplicant: true }] }
          : { isMandatory: true },
      },
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
          storageKey: `bookings/${form.id}/${type.key}/fixture.pdf`,
          originalName: 'fixture.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          uploadedById: creator.id,
        },
      });
    }
  }

  let submittedAs: string | null = null;
  let completed = false;
  if (submit) {
    const actingUser = await prisma.user.findUniqueOrThrow({
      where: { id: creator.id },
      include: { role: true },
    });
    const result = await performSubmit(actingUser, form.id, { tncAccepted: true });
    if (!result.ok) {
      const detail = (result.issues ?? [])
        .map((issue) => `  - ${issue.field}: ${issue.message}`)
        .join('\n');
      throw new Error(
        `The fixture could not be submitted: ${result.error}${detail ? `\n${detail}` : ''}`,
      );
    }
    submittedAs = result.bookingId;

    if (complete) {
      // Sign the whole pipeline as the seeded role holders, so the booking
      // reaches COMPLETED and its PDF can be generated.
      const signature = `data:image/png;base64,${samplePng(480, 140).toString('base64')}`;
      const roleForStep: Record<number, string> = {
        3: 'AGM',
        4: 'DGM_GM',
        5: 'VP_SALES',
        6: 'SALES_COORDINATOR',
        7: 'MIS',
        8: 'DIRECTOR',
        9: 'CRM',
      };

      const applicantNames = [null, 'RAVI KUMAR', 'MEENA KUMARI'];
      for (let order = 1; order <= 9; order += 1) {
        const roleName = roleForStep[order];
        const signer = roleName
          ? await prisma.user.findFirstOrThrow({
              where: { organizationId: organization.id, role: { name: roleName as never } },
              include: { role: true },
            })
          : actingUser;

        const signed = await signStep(signer, {
          formId: form.id,
          orderIndex: order,
          signatureDataUrl: signature,
          ...(order <= 2 ? { signerName: applicantNames[order] ?? 'APPLICANT' } : {}),
          ...(order === 6 ? { validated: true } : {}),
        });

        // Step 2 is skipped for a sole applicant; that refusal is expected.
        if (!signed.ok && !(order === 2 && !joint)) {
          throw new Error(`Could not sign step ${order}: ${signed.error}`);
        }
      }
      completed = true;
    }
  }

  const base = process.env.APP_URL ?? 'http://localhost:3000';
  console.log(`\n${empty ? 'Empty' : joint ? 'Complete joint' : 'Complete'} draft created.\n`);
  console.log(`  id         ${form.id}`);
  if (submittedAs) {
    console.log(
      `  booking id ${submittedAs} (${completed ? 'COMPLETED — all nine signed' : 'submitted, waiting on step 1'})`,
    );
  }
  console.log(`  created by ${creator.email}`);
  console.log(`  edit       ${base}/forms/${form.id}/edit`);
  console.log(`  documents  ${base}/forms/${form.id}/documents`);
  console.log(`  review     ${base}/forms/${form.id}/review`);
  console.log(`  status     ${base}/forms/${form.id}\n`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
