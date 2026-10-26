import { inflateSync } from 'node:zlib';

/**
 * Pulls the visible text out of a generated PDF, for the fidelity check.
 *
 * The Phase 6 gate is "hold the print against the photograph", which is a
 * human judgement. This is the part a machine can make repeatable: that every
 * label printed on the paper form actually reached the page, in the order the
 * paper prints them. A missing ribbon or a dropped field is then a failing
 * check rather than something noticed months later by someone comparing a
 * printout to a scan.
 *
 * Deliberately a small reader rather than a PDF library. It only has to cope
 * with what `@react-pdf/renderer` emits — Flate-compressed content streams and
 * the standard-14 Helvetica with WinAnsi encoding, so the strings sit in the
 * stream as readable literals. Sticking to Helvetica instead of embedding a
 * subset font is partly what keeps this possible.
 *
 * It is not a general PDF parser and is not meant to become one.
 */

/** Undoes the escapes PDF literal strings use. */
function decodeLiteral(raw: string): string {
  return raw
    .replace(/\\([nrtbf()\\])/g, (_match, char: string) => {
      switch (char) {
        case 'n':
          return '\n';
        case 'r':
          return '\r';
        case 't':
          return '\t';
        case 'b':
          return '\b';
        case 'f':
          return '\f';
        default:
          return char;
      }
    })
    .replace(/\\([0-7]{1,3})/g, (_match, octal: string) =>
      String.fromCharCode(Number.parseInt(octal, 8)),
    );
}

function decodeHex(raw: string): string {
  const hex = raw.replace(/\s+/g, '');
  let out = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

/** Every Flate stream in the file, inflated. Streams that are not text are skipped. */
function contentStreams(pdf: Buffer): string[] {
  const out: string[] = [];
  const haystack = pdf.toString('latin1');
  const marker = /stream\r?\n/g;

  let match: RegExpExecArray | null;
  while ((match = marker.exec(haystack)) !== null) {
    const start = match.index + match[0].length;
    const end = haystack.indexOf('endstream', start);
    if (end === -1) continue;

    const slice = pdf.subarray(start, end);
    try {
      out.push(inflateSync(slice).toString('latin1'));
    } catch {
      // Not Flate, or an image stream. Either way, no text to read.
    }
  }

  return out;
}

/**
 * The text-showing operands of a content stream, in the order they appear.
 * `Tj` shows one string; `TJ` shows an array of strings and kerning numbers.
 */
function showOperands(stream: string): string[] {
  const out: string[] = [];
  const pattern = /(?:\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>)\s*(?:Tj|TJ)|\[(?:[^\][]|\\.)*\]\s*TJ/g;

  for (const match of stream.match(pattern) ?? []) {
    const pieces = match.match(/\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>/g) ?? [];
    const text = pieces
      .map((piece) =>
        piece.startsWith('<')
          ? decodeHex(piece.slice(1, -1))
          : decodeLiteral(piece.slice(1, -1)),
      )
      .join('');
    if (text.length > 0) out.push(text);
  }

  return out;
}

/** Every string drawn in the document, in page then draw order. */
export function extractTextRuns(pdf: Buffer): string[] {
  return contentStreams(pdf).flatMap(showOperands);
}

/** The whole document as one normalised string, for substring checks. */
export function extractText(pdf: Buffer): string {
  return extractTextRuns(pdf).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Strips all whitespace, for comparing a label against extracted text.
 *
 * The renderer splits a line into several show operations wherever it adjusts
 * kerning, so "1ST Applicant" can reach the stream as "1" then "ST Applicant".
 * Joining runs with a space then makes a plain substring test fail on a label
 * that is on the page and perfectly legible. Removing whitespace from both
 * sides compares the glyphs that were actually drawn, which is the thing the
 * check is about.
 */
export function normaliseForMatch(value: string): string {
  return value.replace(/\s+/g, '');
}

/** Whether a printed label reached the page, ignoring how it was split up. */
export function containsLabel(text: string, label: string): boolean {
  return normaliseForMatch(text).includes(normaliseForMatch(label));
}

/**
 * Whether the given labels appear in this order (not necessarily adjacently).
 * Catches a section rendered in the wrong place, which a presence check alone
 * would miss.
 */
export function appearInOrder(text: string, labels: string[]): { ok: true } | {
  ok: false;
  failedAt: string;
} {
  const haystack = normaliseForMatch(text);
  let cursor = 0;

  for (const label of labels) {
    const needle = normaliseForMatch(label);
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) return { ok: false, failedAt: label };
    cursor = index + needle.length;
  }

  return { ok: true };
}
