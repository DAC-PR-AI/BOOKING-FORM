import { describe, expect, it } from 'vitest';
import {
  digestLine,
  digestSubject,
  renderNotification,
  type FlowEvent,
} from './events';

const BOOKING = 'DAC/2026/00042';
const FORM_ID = '7f1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9';

function stepOpened(overrides: Partial<Extract<FlowEvent, { kind: 'step-opened' }>> = {}) {
  return renderNotification({
    kind: 'step-opened',
    bookingId: BOOKING,
    formId: FORM_ID,
    stepLabel: 'AGM',
    requiresValidation: false,
    applicantName: 'RAVI KUMAR',
    raisedBy: 'Ravi Executive',
    ...overrides,
  });
}

describe('step-opened', () => {
  it('says which booking, and that it is theirs to act on', () => {
    const content = stepOpened();
    expect(content.title).toContain(BOOKING);
    expect(content.title).toContain('waiting on you');
  });

  it('names the step, the applicant and who raised it', () => {
    const content = stepOpened();
    expect(content.body).toContain('AGM');
    expect(content.body).toContain('RAVI KUMAR');
    expect(content.body).toContain('Ravi Executive');
  });

  it('says what the action is, not just that there is one', () => {
    expect(stepOpened().body).toContain('sign');
  });

  it('asks the Co-ordinator to validate, not merely to sign', () => {
    const content = stepOpened({ requiresValidation: true, stepLabel: 'Sales Co-ordinator' });
    expect(content.body).toContain('validate');
    expect(content.body).toContain('documents');
  });

  it('links to the booking', () => {
    expect(stepOpened().link).toBe(`/forms/${FORM_ID}`);
  });

  it('reads cleanly when the applicant has no name yet', () => {
    const content = stepOpened({ applicantName: null });
    expect(content.body).not.toContain('null');
    expect(content.body).not.toContain('undefined');
    expect(content.body).not.toContain('  ');
  });
});

describe('applicant-capture', () => {
  const content = renderNotification({
    kind: 'applicant-capture',
    bookingId: BOOKING,
    formId: FORM_ID,
    stepLabel: '1st Applicant',
    applicantName: 'RAVI KUMAR',
  });

  it('makes clear this one happens in person', () => {
    expect(content.body).toContain('in person');
    expect(content.body).toContain('your device');
  });

  it('names the applicant who has to sign', () => {
    expect(content.body).toContain('RAVI KUMAR');
  });
});

describe('returned', () => {
  const content = renderNotification({
    kind: 'returned',
    bookingId: BOOKING,
    formId: FORM_ID,
    stepLabel: 'Sales Co-ordinator',
    returnedBy: 'Kavya Co-ordinator',
    comment: 'The bank name does not match the cheque.',
  });

  it('carries the reason, which is the whole point of a return', () => {
    expect(content.body).toContain('The bank name does not match the cheque.');
  });

  it('names who sent it back and from which step', () => {
    expect(content.body).toContain('Kavya Co-ordinator');
    expect(content.body).toContain('Sales Co-ordinator');
  });

  it('reassures that earlier signatures survive', () => {
    expect(content.body).toContain('signatures');
    expect(content.body).toContain('kept');
  });

  it('links straight to the editor, which is where the work is', () => {
    expect(content.link).toBe(`/forms/${FORM_ID}/edit`);
  });
});

describe('completed', () => {
  const content = renderNotification({
    kind: 'completed',
    bookingId: BOOKING,
    formId: FORM_ID,
    applicantName: 'RAVI KUMAR',
  });

  it('says it is done and what can be done next', () => {
    expect(content.title).toContain('complete');
    expect(content.body).toContain('PDF');
  });
});

describe('submitted', () => {
  const content = renderNotification({
    kind: 'submitted',
    bookingId: BOOKING,
    formId: FORM_ID,
    applicantName: 'RAVI KUMAR',
    submittedBy: 'Ravi Executive',
  });

  it('names who submitted it', () => {
    expect(content.body).toContain('Ravi Executive');
  });
});

describe('every event', () => {
  const events: FlowEvent[] = [
    { kind: 'step-opened', bookingId: BOOKING, formId: FORM_ID, stepLabel: 'AGM', requiresValidation: false, applicantName: null, raisedBy: 'X' },
    { kind: 'applicant-capture', bookingId: BOOKING, formId: FORM_ID, stepLabel: '1st Applicant', applicantName: null },
    { kind: 'returned', bookingId: BOOKING, formId: FORM_ID, stepLabel: 'MIS', returnedBy: 'Y', comment: 'Fix the price.' },
    { kind: 'completed', bookingId: BOOKING, formId: FORM_ID, applicantName: null },
    { kind: 'submitted', bookingId: BOOKING, formId: FORM_ID, applicantName: null, submittedBy: 'Z' },
  ];

  it.each(events)('names the booking in the title ($kind)', (event) => {
    expect(renderNotification(event).title).toContain(BOOKING);
  });

  it.each(events)('produces a link into the app ($kind)', (event) => {
    expect(renderNotification(event).link.startsWith('/forms/')).toBe(true);
  });

  it.each(events)('never leaks a null or undefined into the text ($kind)', (event) => {
    const content = renderNotification(event);
    expect(`${content.title} ${content.body}`).not.toMatch(/null|undefined/);
  });

  it.each(events)('carries no PAN or Aadhaar ($kind)', (event) => {
    // Notifications reach email, which leaves India. They may carry a booking
    // id and a name; they must never carry a regulated identifier.
    const text = `${renderNotification(event).title} ${renderNotification(event).body}`;
    expect(text).not.toMatch(/\b\d{12}\b/);
    expect(text).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/);
  });
});

describe('the digest', () => {
  it('counts correctly in the subject', () => {
    expect(digestSubject(1)).toBe('1 booking is waiting on you');
    expect(digestSubject(4)).toBe('4 bookings are waiting on you');
  });

  it('puts the title and body on one line', () => {
    const line = digestLine(stepOpened());
    expect(line).toContain(BOOKING);
    expect(line).toContain('AGM');
    expect(line.split('\n')).toHaveLength(1);
  });
});
