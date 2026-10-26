/**
 * Validating a captured signature.
 *
 * The signature pad draws on a canvas and sends a PNG data URL. That string
 * arrives from a browser, so none of it is trusted: not the declared type, not
 * the length, not the contents. This module turns it into bytes or rejects it,
 * and is pure so the rejections can be unit tested.
 *
 * It checks the PNG magic number rather than believing the `data:image/png`
 * prefix, because the prefix is just text the client wrote. A file that claims
 * to be a PNG and is not would be written to storage and later embedded in a
 * legal PDF.
 */

export const MAX_SIGNATURE_BYTES = 256 * 1024;

/**
 * Minimum plausible size for a drawn signature.
 *
 * A heuristic backstop, not a guarantee. An untouched canvas is uniformly
 * transparent and compresses to a few hundred bytes, while any real stroke
 * carries far more entropy — so this catches a blank pad submitted by a
 * client that skipped its own check. The browser also disables the button
 * until a stroke exists; neither check is sufficient alone and together they
 * are enough to stop an accidental empty signature, which is the realistic
 * failure. It cannot stop a determined forgery of a single dot, and is not
 * meant to.
 */
export const MIN_SIGNATURE_BYTES = 1024;

/** The eight-byte PNG signature, from the spec. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const DATA_URL_PREFIX = 'data:image/png;base64,';

export type SignatureFailure =
  | 'not-a-data-url'
  | 'wrong-type'
  | 'not-base64'
  | 'not-a-png'
  | 'too-small'
  | 'too-large';

export const SIGNATURE_FAILURE_MESSAGES: Record<SignatureFailure, string> = {
  'not-a-data-url': 'The signature could not be read. Please draw it again.',
  'wrong-type': 'The signature could not be read. Please draw it again.',
  'not-base64': 'The signature could not be read. Please draw it again.',
  'not-a-png': 'The signature could not be read. Please draw it again.',
  'too-small': 'That signature looks empty. Please sign in the box.',
  'too-large': 'That signature is too large. Please draw it again.',
};

export type ParsedSignature =
  | { ok: true; bytes: Buffer; sizeBytes: number }
  | { ok: false; reason: SignatureFailure };

export function parseSignatureDataUrl(value: string): ParsedSignature {
  if (typeof value !== 'string' || !value.startsWith('data:')) {
    return { ok: false, reason: 'not-a-data-url' };
  }

  if (!value.startsWith(DATA_URL_PREFIX)) {
    return { ok: false, reason: 'wrong-type' };
  }

  const base64 = value.slice(DATA_URL_PREFIX.length);
  if (base64.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return { ok: false, reason: 'not-base64' };
  }

  // Reject on the encoded length before decoding, so an enormous string is
  // never materialised as a buffer.
  if (base64.length > Math.ceil((MAX_SIGNATURE_BYTES * 4) / 3) + 4) {
    return { ok: false, reason: 'too-large' };
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch {
    return { ok: false, reason: 'not-base64' };
  }

  if (bytes.byteLength < PNG_MAGIC.byteLength || !bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    return { ok: false, reason: 'not-a-png' };
  }

  if (bytes.byteLength > MAX_SIGNATURE_BYTES) return { ok: false, reason: 'too-large' };
  if (bytes.byteLength < MIN_SIGNATURE_BYTES) return { ok: false, reason: 'too-small' };

  return { ok: true, bytes, sizeBytes: bytes.byteLength };
}

/**
 * Pixel dimensions from the IHDR chunk, which is always first in a valid PNG.
 * Stored on the asset so the PDF can place the image without decoding it.
 */
export function readPngDimensions(bytes: Buffer): { width: number; height: number } | null {
  // 8-byte magic, 4-byte length, 4-byte "IHDR", then width and height.
  if (bytes.byteLength < 24) return null;
  if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return null;

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0) return null;

  return { width, height };
}

/** The name an applicant typed, which stands in for a login they do not have. */
export function normaliseSignerName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, 120).toUpperCase();
}
