import { describe, expect, it } from 'vitest';
import {
  addressSchema,
  applicantSchema,
  draftSchema,
  headerSchema,
  paymentSchema,
  propertySchema,
  submitSchema,
} from './booking-form';

const PROJECT_ID = '11111111-2222-4333-8444-555555555555';

const validApplicant = {
  salutation: 'MR',
  fullName: 'ravi kumar',
  relationType: 'SON_OF',
  guardianSalutation: 'MR',
  guardianName: 'suresh kumar',
  mobileNo: '9876543210',
  altMobileNo: '',
  email: 'Ravi.Kumar@Example.COM',
  pan: 'abcde1234f',
  aadhaar: '234567890124',
  dob: '1990-05-14',
  occupation: 'Engineer',
  companyName: 'Acme Ltd',
  designation: 'Manager',
  location: 'Chennai',
};

const validHeader = {
  bookingDate: '2026-10-23',
  projectId: PROJECT_ID,
  propertyType: 'VILLA',
  apartmentNo: '',
  salesExecutive: 'Ravi Executive',
  salesHead: 'Vijay VP',
  telecaller: '',
  leadId: 'LEAD-00123',
  source: 'WALK_IN',
};

const validPayment = {
  bookingAdvance: '5,00,000',
  paymentMode: 'CHQ',
  paymentRefNo: 'CHQ-99881',
  paymentDate: '2026-10-20',
  bank: 'HDFC Bank',
  paymentSource: 'OWN_FUNDS',
  salePrice: '50,00,000',
};

