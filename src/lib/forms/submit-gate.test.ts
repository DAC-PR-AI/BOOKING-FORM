import { describe, expect, it } from 'vitest';
import type { ChecklistSlot, ChecklistType } from '@/lib/documents/checklist';
import {
  evaluateSubmitReadiness,
  groupIssues,
  sectionHref,
  type GateInput,
} from './submit-gate';
import type { StoredSubmitInput } from '@/lib/validation/booking-form';

const PROJECT_ID = '7f1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9';

function applicant(): NonNullable<StoredSubmitInput['firstApplicant']> {
  return {
    salutation: 'MR',
    fullName: 'RAVI KUMAR',
    relationType: 'SON_OF',
    guardianSalutation: 'MR',
    guardianName: 'SURESH KUMAR',
    mobileNo: '9876543210',
    altMobileNo: '',
    email: 'ravi@example.com',
    panLast4: '123A',
    aadhaarLast4: '9012',
    dob: '1990-05-14',
    occupation: 'ENGINEER',
    companyName: 'ACME',
    designation: 'MANAGER',
    location: 'CHENNAI',
  };
}

function completeForm(): StoredSubmitInput {
  return {
    header: {
      bookingDate: '2026-10-24',
      projectId: PROJECT_ID,
      propertyType: 'VILLA',
      apartmentNo: '',
      salesExecutive: 'PRIYA S',
      salesHead: 'ARUN M',
      telecaller: '',
      leadId: 'LEAD-4471',
      source: 'WEBSITE',
    },
    firstApplicant: applicant(),
    secondApplicant: null,
    communicationAddress: { line1: '12 GANDHI STREET', line2: 'ADYAR', line3: '', line4: '' },
    permanentAddress: { line1: '12 GANDHI STREET', line2: 'ADYAR', line3: '', line4: '' },
    property: { builtUpAreaSqft: '1450', udsSqft: '600', floor: '2' },
    payment: {
      bookingAdvance: '500000',
      paymentMode: 'ONLINE',
      paymentRefNo: 'TXN-99881',
      paymentDate: '2026-10-24',
      bank: 'HDFC BANK',
      paymentSource: 'OWN_FUNDS',
      salePrice: '7500000',
    },
    remarks: '',
  };
}

function type(key: string, mandatory: boolean): ChecklistType {
  return {
    id: `type-${key}`,
    key,
    label: key,
    helpText: null,
    scope: 'FORM',
    appliesTo: null,
    acceptedMimeTypes: ['application/pdf'],
    maxBytes: 10 * 1024 * 1024,
    sortOrder: 0,
    requirement: { isMandatory: mandatory, requiredIfSecondApplicant: false },
  };
}

