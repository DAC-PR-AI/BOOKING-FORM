/**
 * Storage key construction.
 *
 * Pure and unit tested, because a key is effectively a permission boundary:
 * every key is derived from the booking form's id, and the download route
 * checks access against that same id. A key that could escape its prefix
 * (`../`) or collide with another form's would be an access-control bug, not
 * a cosmetic one.
 *
 * Layout:  bookings/{formId}/{documentTypeKey}/{uuid}.{ext}
 *
 * The random segment means replacing a document never overwrites the previous
 * object in place, so a signed URL already in flight cannot silently start
 * serving different bytes.
 */

/** Extensions we are willing to put on a key, by MIME type. */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

export function extensionFor(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType.toLowerCase()] ?? 'bin';
}

/**
 * Strips anything that could change the meaning of a path.
 * Keys are built from our own ids and type keys, so this is belt-and-braces,
 * but the cost of being wrong here is high enough to justify it.
 */
export function sanitizeSegment(segment: string): string {
  return segment
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64);
}

export function buildDocumentKey(input: {
  bookingFormId: string;
  documentTypeKey: string;
  mimeType: string;
  /** Injected in tests; a UUID in production. */
  unique: string;
}): string {
  const form = sanitizeSegment(input.bookingFormId);
  const type = sanitizeSegment(input.documentTypeKey);
  const unique = sanitizeSegment(input.unique);

  if (!form || !type || !unique) {
    throw new Error('Cannot build a storage key from empty segments.');
  }

  return `bookings/${form}/${type}/${unique}.${extensionFor(input.mimeType)}`;
}

/**
 * Signature images: bookings/{formId}/signatures/{uuid}.png
 *
 * Same prefix as the documents so one booking's files sit together, and the
 * same random segment so re-signing a reopened step never overwrites the
 * previous image in place — the old signature stays addressable for the audit
 * trail even once the step record points at the new one.
 */
export function buildSignatureKey(input: {
  bookingFormId: string;
  /** Injected in tests; a UUID in production. */
  unique: string;
}): string {
  const form = sanitizeSegment(input.bookingFormId);
  const unique = sanitizeSegment(input.unique);

  if (!form || !unique) {
    throw new Error('Cannot build a signature key from empty segments.');
  }

  return `bookings/${form}/signatures/${unique}.png`;
}

/** Guards a key that arrived from outside before it reaches the filesystem. */
export function isSafeKey(key: string): boolean {
  if (key.length === 0 || key.length > 512) return false;
  if (key.startsWith('/') || key.includes('..') || key.includes('\\')) return false;
  if (key.includes('\0')) return false;
  return /^[a-zA-Z0-9/._-]+$/.test(key);
}

/** The form a key belongs to, so a download can be authorised against it. */
export function formIdFromKey(key: string): string | null {
  const match = /^bookings\/([a-zA-Z0-9-]+)\//.exec(key);
  return match?.[1] ?? null;
}
