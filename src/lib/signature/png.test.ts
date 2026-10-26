import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import {
  MAX_SIGNATURE_BYTES,
  MIN_SIGNATURE_BYTES,
  normaliseSignerName,
  parseSignatureDataUrl,
  readPngDimensions,
} from './png';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** A real, structurally valid PNG, padded to a chosen size. */
function png(width: number, height: number, padTo = 0): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  const parts = [PNG_MAGIC, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw))];

  if (padTo > 0) {
    const current = parts.reduce((n, p) => n + p.byteLength, 0);
    const needed = padTo - current - 12; // 12 = the IEND chunk
    if (needed > 0) parts.push(chunk('teXt', Buffer.alloc(needed, 0x41)));
  }

  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function dataUrl(bytes: Buffer): string {
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/** The rejection reason, asserting that it was in fact rejected. */
function reasonFor(value: string): string {
  const result = parseSignatureDataUrl(value);
  expect(result.ok).toBe(false);
  return result.ok ? 'UNEXPECTEDLY ACCEPTED' : result.reason;
}

describe('parseSignatureDataUrl — accepts a real signature', () => {
  it('returns the decoded bytes', () => {
    const bytes = png(600, 200, 4096);
    const result = parseSignatureDataUrl(dataUrl(bytes));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes.equals(bytes)).toBe(true);
    expect(result.sizeBytes).toBe(bytes.byteLength);
  });
});

describe('parseSignatureDataUrl — rejections', () => {
  it.each([
    ['not a data URL', 'https://example.com/signature.png'],
    ['empty', ''],
    ['bare base64', 'iVBORw0KGgo='],
  ])('rejects %s', (_name, value) => {
    expect(parseSignatureDataUrl(value)).toEqual({ ok: false, reason: 'not-a-data-url' });
  });

  it('rejects a JPEG data URL', () => {
    expect(parseSignatureDataUrl('data:image/jpeg;base64,/9j/4AAQ')).toEqual({
      ok: false,
      reason: 'wrong-type',
    });
  });

  it('rejects an SVG data URL, which could carry script', () => {
    expect(
      parseSignatureDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=').ok,
    ).toBe(false);
  });

  it('rejects characters that are not base64', () => {
    expect(reasonFor('data:image/png;base64,not valid!!')).toBe('not-base64');
  });

  it('rejects an empty payload', () => {
    expect(reasonFor('data:image/png;base64,')).toBe('not-base64');
  });

  it('does not believe the declared type over the magic number', () => {
    // Claims PNG, is actually a GIF. Would otherwise be stored and later
    // embedded in a legal PDF.
    const gif = Buffer.concat([
      Buffer.from('GIF89a', 'ascii'),
      Buffer.alloc(MIN_SIGNATURE_BYTES, 0x20),
    ]);
    expect(parseSignatureDataUrl(dataUrl(gif))).toEqual({ ok: false, reason: 'not-a-png' });
  });

  it('rejects a truncated file too short to hold a magic number', () => {
    expect(reasonFor(dataUrl(Buffer.from([0x89, 0x50])))).toBe('not-a-png');
  });

  it('rejects a blank-looking signature as too small', () => {
    const tiny = png(2, 2);
    expect(tiny.byteLength).toBeLessThan(MIN_SIGNATURE_BYTES);
    expect(parseSignatureDataUrl(dataUrl(tiny))).toEqual({ ok: false, reason: 'too-small' });
  });

  it('rejects an oversized signature', () => {
    const huge = png(600, 200, MAX_SIGNATURE_BYTES + 2048);
    expect(parseSignatureDataUrl(dataUrl(huge))).toEqual({ ok: false, reason: 'too-large' });
  });

  it('rejects an enormous payload without decoding it', () => {
    const absurd = `data:image/png;base64,${'A'.repeat(MAX_SIGNATURE_BYTES * 3)}`;
    expect(parseSignatureDataUrl(absurd)).toEqual({ ok: false, reason: 'too-large' });
  });
});

describe('readPngDimensions', () => {
  it('reads the IHDR dimensions', () => {
    expect(readPngDimensions(png(600, 200, 4096))).toEqual({ width: 600, height: 200 });
  });

  it('returns null when IHDR is not where the spec puts it', () => {
    const bytes = png(600, 200, 4096);
    bytes.write('XHDR', 12, 'ascii');
    expect(readPngDimensions(bytes)).toBeNull();
  });

  it('returns null for something too short to have a header', () => {
    expect(readPngDimensions(Buffer.alloc(10))).toBeNull();
  });

  it('returns null for zero dimensions', () => {
    expect(readPngDimensions(png(0, 0))).toBeNull();
  });
});

describe('normaliseSignerName', () => {
  it('upper-cases, as the paper form requires', () => {
    expect(normaliseSignerName('Ravi Kumar')).toBe('RAVI KUMAR');
  });

  it('collapses whitespace', () => {
    expect(normaliseSignerName('  Ravi   Kumar  ')).toBe('RAVI KUMAR');
  });

  it('caps the length', () => {
    expect(normaliseSignerName('A'.repeat(200))).toHaveLength(120);
  });

  it('returns empty for blank input, so the caller must reject it', () => {
    expect(normaliseSignerName('   ')).toBe('');
  });
});
