/**
 * A deliberately tiny Markdown reader for the Terms & Conditions.
 *
 * `content/terms/v1.md` uses four constructs and no more: a `#` title, `##`
 * section headings, paragraphs, and `**bold**` runs. A Markdown library would
 * be a dependency, a bundle cost and an HTML-injection surface for the one
 * document in this system that must render exactly as written — so this parses
 * the subset instead and emits data, never HTML.
 *
 * Nothing here produces markup, so there is no `dangerouslySetInnerHTML`
 * anywhere near the legal text. Anything the parser does not recognise is
 * rendered as literal text rather than dropped: losing a clause silently from
 * a contract would be the worst possible failure mode.
 *
 * Pure and unit tested for that reason.
 */

export type TermsSpan = { text: string; bold: boolean };

export type TermsBlock =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'quote'; spans: TermsSpan[] }
  | { kind: 'paragraph'; spans: TermsSpan[] };

/** Splits `a **b** c` into spans. Unmatched `**` stays literal. */
export function parseSpans(line: string): TermsSpan[] {
  const spans: TermsSpan[] = [];
  let rest = line;

  while (rest.length > 0) {
    const open = rest.indexOf('**');
    if (open === -1) {
      spans.push({ text: rest, bold: false });
      break;
    }

    const close = rest.indexOf('**', open + 2);
    if (close === -1) {
      // No closing marker — the asterisks are part of the text, not markup.
      spans.push({ text: rest, bold: false });
      break;
    }

    if (open > 0) spans.push({ text: rest.slice(0, open), bold: false });

    const bold = rest.slice(open + 2, close);
    if (bold.length > 0) spans.push({ text: bold, bold: true });

    rest = rest.slice(close + 2);
  }

  return spans.filter((span) => span.text.length > 0);
}

/**
 * Hard-wrapped source lines are joined with a space, because the wrapping in
 * the file is an artefact of an 80-column editor, not of the printed form.
 */
function joinLines(lines: string[]): string {
  return lines.map((line) => line.trim()).join(' ').replace(/\s+/g, ' ').trim();
}

export function parseTerms(markdown: string): TermsBlock[] {
  const blocks: TermsBlock[] = [];
  const paragraphs = markdown.replace(/\r\n/g, '\n').split(/\n\s*\n/);

  for (const chunk of paragraphs) {
    const lines = chunk.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;

    const joined = lines.join('\n').trim();

    // A horizontal rule is a separator in the source, not content.
    if (/^-{3,}$/.test(joined)) continue;

    // An HTML comment is an editorial note. It has no business rendering as
    // visible text, least of all on the face of a signed document.
    if (joined.startsWith('<!--')) continue;

    const first = lines[0] as string;

    if (/^#\s+/.test(first)) {
      blocks.push({ kind: 'title', text: first.replace(/^#\s+/, '').trim() });
      // A heading line never has body text after it on the same block, but if
      // the file ever grows one, keep it rather than discard it.
      const remainder = joinLines(lines.slice(1));
      if (remainder) blocks.push({ kind: 'paragraph', spans: parseSpans(remainder) });
      continue;
    }

    if (/^##\s+/.test(first)) {
      blocks.push({ kind: 'heading', text: first.replace(/^##\s+/, '').trim() });
      const remainder = joinLines(lines.slice(1));
      if (remainder) blocks.push({ kind: 'paragraph', spans: parseSpans(remainder) });
      continue;
    }

    if (lines.every((line) => line.trim().startsWith('>'))) {
      const text = joinLines(lines.map((line) => line.trim().replace(/^>\s?/, '')));
      blocks.push({ kind: 'quote', spans: parseSpans(text) });
      continue;
    }

    blocks.push({ kind: 'paragraph', spans: parseSpans(joinLines(lines)) });
  }

  return blocks;
}

/** Word count, for the "about N words" line above a long document. */
export function wordCount(markdown: string): number {
  const words = markdown.replace(/[#>*]/g, ' ').trim().split(/\s+/);
  return words[0] === '' ? 0 : words.length;
}
