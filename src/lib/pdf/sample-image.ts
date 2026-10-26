import { deflateSync } from 'node:zlib';

/**
 * A valid PNG with visible ink, for fixtures and verification runs.
 *
 * The development scripts need images that are genuinely well formed — a
 * signature that the PDF renderer will embed, a photograph that fills the
 * photo box — and three of them had grown their own copy of this. One copy,
 * here, so a fix to the encoder is a fix everywhere.
 *
 * Deliberately not in `scripts/`: `src/` is what `tsconfig` paths resolve
 * against, and keeping it here means the scripts import it the same way the
 * application would. It is never imported by application code.
 */

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

/**
 * An 8-bit RGBA PNG carrying a hand-drawn-looking wave.
 *
 * Opaque ink on a transparent ground, like the signature pad produces, and
 * with enough entropy to clear the blank-pad size heuristic in
 * `@/lib/signature/png`.
 */
export function samplePng(width = 480, height = 140): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  const stride = 1 + width * 4;
  const raw = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const wave = Math.round((Math.sin(x / 26) * 0.35 + 0.5) * height);
      const inked = Math.abs(wave - y) < 3;
      const p = y * stride + 1 + x * 4;
      raw[p] = 17;
      raw[p + 1] = 24;
      raw[p + 2] = 39;
      raw[p + 3] = inked ? 255 : 0;
    }
  }

  return Buffer.concat([
    PNG_MAGIC,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The same image as a data URL, which is what the signing path accepts. */
export function samplePngDataUrl(width?: number, height?: number): string {
  return `data:image/png;base64,${samplePng(width, height).toString('base64')}`;
}
