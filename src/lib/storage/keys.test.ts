import { describe, expect, it } from 'vitest';
import {
  buildDocumentKey,
  buildPdfKey,
  buildSignatureKey,
  extensionFor,
  formIdFromKey,
  isSafeKey,
  sanitizeSegment,
} from './keys';

const FORM = '7f1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9';

describe('extensionFor', () => {
  it('maps the types the pickers accept', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('image/webp')).toBe('webp');
    expect(extensionFor('image/heic')).toBe('heic');
    expect(extensionFor('application/pdf')).toBe('pdf');
  });

  it('is case insensitive, because browsers are inconsistent', () => {
    expect(extensionFor('IMAGE/JPEG')).toBe('jpg');
  });

  it('falls back to .bin rather than trusting an unknown type', () => {
    expect(extensionFor('application/x-msdownload')).toBe('bin');
    expect(extensionFor('')).toBe('bin');
  });
});

describe('sanitizeSegment', () => {
  it('keeps safe characters', () => {
    expect(sanitizeSegment('pan_applicant_1')).toBe('pan_applicant_1');
    expect(sanitizeSegment(FORM)).toBe(FORM);
  });

  it('collapses traversal sequences', () => {
    expect(sanitizeSegment('..')).toBe('');
    expect(sanitizeSegment('../../etc/passwd')).not.toContain('..');
    expect(sanitizeSegment('a..b')).toBe('a-b');
  });

  it('strips separators so a segment cannot become a path', () => {
    expect(sanitizeSegment('a/b')).toBe('a-b');
    expect(sanitizeSegment('a\\b')).toBe('a-b');
  });

  it('refuses to start or end with a dot or dash', () => {
    expect(sanitizeSegment('.hidden')).toBe('hidden');
    expect(sanitizeSegment('trailing.')).toBe('trailing');
  });

  it('caps the length', () => {
    expect(sanitizeSegment('x'.repeat(200))).toHaveLength(64);
  });
});

describe('buildDocumentKey', () => {
  it('nests the key under the booking form', () => {
    const key = buildDocumentKey({
      bookingFormId: FORM,
      documentTypeKey: 'pan_applicant_1',
      mimeType: 'image/jpeg',
      unique: 'abc123',
    });
    expect(key).toBe(`bookings/${FORM}/pan_applicant_1/abc123.jpg`);
  });

  it('gives two uploads of the same type different keys', () => {
    const base = {
      bookingFormId: FORM,
      documentTypeKey: 'mail',
      mimeType: 'application/pdf',
    };
    const first = buildDocumentKey({ ...base, unique: 'one' });
    const second = buildDocumentKey({ ...base, unique: 'two' });
    expect(first).not.toBe(second);
  });

  it('cannot be talked out of its prefix', () => {
    const key = buildDocumentKey({
      bookingFormId: '../../../etc',
      documentTypeKey: 'mail',
      mimeType: 'image/png',
      unique: 'u',
    });
    expect(key.startsWith('bookings/')).toBe(true);
    expect(key).not.toContain('..');
  });

  it('rejects empty segments rather than producing a half-formed key', () => {
    expect(() =>
      buildDocumentKey({
        bookingFormId: '...',
        documentTypeKey: 'mail',
        mimeType: 'image/png',
        unique: 'u',
      }),
    ).toThrow();
  });
});

describe('buildSignatureKey', () => {
  it('nests signatures under the booking, beside its documents', () => {
    expect(buildSignatureKey({ bookingFormId: FORM, unique: 'abc123' })).toBe(
      `bookings/${FORM}/signatures/abc123.png`,
    );
  });

  it('never collides, so re-signing cannot overwrite the old image', () => {
    const first = buildSignatureKey({ bookingFormId: FORM, unique: 'one' });
    const second = buildSignatureKey({ bookingFormId: FORM, unique: 'two' });
    expect(first).not.toBe(second);
  });

  it('produces a key that passes the safety check', () => {
    expect(isSafeKey(buildSignatureKey({ bookingFormId: FORM, unique: 'u' }))).toBe(true);
  });

  it('cannot be talked out of its prefix', () => {
    const key = buildSignatureKey({ bookingFormId: '../../../etc', unique: 'u' });
    expect(key.startsWith('bookings/')).toBe(true);
    expect(key).not.toContain('..');
  });

  it('rejects empty segments', () => {
    expect(() => buildSignatureKey({ bookingFormId: '...', unique: 'u' })).toThrow();
  });
});

describe('buildPdfKey', () => {
  it('nests the PDF under the booking', () => {
    expect(buildPdfKey({ bookingFormId: FORM, unique: 'abc123' })).toBe(
      `bookings/${FORM}/pdf/abc123.pdf`,
    );
  });

  it('produces a key that passes the safety check', () => {
    expect(isSafeKey(buildPdfKey({ bookingFormId: FORM, unique: 'u' }))).toBe(true);
  });

  it('never overwrites an earlier PDF in place', () => {
    expect(buildPdfKey({ bookingFormId: FORM, unique: 'one' })).not.toBe(
      buildPdfKey({ bookingFormId: FORM, unique: 'two' }),
    );
  });

  it('cannot be talked out of its prefix', () => {
    const key = buildPdfKey({ bookingFormId: '../../../etc', unique: 'u' });
    expect(key.startsWith('bookings/')).toBe(true);
    expect(key).not.toContain('..');
  });

  it('rejects empty segments', () => {
    expect(() => buildPdfKey({ bookingFormId: '...', unique: 'u' })).toThrow();
  });
});

describe('isSafeKey', () => {
  it('accepts the keys we generate', () => {
    expect(isSafeKey(`bookings/${FORM}/mail/abc.pdf`)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['absolute', '/etc/passwd'],
    ['traversal', 'bookings/../../secret'],
    ['backslash', 'bookings\\x'],
    ['null byte', 'bookings/a\0b'],
    ['space', 'bookings/a b'],
    ['query', 'bookings/a?b=1'],
  ])('rejects %s', (_name, key) => {
    expect(isSafeKey(key)).toBe(false);
  });

  it('rejects an absurdly long key', () => {
    expect(isSafeKey(`bookings/${'a'.repeat(600)}`)).toBe(false);
  });
});

describe('formIdFromKey', () => {
  it('recovers the form id a key belongs to', () => {
    expect(formIdFromKey(`bookings/${FORM}/mail/abc.pdf`)).toBe(FORM);
  });

  it('returns null for anything not laid out as one of ours', () => {
    expect(formIdFromKey('other/x/y.pdf')).toBeNull();
    expect(formIdFromKey('bookings/')).toBeNull();
  });
});