function slot(key: string, mandatory: boolean, attached: boolean): ChecklistSlot {
  return {
    type: type(key, mandatory),
    required: mandatory,
    document: attached
      ? {
          id: `doc-${key}`,
          documentTypeId: `type-${key}`,
          originalName: `${key}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          uploadedAt: new Date('2026-10-20T00:00:00Z'),
        }
      : null,
  };
}

/** Every mandatory document attached. */
function completeDocuments(): ChecklistSlot[] {
  return [slot('mail', true, true), slot('simple_cost_sheet', true, true)];
}

function gate(overrides: Partial<GateInput> = {}) {
  return evaluateSubmitReadiness({
    form: completeForm(),
    documents: completeDocuments(),
    ...overrides,
  });
}

describe('a complete form', () => {
  it('is ready to submit', () => {
    const result = gate();
    expect(result.issues).toEqual([]);
    expect(result.ready).toBe(true);
  });

  it('accepts a complete second applicant', () => {
    const form = completeForm();
    form.secondApplicant = applicant();
    expect(gate({ form }).ready).toBe(true);
  });

  it('accepts an optional document being absent', () => {
    const documents = [...completeDocuments(), slot('discount_cost_sheet', false, false)];
    expect(gate({ documents }).ready).toBe(true);
  });
});

describe('missing fields', () => {
  it('blocks on a missing Lead ID and names it as the paper does', () => {
    const form = completeForm();
    form.header.leadId = '';

    const result = gate({ form });
    expect(result.ready).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ section: 'header', field: 'Lead ID' });
  });

  it('reports every outstanding field at once, not just the first', () => {
    const form = completeForm();
    form.header.leadId = '';
    form.header.salesHead = '';
    form.property.builtUpAreaSqft = '';
    form.payment.bank = '';

    const result = gate({ form });
    expect(result.fieldIssueCount).toBe(4);
    expect(result.issues.map((i) => i.field)).toEqual(
      expect.arrayContaining(['Lead ID', 'Sales Head', 'Built-up Area (sq.ft)', 'Bank']),
    );
  });

  it('attributes each issue to the right block of the paper form', () => {
    const form = completeForm();
    form.firstApplicant.mobileNo = '12345';
    form.communicationAddress.line1 = '';
    form.payment.paymentRefNo = '';

    const sections = gate({ form }).issues.map((i) => i.section);
    expect(sections).toContain('firstApplicant');
    expect(sections).toContain('communicationAddress');
    expect(sections).toContain('payment');
  });

  it('orders the list the way the paper reads, top to bottom', () => {
    const form = completeForm();
    form.payment.bank = '';
    form.header.leadId = '';
    form.firstApplicant.occupation = '';

    const order = gate({ form }).issues.map((i) => i.section);
    expect(order).toEqual(['header', 'firstApplicant', 'payment']);
  });

  it('never shows a camelCase property name to the user', () => {
    const form = completeForm();
    form.firstApplicant.guardianName = '';
    form.property.udsSqft = '';
    form.payment.paymentDate = '';

    for (const issue of gate({ form }).issues) {
      expect(issue.field).not.toMatch(/[a-z][A-Z]/);
    }
  });
});

describe('PAN and Aadhaar, which are never decrypted', () => {
  it('accepts a stored last-4 as proof the value was validated on the way in', () => {
    expect(gate().ready).toBe(true);
  });

  it('blocks when the PAN was never stored', () => {
    const form = completeForm();
    form.firstApplicant.panLast4 = '';

    const result = gate({ form });
    expect(result.ready).toBe(false);
    expect(result.issues[0]).toMatchObject({
      section: 'firstApplicant',
      field: 'PAN card number',
    });
  });

  it('blocks when the Aadhaar was never stored', () => {
    const form = completeForm();
    form.firstApplicant.aadhaarLast4 = '';
    expect(gate({ form }).issues[0]?.field).toBe('Adhaar number');
  });

  it("blocks on the second applicant's identifiers too", () => {
    const form = completeForm();
    form.secondApplicant = { ...applicant(), aadhaarLast4: '' };

    const result = gate({ form });
    expect(result.ready).toBe(false);
    expect(result.issues[0]?.section).toBe('secondApplicant');
  });
});

describe('cross-field rules carry through to the gate', () => {
  it('blocks an advance larger than the sale price', () => {
    const form = completeForm();
    form.payment.bookingAdvance = '9000000';

    const result = gate({ form });
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.section === 'payment')).toBe(true);
  });

  it('requires an apartment number when the property type is Apartment', () => {
    const form = completeForm();
    form.header.propertyType = 'APARTMENT';
    form.header.apartmentNo = '';

    const result = gate({ form });
    expect(result.ready).toBe(false);
    expect(result.issues[0]).toMatchObject({ section: 'header', field: 'Apartment No' });
  });

  it('rejects an under-age applicant', () => {
    const form = completeForm();
    form.firstApplicant.dob = '2020-01-01';
    expect(gate({ form }).ready).toBe(false);
  });
});

describe('documents', () => {
  it('blocks on a missing mandatory document and says which', () => {
    const documents = [slot('mail', true, true), slot('simple_cost_sheet', true, false)];

    const result = gate({ documents });
    expect(result.ready).toBe(false);
    expect(result.documentIssueCount).toBe(1);
    expect(result.issues[0]).toMatchObject({
      section: 'documents',
      field: 'simple_cost_sheet',
    });
  });

  it('counts field and document problems separately', () => {
    const form = completeForm();
    form.header.leadId = '';
    const documents = [slot('mail', true, false), slot('simple_cost_sheet', true, false)];

    const result = gate({ form, documents });
    expect(result.fieldIssueCount).toBe(1);
    expect(result.documentIssueCount).toBe(2);
    expect(result.issues).toHaveLength(3);
  });

  it('puts documents last, after every field on the sheet', () => {
    const form = completeForm();
    form.header.leadId = '';
    const documents = [slot('mail', true, false)];

    const result = gate({ form, documents });
    expect(result.issues[result.issues.length - 1]?.section).toBe('documents');
  });
});

describe('groupIssues', () => {
  it('drops sections that are clean', () => {
    const form = completeForm();
    form.header.leadId = '';

    const groups = groupIssues(gate({ form }).issues);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe('Booking details');
  });

  it('returns nothing for a form with no issues', () => {
    expect(groupIssues([])).toEqual([]);
  });

  it('keeps paper order across groups', () => {
    const form = completeForm();
    form.payment.bank = '';
    form.header.leadId = '';
    const documents = [slot('mail', true, false)];

    const titles = groupIssues(gate({ form, documents }).issues).map((g) => g.section);
    expect(titles).toEqual(['header', 'payment', 'documents']);
  });
});

describe('sectionHref', () => {
  it('sends document problems to the documents page', () => {
    expect(sectionHref('abc', 'documents')).toBe('/forms/abc/documents');
  });

  it('sends every field problem to the editor', () => {
    expect(sectionHref('abc', 'payment')).toBe('/forms/abc/edit');
    expect(sectionHref('abc', 'firstApplicant')).toBe('/forms/abc/edit');
  });
});
