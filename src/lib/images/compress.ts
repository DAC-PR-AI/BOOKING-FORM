/**
 * Client-side image downscaling, before upload.
 *
 * The people filling this form are on phones, in flats, photographing an
 * Aadhaar card. A modern phone camera produces 4–8 MB per shot, which is
 * slow on a site connection and well over what the document is worth: the
 * card only has to be legible.
 *
 * Shrinking in the browser rather than on the server is the point — the bytes
 * that never leave the phone cost nothing to upload and nothing to store.
 *
 * Deliberately conservative:
 *   * PDFs are passed through untouched. Re-encoding a scanned PDF client side
 *     would need a PDF library and would risk losing pages.
 *   * If anything fails — an unsupported codec, a tainted canvas, no decoder
 *     for HEIC — the original file is returned. A slightly slow upload is a
 *     far better outcome than a lost document.
 *   * The result is only used when it is actually smaller.
 */

export type CompressOptions = {
  /** Longest edge, in CSS pixels. 1600 keeps printed text readable. */
  maxDimension?: number;
  /** JPEG quality, 0–1. */
  quality?: number;
};

export type CompressResult = {
  file: File;
  /** False when the original was returned unchanged. */
  compressed: boolean;
  originalBytes: number;
};

const DEFAULTS = { maxDimension: 1600, quality: 0.82 } as const;

/** Types we are willing to re-encode. */
const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

function scaledSize(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } | null {
  const longest = Math.max(width, height);
  if (longest <= maxDimension) return null;
  const ratio = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<CompressResult> {
  const maxDimension = options.maxDimension ?? DEFAULTS.maxDimension;
  const quality = options.quality ?? DEFAULTS.quality;
  const unchanged: CompressResult = { file, compressed: false, originalBytes: file.size };

  if (!COMPRESSIBLE.has(file.type)) return unchanged;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return unchanged;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return unchanged;
  }

  try {
    const target = scaledSize(bitmap.width, bitmap.height, maxDimension);

    // Already small enough, and a PNG screenshot of a payment receipt is often
    // smaller as a PNG than as a JPEG. Leave it alone.
    if (!target && file.type !== 'image/png') return unchanged;

    const width = target?.width ?? bitmap.width;
    const height = target?.height ?? bitmap.height;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) return unchanged;

    // A JPEG has no alpha channel; without this, transparent PNG regions turn
    // black, which on a screenshot can hide the figures entirely.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, quality);
    if (!blob || blob.size === 0 || blob.size >= file.size) return unchanged;

    const renamed = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return {
      file: new File([blob], `${renamed}.jpg`, {
        type: 'image/jpeg',
        lastModified: file.lastModified,
      }),
      compressed: true,
      originalBytes: file.size,
    };
  } catch {
    return unchanged;
  } finally {
    bitmap.close();
  }
}

/** Hex SHA-256, so the server can record what it was given. */
export async function sha256Hex(file: File): Promise<string | undefined> {
  // Only available over HTTPS and on localhost; absent is not an error.
  if (typeof crypto === 'undefined' || !crypto.subtle) return undefined;
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return undefined;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
