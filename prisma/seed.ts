import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient, type RoleName } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from '@node-rs/argon2';

/**
 * Idempotent seed. Safe to re-run: everything upserts on a natural key.
 *
 * Creates the demo accounts, the document checklist, the 8-step signature
 * pipeline (MD/Director step removed) and T&C v1.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const ORG_SLUG = 'dac-developers';

/**
 * Demo password. Every seeded account is on a `.test` domain, which can never
 * receive real email, so these can never be used against a real inbox.
 * Override with SEED_PASSWORD. Real staff accounts are created by an admin.
 */
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'DacDev!2026';

const ROLES: Array<{ name: RoleName; label: string; description: string }> = [
  { name: 'ADMIN', label: 'Admin', description: 'Manages users, projects, document types, flow configuration; sees everything.' },
  { name: 'SALES_EXECUTIVE', label: 'Sales Executive', description: 'Creates and submits booking forms; captures applicant signatures in person.' },
  { name: 'AGM', label: 'AGM', description: 'Signatory, step 3.' },
  { name: 'DGM_GM', label: 'DGM / GM', description: 'Signatory, step 4.' },
  { name: 'VP_SALES', label: 'VP Sales', description: 'Signatory, step 5.' },
  { name: 'SALES_COORDINATOR', label: 'Sales Co-ordinator', description: 'Validates and signs, step 6. May return to the creator.' },
  { name: 'MIS', label: 'MIS', description: 'Signatory, step 7.' },
  { name: 'DIRECTOR', label: 'Director', description: 'Signatory, step 8.' },
  { name: 'CRM', label: 'CRM', description: 'Signatory, step 9. Signing here completes the booking.' },
];

const USERS: Array<{ email: string; name: string; role: RoleName }> = [
  { email: 'admin@dac.test', name: 'Asha Admin', role: 'ADMIN' },
  { email: 'exec@dac.test', name: 'Ravi Executive', role: 'SALES_EXECUTIVE' },
  { email: 'agm@dac.test', name: 'Anita AGM', role: 'AGM' },
  { email: 'gm@dac.test', name: 'Gopal GM', role: 'DGM_GM' },
  { email: 'vpsales@dac.test', name: 'Vijay VP', role: 'VP_SALES' },
  { email: 'coordinator@dac.test', name: 'Kavya Co-ordinator', role: 'SALES_COORDINATOR' },
  { email: 'mis@dac.test', name: 'Mani MIS', role: 'MIS' },
  { email: 'director@dac.test', name: 'Divya Director', role: 'DIRECTOR' },
  { email: 'crm@dac.test', name: 'Charu CRM', role: 'CRM' },
];

/** The confirmed 9-step pipeline (with Director at step 8 and CRM at step 9; Managing Director line on form is removed). */
const FLOW_STEPS: Array<{
  orderIndex: number;
  label: string;
  role: RoleName;
  action: 'SIGN' | 'VALIDATE_AND_SIGN';
  slot: string;
  onCreatorDevice?: boolean;
  skipIfNoSecond?: boolean;
}> = [
  { orderIndex: 1, label: '1st Applicant', role: 'SALES_EXECUTIVE', action: 'SIGN', slot: 'applicant_1', onCreatorDevice: true },
  { orderIndex: 2, label: '2nd Applicant', role: 'SALES_EXECUTIVE', action: 'SIGN', slot: 'applicant_2', onCreatorDevice: true, skipIfNoSecond: true },
  { orderIndex: 3, label: 'AGM', role: 'AGM', action: 'SIGN', slot: 'agm' },
  { orderIndex: 4, label: 'DGM / GM', role: 'DGM_GM', action: 'SIGN', slot: 'dgm_gm' },
  { orderIndex: 5, label: 'VP Sales', role: 'VP_SALES', action: 'SIGN', slot: 'vp_sales' },
  { orderIndex: 6, label: 'Sales Co-ordinator', role: 'SALES_COORDINATOR', action: 'VALIDATE_AND_SIGN', slot: 'sales_coordinator' },
  { orderIndex: 7, label: 'MIS', role: 'MIS', action: 'SIGN', slot: 'mis' },
  { orderIndex: 8, label: 'Director', role: 'DIRECTOR', action: 'SIGN', slot: 'director' },
  { orderIndex: 9, label: 'CRM', role: 'CRM', action: 'SIGN', slot: 'crm' },
];