describe('applicant', () => {
  it('accepts a valid applicant', () => {
    expect(applicantSchema.safeParse(validApplicant).success).toBe(true);
  });

  it('uppercases names, as the paper demands', () => {
    const parsed = applicantSchema.parse(validApplicant);
    expect(parsed.fullName).toBe('RAVI KUMAR');
    expect(parsed.guardianName).toBe('SURESH KUMAR');
  });

  it('normalises PAN and email', () => {
    const parsed = applicantSchema.parse(validApplicant);
    expect(parsed.pan).toBe('ABCDE1234F');
    expect(parsed.email).toBe('ravi.kumar@example.com');
  });

  it('rejects an under-18 applicant', () => {
    const tooYoung = new Date();
    tooYoung.setFullYear(tooYoung.getFullYear() - 17);
    const result = applicantSchema.safeParse({
      ...validApplicant,
      dob: tooYoung.toISOString().slice(0, 10),
    });
    expect(result.success).toBe(false);
  });

  it('accepts an applicant who turned 18 today', () => {
    const exactly18 = new Date();
    exactly18.setFullYear(exactly18.getFullYear() - 18);
    const result = applicantSchema.safeParse({
      ...validApplicant,
      dob: exactly18.toISOString().slice(0, 10),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a future date of birth', () => {
    expect(
      applicantSchema.safeParse({ ...validApplicant, dob: '2099-01-01' }).success,
    ).toBe(false);
  });

  it('rejects a date that does not exist', () => {
    expect(
      applicantSchema.safeParse({ ...validApplicant, dob: '2026-02-30' }).success,
    ).toBe(false);
  });

  it('rejects a bad Adhaar checksum', () => {
    expect(
      applicantSchema.safeParse({ ...validApplicant, aadhaar: '234567890123' }).success,
    ).toBe(false);
  });

  it('rejects a malformed PAN', () => {
    expect(
      applicantSchema.safeParse({ ...validApplicant, pan: 'ABCD1234F' }).success,
    ).toBe(false);
  });

  it('allows an empty alternate mobile but rejects a malformed one', () => {
    expect(
      applicantSchema.safeParse({ ...validApplicant, altMobileNo: '' }).success,
    ).toBe(true);
    expect(
      applicantSchema.safeParse({ ...validApplicant, altMobileNo: '12345' }).success,
    ).toBe(false);
  });
});

describe('header', () => {
  it('accepts a valid header', () => {
    expect(headerSchema.safeParse(validHeader).success).toBe(true);
  });

  it('requires Apartment No when the property type is Apartment', () => {
    const result = headerSchema.safeParse({
      ...validHeader,
      propertyType: 'APARTMENT',
      apartmentNo: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts Apartment with a number', () => {
    expect(
      headerSchema.safeParse({
        ...validHeader,
        propertyType: 'APARTMENT',
        apartmentNo: 'B-404',
      }).success,
    ).toBe(true);
  });

  it('does not require Apartment No for a Villa or Plot', () => {
    expect(headerSchema.safeParse({ ...validHeader, propertyType: 'PLOT' }).success).toBe(
      true,
    );
  });

  it('requires Lead ID — it is typed, not generated', () => {
    expect(headerSchema.safeParse({ ...validHeader, leadId: '' }).success).toBe(false);
  });
});

describe('payment', () => {
  it('converts amounts to paise', () => {
    const parsed = paymentSchema.parse(validPayment);
    expect(parsed.salePrice).toBe(500000000n);
    expect(parsed.bookingAdvance).toBe(50000000n);
  });

  it('rejects an advance larger than the sale price', () => {
    const result = paymentSchema.safeParse({
      ...validPayment,
      bookingAdvance: '60,00,000',
    });
    expect(result.success).toBe(false);
  });

  it('allows an advance equal to the sale price', () => {
    expect(
      paymentSchema.safeParse({ ...validPayment, bookingAdvance: '50,00,000' }).success,
    ).toBe(true);
  });

  it('rejects a zero sale price', () => {
    expect(paymentSchema.safeParse({ ...validPayment, salePrice: '0' }).success).toBe(
      false,
    );
  });
});

describe('property and address', () => {
  it('accepts valid property details', () => {
    expect(
      propertySchema.safeParse({ builtUpAreaSqft: '1450.50', udsSqft: '600', floor: 'G' })
        .success,
    ).toBe(true);
  });

  it('keeps Floor as text so "G" and "Stilt" survive', () => {
    const parsed = propertySchema.parse({
      builtUpAreaSqft: '1450',
      udsSqft: '600',
      floor: 'Stilt',
    });
    expect(parsed.floor).toBe('Stilt');
  });

  it('requires address line 1 only', () => {
    expect(addressSchema.safeParse({ line1: '12 Main Road' }).success).toBe(true);
    expect(addressSchema.safeParse({ line1: '' }).success).toBe(false);
  });
});

describe('submit gate', () => {
  const full = {
    header: validHeader,
    firstApplicant: validApplicant,
    secondApplicant: null,
    communicationAddress: { line1: '12 Main Road', line2: 'Adyar' },
    permanentAddress: { line1: '12 Main Road' },
    property: { builtUpAreaSqft: '1450', udsSqft: '600', floor: '2' },
    payment: validPayment,
    remarks: '',
    tncAccepted: true,
  };

  it('accepts a complete single-applicant form', () => {
    expect(submitSchema.safeParse(full).success).toBe(true);
  });

  it('accepts a complete two-applicant form', () => {
    expect(
      submitSchema.safeParse({ ...full, secondApplicant: validApplicant }).success,
    ).toBe(true);
  });

  it('blocks submission when the T&C are not accepted', () => {
    expect(submitSchema.safeParse({ ...full, tncAccepted: false }).success).toBe(false);
  });

  it('blocks submission when the second applicant is present but invalid', () => {
    expect(
      submitSchema.safeParse({
        ...full,
        secondApplicant: { ...validApplicant, pan: 'nope' },
      }).success,
    ).toBe(false);
  });
});

describe('draft autosave', () => {
  it('accepts a completely empty draft', () => {
    expect(draftSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a half-typed applicant without complaining', () => {
    const result = draftSchema.safeParse({
      firstApplicant: { fullName: 'RAV', mobileNo: '98765', pan: 'ABC' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an invalid Adhaar mid-typing — only submit is a gate', () => {
    expect(
      draftSchema.safeParse({ firstApplicant: { aadhaar: '2345' } }).success,
    ).toBe(true);
  });

  it('still caps lengths, so a draft cannot be used to stuff the database', () => {
    expect(
      draftSchema.safeParse({ remarks: 'x'.repeat(5000) }).success,
    ).toBe(false);
  });
});
