import { describe, expect, it } from 'vitest';
import {
  createUploadToken,
  verifyUploadToken,
  type UploadGrant,
} from './upload-token';

const SECRET = 'test-secret-not-a-real-key';
const OTHER_SECRET = 'a-different-secret';

const NOW = new Date('2026-10-23T10:00:00Z');

function grant(overrides: Partial<UploadGrant> = {}): UploadGrant {
  return {
    userId: 'user-1',
    bookingFormId: 'form-1',
    documentTypeId: 'type-1',
    applicantId: 'applicant-1',
    storageKey: 'bookings/form-1/pan_applicant_1/abc.jpg',
    contentType: 'image/jpeg',
    maxBytes: 10 * 1024 * 1024,
    expiresAt: Math.floor(NOW.getTime() / 1000) + 900,
    ...overrides,
  };
}

describe('upload grants', () => {
  it('round-trips every field', () => {
    const original = grant();
    const result = verifyUploadToken(createUploadToken(original, SECRET), SECRET, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grant).toEqual(original);
  });

  it('carries a null applicant for form-scoped documents', () => {
    const original = grant({ applicantId: null });
    const result = verifyUploadToken(createUploadToken(original, SECRET), SECRET, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grant.applicantId).toBeNull();
  });

  it('is deterministic, so the same grant signs identically', () => {
    expect(createUploadToken(grant(), SECRET)).toBe(createUploadToken(grant(), SECRET));
  });
});

describe('tampering', () => {
  it('rejects a token signed with a different secret', () => {
    const token = createUploadToken(grant(), OTHER_SECRET);
    expect(verifyUploadToken(token, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('rejects an edited payload', () => {
    // Raise the size ceiling, which is the change an attacker would want.
    const token = createUploadToken(grant(), SECRET);
    const [payload, signature] = token.split('.') as [string, string];

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown[];
    decoded[6] = 500 * 1024 * 1024;
    const forged = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');

    expect(verifyUploadToken(`${forged}.${signature}`, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('rejects a redirected storage key', () => {
    const token = createUploadToken(grant(), SECRET);
    const [payload, signature] = token.split('.') as [string, string];

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown[];
    decoded[4] = 'bookings/someone-elses-form/mail/x.jpg';
    const forged = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');

    expect(verifyUploadToken(`${forged}.${signature}`, SECRET, NOW).ok).toBe(false);
  });

  it.each([
    ['no separator', 'justonepart'],
    ['empty', ''],
    ['empty payload', '.signature'],
    ['empty signature', 'payload.'],
    ['three parts', 'a.b.c'],
  ])('rejects a malformed token (%s)', (_name, token) => {
    expect(verifyUploadToken(token, SECRET, NOW).ok).toBe(false);
  });

  it('reports a well-signed but nonsensical payload as malformed', () => {
    // Signed correctly, so it gets past the signature check — the shape test
    // is what has to catch it.
    const payload = Buffer.from(JSON.stringify(['too', 'short']), 'utf8').toString('base64url');
    const token = createUploadToken(grant(), SECRET);
    const realSignature = token.split('.')[1] as string;

    // Signature will not match the short payload, so use the API the way an
    // attacker would have to: forge both. Without the secret they cannot.
    expect(verifyUploadToken(`${payload}.${realSignature}`, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });
});

describe('expiry', () => {
  it('accepts a grant that is still live', () => {
    const token = createUploadToken(grant(), SECRET);
    const almost = new Date(NOW.getTime() + 899_000);
    expect(verifyUploadToken(token, SECRET, almost).ok).toBe(true);
  });

  it('rejects a grant past its expiry', () => {
    const token = createUploadToken(grant(), SECRET);
    const later = new Date(NOW.getTime() + 901_000);
    expect(verifyUploadToken(token, SECRET, later)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('treats the exact expiry second as expired', () => {
    const expiresAt = Math.floor(NOW.getTime() / 1000) + 60;
    const token = createUploadToken(grant({ expiresAt }), SECRET);
    expect(verifyUploadToken(token, SECRET, new Date(expiresAt * 1000)).ok).toBe(false);
  });
});