const IMAGE = ['image/jpeg', 'image/png'];
const SCAN = ['application/pdf', 'image/jpeg', 'image/png'];

/**
 * Confirmed document checklist:
 * Only Photo, PAN card, and Aadhaar card are mandatory when creating/submitting
 * the booking form (plus the 2nd applicant's Photo, PAN, and Aadhaar if there
 * is a 2nd applicant). All remaining documents can be uploaded at any time.
 */
const DOCUMENT_TYPES: Array<{
  key: string;
  label: string;
  helpText: string;
  scope: 'FORM' | 'APPLICANT';
  appliesTo?: 'PRIMARY' | 'SECONDARY';
  mimes: string[];
  mandatory?: boolean;
  requiredIfSecond?: boolean;
  sortOrder: number;
}> = [
  { key: 'photo_applicant_1', label: 'Passport-size photo', helpText: 'Photo of the sole / first applicant. Mandatory while creating the form.', scope: 'APPLICANT', appliesTo: 'PRIMARY', mimes: IMAGE, mandatory: true, sortOrder: 10 },
  { key: 'photo_applicant_2', label: 'Passport-size photo', helpText: 'Photo of the co / second applicant. Mandatory if there is a second applicant.', scope: 'APPLICANT', appliesTo: 'SECONDARY', mimes: IMAGE, requiredIfSecond: true, sortOrder: 20 },
  { key: 'pan_applicant_1', label: 'PAN card', helpText: 'PAN card of the first applicant. Mandatory while creating the form.', scope: 'APPLICANT', appliesTo: 'PRIMARY', mimes: SCAN, mandatory: true, sortOrder: 30 },
  { key: 'pan_applicant_2', label: 'PAN card', helpText: 'PAN card of the second applicant. Mandatory if there is a second applicant.', scope: 'APPLICANT', appliesTo: 'SECONDARY', mimes: SCAN, requiredIfSecond: true, sortOrder: 40 },
  { key: 'aadhaar_applicant_1', label: 'Adhaar card', helpText: 'Adhaar card of the first applicant. Mandatory while creating the form.', scope: 'APPLICANT', appliesTo: 'PRIMARY', mimes: SCAN, mandatory: true, sortOrder: 50 },
  { key: 'aadhaar_applicant_2', label: 'Adhaar card', helpText: 'Adhaar card of the second applicant. Mandatory if there is a second applicant.', scope: 'APPLICANT', appliesTo: 'SECONDARY', mimes: SCAN, requiredIfSecond: true, sortOrder: 60 },
  { key: 'first_payment_screenshot', label: '1st payment screenshot', helpText: 'Screenshot or receipt of the first payment. Can be uploaded anytime.', scope: 'FORM', mimes: SCAN, sortOrder: 70 },
  { key: 'simple_cost_sheet', label: 'Simple cost sheet', helpText: 'The agreed cost sheet. Can be uploaded anytime.', scope: 'FORM', mimes: SCAN, sortOrder: 80 },
  { key: 'mail', label: 'Mail', helpText: 'Photo or screenshot of the approval mail. Can be uploaded anytime.', scope: 'FORM', mimes: SCAN, sortOrder: 90 },
  { key: 'discount_cost_sheet', label: 'Discount cost sheet', helpText: 'Only if a discount was approved. Can be uploaded anytime.', scope: 'FORM', mimes: SCAN, sortOrder: 100 },
];

