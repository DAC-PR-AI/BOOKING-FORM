import { z } from 'zod';
import { isValidAadhaar, isValidMobile, isValidPan } from './aadhaar';
import { parseRupeesToPaise } from '@/lib/format/money';

/**
 * Validation for the booking form.
 *
 * Two levels, deliberately:
 *   * `draftSchema`  — everything optional. Autosave must never reject a
 *     half-filled form; a sales executive types in the order the applicant
 *     talks, not in field order.
 *   * `submitSchema` — the real gate. Re-parsed on the server at submit; the
 *     client copy is a convenience, never the authority.
 *
 * Field order and labels follow FIELD_MAP.md, which was verified against the
 * photographed form.
 */

// --- shared primitives -----------------------------------------------------

/** Paper says CAPITAL LETTERS ONLY. We transform rather than scold. */
const upperName = (label: string, max = 120) =>
  z
    .string()
    .trim()
    .min(2, `${label} must be at least 2 characters.`)
    .max(max, `${label} must be at most ${max} characters.`)
    .regex(
      /^[A-Za-z][A-Za-z\s.'-]*$/,
      `${label} may contain only letters, spaces, dots, apostrophes and hyphens.`,
    )
    .transform((v) => v.toUpperCase());

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters.`)
    .optional()
    .or(z.literal('').transform(() => undefined));

// Deliberately permissive: a valid address can look odd, and rejecting a real
// customer's email is worse than accepting an unusual one.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => EMAIL_PATTERN.test(v), 'Enter a valid email address.');

const mobile = z
  .string()
  .trim()
  .refine(isValidMobile, 'Enter a valid 10-digit mobile number starting 6–9.');

const pan = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isValidPan, 'PAN must be in the format AAAAA9999A.');

const aadhaar = z
  .string()
  .trim()
  .refine(isValidAadhaar, 'Enter a valid 12-digit Adhaar number.');

/** ISO date string from <input type="date"> or assembled from the 8 D.O.B boxes. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && v === d.toISOString().slice(0, 10);
  }, 'That date does not exist.');

const dateOfBirth = isoDate
  .refine((v) => new Date(`${v}T00:00:00Z`) < new Date(), 'Date of birth must be in the past.')
  .refine((v) => {
    const dob = new Date(`${v}T00:00:00Z`);
    const eighteen = new Date(dob);
    eighteen.setUTCFullYear(eighteen.getUTCFullYear() + 18);
    return eighteen <= new Date();
  }, 'The applicant must be at least 18 years old.');

/** Money arrives as a display string and leaves as paise. */
const money = (label: string) =>
  z.string().transform((value, ctx) => {
    const result = parseRupeesToPaise(value);
    if (!result.ok) {
      ctx.addIssue({ code: 'custom', message: `${label}: enter a valid amount.` });
      return z.NEVER;
    }
    if (result.paise <= 0n) {
      ctx.addIssue({ code: 'custom', message: `${label} must be greater than zero.` });
      return z.NEVER;
    }
    return result.paise;
  });

const decimalArea = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,8}(\.\d{1,2})?$/, `${label} must be a number.`)
    .refine((v) => Number(v) > 0, `${label} must be greater than zero.`);

// --- enums (mirror the Prisma enums) ---------------------------------------

export const salutationEnum = z.enum(['MR', 'MRS', 'MS']);
export const relationEnum = z.enum(['SON_OF', 'DAUGHTER_OF', 'WIFE_OF']);
export const propertyTypeEnum = z.enum(['VILLA', 'PLOT', 'APARTMENT']);
export const paymentModeEnum = z.enum(['CHQ', 'CARD', 'ONLINE']);
export const paymentSourceEnum = z.enum(['OWN_FUNDS', 'HOME_LOAN']);

// --- sections --------------------------------------------------------------

export const headerSchema = z
  .object({
    bookingDate: isoDate,
    projectId: z.string().uuid('Choose a project.'),
    propertyType: propertyTypeEnum,
    apartmentNo: optionalText(20),
    salesExecutive: z.string().trim().min(2, 'Sales Executive is required.').max(120),
    salesHead: z.string().trim().min(2, 'Sales Head is required.').max(120),
    telecaller: optionalText(120),
    leadId: z.string().trim().min(1, 'Lead ID is required.').max(60),
    source: z.string().trim().min(1, 'Choose a source.'),
  })
  .refine((v) => v.propertyType !== 'APARTMENT' || Boolean(v.apartmentNo), {
    message: 'Apartment No is required when the property type is Apartment.',
    path: ['apartmentNo'],
  });

export const applicantSchema = z.object({
  salutation: salutationEnum,
  fullName: upperName('Name'),
  relationType: relationEnum,
  guardianSalutation: salutationEnum,
  guardianName: upperName('Father / Husband name'),
  mobileNo: mobile,
  altMobileNo: z
    .string()
    .trim()
    .refine((v) => v === '' || isValidMobile(v), 'Enter a valid 10-digit mobile number.')
    .optional(),
  email,
  pan,
  aadhaar,
  dob: dateOfBirth,
  occupation: z.string().trim().min(2, 'Occupation is required.').max(120),
  companyName: optionalText(160),
  designation: optionalText(120),
  location: optionalText(160),
});

export const addressSchema = z.object({
  line1: z.string().trim().min(3, 'Address line 1 is required.').max(100),
  line2: optionalText(100),
  line3: optionalText(100),
  line4: optionalText(100),
});

export const propertySchema = z.object({
  builtUpAreaSqft: decimalArea('Built-up Area'),
  udsSqft: decimalArea('UDS'),
  floor: optionalText(20),
});

export const paymentSchema = z
  .object({
    bookingAdvance: money('Booking Advance'),
    paymentMode: paymentModeEnum,
    paymentRefNo: z.string().trim().min(1, 'Ref. No. is required.').max(60),
    paymentDate: isoDate,
    bank: z.string().trim().min(2, 'Bank is required.').max(120),
    paymentSource: paymentSourceEnum,
    salePrice: money('Sale Price'),
  })
  .refine((v) => v.bookingAdvance <= v.salePrice, {
    message: 'Booking Advance cannot be more than the Sale Price.',
    path: ['bookingAdvance'],
  });

// --- whole form ------------------------------------------------------------

export const submitSchema = z.object({
  header: headerSchema,
  firstApplicant: applicantSchema,
  /** Null when there is no second applicant — the paper block is optional. */
  secondApplicant: applicantSchema.nullable(),
  communicationAddress: addressSchema,
  permanentAddress: addressSchema,
  property: propertySchema,
  payment: paymentSchema,
  remarks: optionalText(1000),
  tncAccepted: z
    .boolean()
    .refine((v) => v, 'The Terms & Conditions must be accepted.'),
});

export type SubmitInput = z.input<typeof submitSchema>;
export type SubmitOutput = z.output<typeof submitSchema>;

/**
 * Autosave schema — every field optional and unvalidated beyond type and
 * length. A draft is allowed to be nonsense; only submit is a gate.
 */
export const draftSchema = z.object({
  bookingDate: z.string().optional(),
  projectId: z.string().optional(),
  propertyType: z.string().optional(),
  apartmentNo: z.string().max(20).optional(),
  salesExecutive: z.string().max(120).optional(),
  salesHead: z.string().max(120).optional(),
  telecaller: z.string().max(120).optional(),
  leadId: z.string().max(60).optional(),
  source: z.string().max(60).optional(),

  builtUpAreaSqft: z.string().max(20).optional(),
  udsSqft: z.string().max(20).optional(),
  floor: z.string().max(20).optional(),

  bookingAdvance: z.string().max(30).optional(),
  paymentMode: z.string().optional(),
  paymentRefNo: z.string().max(60).optional(),
  paymentDate: z.string().optional(),
  bank: z.string().max(120).optional(),
  paymentSource: z.string().optional(),
  salePrice: z.string().max(30).optional(),

  remarks: z.string().max(1000).optional(),

  hasSecondApplicant: z.boolean().optional(),
  sameAsCommunication: z.boolean().optional(),

  communicationAddress: z
    .object({
      line1: z.string().max(100).optional(),
      line2: z.string().max(100).optional(),
      line3: z.string().max(100).optional(),
      line4: z.string().max(100).optional(),
    })
    .optional(),
  permanentAddress: z
    .object({
      line1: z.string().max(100).optional(),
      line2: z.string().max(100).optional(),
      line3: z.string().max(100).optional(),
      line4: z.string().max(100).optional(),
    })
    .optional(),

  firstApplicant: applicantDraftShape().optional(),
  secondApplicant: applicantDraftShape().optional(),
});

export type DraftInput = z.infer<typeof draftSchema>;

function applicantDraftShape() {
  return z.object({
    salutation: z.string().optional(),
    fullName: z.string().max(120).optional(),
    relationType: z.string().optional(),
    guardianSalutation: z.string().optional(),
    guardianName: z.string().max(120).optional(),
    mobileNo: z.string().max(10).optional(),
    altMobileNo: z.string().max(10).optional(),
    email: z.string().max(254).optional(),
    pan: z.string().max(10).optional(),
    aadhaar: z.string().max(12).optional(),
    dob: z.string().max(10).optional(),
    occupation: z.string().max(120).optional(),
    companyName: z.string().max(160).optional(),
    designation: z.string().max(120).optional(),
    location: z.string().max(160).optional(),
  });
}