function readTncBody(): string {
  const raw = readFileSync(resolve(repoRoot, 'content/terms/v1.md'), 'utf8');
  const withoutFrontmatter = raw.replace(/^---[\s\S]*?\n---\n/, '');
  const [beforeChecklist] = withoutFrontmatter.split('# § REVIEW CHECKLIST');
  const text = (beforeChecklist ?? withoutFrontmatter).trim();

  const titleIndex = text.search(/^# /m);
  if (titleIndex === -1) {
    throw new Error(
      'content/terms/v1.md has no "# " title line, so the customer-facing text cannot be ' +
        'separated from the editorial preamble.',
    );
  }

  const fromTitle = text.slice(titleIndex);
  const ruleIndex = fromTitle.search(/^\s*---\s*$/m);
  const clauses = ruleIndex === -1 ? fromTitle : fromTitle.slice(0, ruleIndex);

  return clauses.trim();
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'yes') {
    throw new Error(
      'Refusing to seed demo accounts in production. Set SEED_ALLOW_PRODUCTION=yes only if you really mean it.',
    );
  }

  console.log('Seeding…');

  const organization = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: {},
    create: { slug: ORG_SLUG, name: 'DAC Developers Pvt Ltd' },
  });

  // --- Roles --------------------------------------------------------------
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { label: role.label, description: role.description },
      create: role,
    });
  }
  const roleByName = new Map(
    (await prisma.role.findMany()).map((r) => [r.name, r.id] as const),
  );
  console.log(`  roles: ${roleByName.size}`);

  // --- Users --------------------------------------------------------------
  const passwordHash = await hash(SEED_PASSWORD, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  for (const u of USERS) {
    const roleId = roleByName.get(u.role);
    if (!roleId) throw new Error(`Missing role ${u.role}`);

    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, roleId, isActive: true },
      create: {
        email: u.email,
        name: u.name,
        roleId,
        organizationId: organization.id,
        passwordHash,
        isActive: true,
      },
    });
  }
  console.log(`  users: ${USERS.length}`);

  // --- Source options -----------------------------------------------------
  const sources = [
    { value: 'WALK_IN', label: 'Walk-in', sortOrder: 10 },
    { value: 'REFERRAL', label: 'Referral', sortOrder: 20 },
    { value: 'DIGITAL', label: 'Digital', sortOrder: 30 },
    { value: 'OTHER', label: 'Other', sortOrder: 40 },
  ];
  for (const s of sources) {
    await prisma.sourceOption.upsert({
      where: { value: s.value },
      update: { label: s.label, sortOrder: s.sortOrder },
      create: s,
    });
  }
  console.log(`  source options: ${sources.length}`);

  // --- Projects -----------------------------------------------------------
  const placeholders = [
    { name: 'Demo Project A', externalCode: 'DEMO-A' },
    { name: 'Demo Project B', externalCode: 'DEMO-B' },
  ];
  for (const p of placeholders) {
    const existing = await prisma.project.findFirst({
      where: { organizationId: organization.id, name: p.name },
    });
    if (!existing) {
      await prisma.project.create({
        data: { ...p, organizationId: organization.id },
      });
    }
  }
  console.log(`  projects: ${placeholders.length} placeholder(s)`);

  // --- Document types -----------------------------------------------------
  for (const d of DOCUMENT_TYPES) {
    const documentType = await prisma.documentType.upsert({
      where: { organizationId_key: { organizationId: organization.id, key: d.key } },
      update: {
        label: d.label,
        helpText: d.helpText,
        scope: d.scope,
        appliesTo: d.appliesTo ?? null,
        acceptedMimeTypes: d.mimes,
        sortOrder: d.sortOrder,
        isActive: true,
      },
      create: {
        organizationId: organization.id,
        key: d.key,
        label: d.label,
        helpText: d.helpText,
        scope: d.scope,
        appliesTo: d.appliesTo ?? null,
        acceptedMimeTypes: d.mimes,
        sortOrder: d.sortOrder,
      },
    });

    await prisma.documentRequirement.upsert({
      where: { documentTypeId: documentType.id },
      update: {
        isMandatory: d.mandatory ?? false,
        requiredIfSecondApplicant: d.requiredIfSecond ?? false,
      },
      create: {
        documentTypeId: documentType.id,
        isMandatory: d.mandatory ?? false,
        requiredIfSecondApplicant: d.requiredIfSecond ?? false,
      },
    });
  }
  console.log(`  document types: ${DOCUMENT_TYPES.length}`);

  // --- Flow template + steps ----------------------------------------------
  let flowTemplate = await prisma.flowTemplate.findFirst({
    where: { name: 'Booking Form — standard' },
  });
  flowTemplate ??= await prisma.flowTemplate.create({
    data: { name: 'Booking Form — standard' },
  });

  // Remove any legacy steps beyond the 8-step pipeline (e.g. step 9 when Director was step 8).
  const legacySteps = await prisma.flowStep.findMany({
    where: {
      flowTemplateId: flowTemplate.id,
      orderIndex: { gt: FLOW_STEPS.length },
    },
    select: { id: true },
  });
  if (legacySteps.length > 0) {
    const legacyIds = legacySteps.map((s) => s.id);
    await prisma.formStepRecord.deleteMany({
      where: { flowStepId: { in: legacyIds } },
    });
    await prisma.flowStep.deleteMany({
      where: { id: { in: legacyIds } },
    });
  }

  for (const step of FLOW_STEPS) {
    const roleId = roleByName.get(step.role);
    if (!roleId) throw new Error(`Missing role ${step.role}`);

    await prisma.flowStep.upsert({
      where: {
        flowTemplateId_orderIndex: {
          flowTemplateId: flowTemplate.id,
          orderIndex: step.orderIndex,
        },
      },
      update: {
        label: step.label,
        roleId,
        action: step.action,
        pdfSignatureSlot: step.slot,
        actsOnCreatorDevice: step.onCreatorDevice ?? false,
        skipIfNoSecondApplicant: step.skipIfNoSecond ?? false,
      },
      create: {
        flowTemplateId: flowTemplate.id,
        orderIndex: step.orderIndex,
        label: step.label,
        roleId,
        action: step.action,
        pdfSignatureSlot: step.slot,
        actsOnCreatorDevice: step.onCreatorDevice ?? false,
        skipIfNoSecondApplicant: step.skipIfNoSecond ?? false,
      },
    });
  }
  console.log(`  flow steps: ${FLOW_STEPS.length}`);

  // --- Form template ------------------------------------------------------
  await prisma.formTemplate.upsert({
    where: { organizationId_key: { organizationId: organization.id, key: 'booking_form' } },
    update: { name: 'Booking Form', flowTemplateId: flowTemplate.id },
    create: {
      organizationId: organization.id,
      key: 'booking_form',
      name: 'Booking Form',
      flowTemplateId: flowTemplate.id,
    },
  });
  console.log('  form template: booking_form');

  // --- T&C v1 -------------------------------------------------------------
  const body = readTncBody();
  const bodySha256 = createHash('sha256').update(body).digest('hex');

  await prisma.tncVersion.upsert({
    where: { organizationId_version: { organizationId: organization.id, version: 'v1' } },
    update: { body, bodySha256 },
    create: {
      organizationId: organization.id,
      version: 'v1',
      title: 'TERMS & CONDITIONS FOR PROVISIONAL ALLOTMENT',
      body,
      bodySha256,
      isApproved: false,
      effectiveFrom: null,
    },
  });
  console.log(`  T&C v1 (${body.length} chars, sha256 ${bodySha256.slice(0, 12)}…) — NOT approved`);

  console.log('\nDone.');
  console.log(`\n  Demo accounts (password: ${SEED_PASSWORD})`);
  for (const u of USERS) {
    console.log(`    ${u.email.padEnd(26)} ${u.name}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
