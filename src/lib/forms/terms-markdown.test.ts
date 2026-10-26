import { describe, expect, it } from 'vitest';
import { parseSpans, parseTerms, wordCount } from './terms-markdown';

describe('parseSpans', () => {
  it('returns one plain span for plain text', () => {
    expect(parseSpans('The price payable for the unit')).toEqual([
      { text: 'The price payable for the unit', bold: false },
    ]);
  });

  it('splits a bold run out of its surroundings', () => {
    expect(parseSpans('pay **within 10 days** of booking')).toEqual([
      { text: 'pay ', bold: false },
      { text: 'within 10 days', bold: true },
      { text: ' of booking', bold: false },
    ]);
  });

  it('handles several bold runs', () => {
    expect(parseSpans('**A** and **B**')).toEqual([
      { text: 'A', bold: true },
      { text: ' and ', bold: false },
      { text: 'B', bold: true },
    ]);
  });

  it('handles bold at the very start and end', () => {
    expect(parseSpans('**Note:** see overleaf')).toEqual([
      { text: 'Note:', bold: true },
      { text: ' see overleaf', bold: false },
    ]);
  });

  it('keeps an unmatched marker as literal text, never swallowing a clause', () => {
    expect(parseSpans('5% **cancellation charges')).toEqual([
      { text: '5% **cancellation charges', bold: false },
    ]);
  });

  it('drops an empty bold run rather than emitting a blank span', () => {
    expect(parseSpans('a ****b')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: false },
    ]);
  });

  it('returns nothing for an empty line', () => {
    expect(parseSpans('')).toEqual([]);
  });
});

describe('parseTerms', () => {
  it('reads the title', () => {
    const blocks = parseTerms('# TERMS & CONDITIONS FOR PROVISIONAL ALLOTMENT');
    expect(blocks).toEqual([
      { kind: 'title', text: 'TERMS & CONDITIONS FOR PROVISIONAL ALLOTMENT' },
    ]);
  });

  it('reads a section heading without mistaking it for the title', () => {
    const blocks = parseTerms('## General Instructions:');
    expect(blocks).toEqual([{ kind: 'heading', text: 'General Instructions:' }]);
  });

  it('joins hard-wrapped lines into one paragraph', () => {
    const blocks = parseTerms(
      'The price payable for the unit as mentioned\noverleaf is including the security deposit.',
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      spans: [
        {
          text: 'The price payable for the unit as mentioned overleaf is including the security deposit.',
          bold: false,
        },
      ],
    });
  });

  it('keeps blank-line-separated paragraphs apart', () => {
    const blocks = parseTerms('First clause.\n\nSecond clause.');
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.kind === 'paragraph')).toBe(true);
  });

  it('reads the document in order', () => {
    const blocks = parseTerms(
      ['# TITLE', '', '## One:', '', 'Body of one.', '', '## Two:', '', 'Body of two.'].join('\n'),
    );
    expect(blocks.map((b) => b.kind)).toEqual([
      'title',
      'heading',
      'paragraph',
      'heading',
      'paragraph',
    ]);
  });

  it('reads a blockquote as a quote, not a paragraph', () => {
    const blocks = parseTerms('> **Note.** Internal only.\n> Second line.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('quote');
  });

  it('does not treat a paragraph containing > as a quote', () => {
    const blocks = parseTerms('Payment > 50% of cost.');
    expect(blocks[0]?.kind).toBe('paragraph');
  });

  it('normalises Windows line endings', () => {
    const blocks = parseTerms('# TITLE\r\n\r\n## Section:\r\n\r\nBody.');
    expect(blocks.map((b) => b.kind)).toEqual(['title', 'heading', 'paragraph']);
  });

  it('collapses runs of blank lines', () => {
    const blocks = parseTerms('First.\n\n\n\nSecond.');
    expect(blocks).toHaveLength(2);
  });

  it('drops a horizontal rule, which is a separator and not content', () => {
    const blocks = parseTerms(['First clause.', '', '---', '', 'Second clause.'].join('\n'));
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.kind === 'paragraph')).toBe(true);
  });

  it.each(['---', '----', '-----'])('drops a rule written as %s', (rule) => {
    expect(parseTerms(['A.', '', rule, '', 'B.'].join('\n'))).toHaveLength(2);
  });

  it('drops an HTML comment rather than printing it on a legal page', () => {
    const blocks = parseTerms(
      [
        'A clause.',
        '',
        '<!-- Signature slots are rendered by the app,',
        '     not stored here -->',
        '',
        'Another clause.',
      ].join('\n'),
    );
    expect(blocks).toHaveLength(2);
    expect(JSON.stringify(blocks)).not.toContain('Signature slots');
  });

  it('keeps a dash that is part of a sentence', () => {
    const blocks = parseTerms('Pay within 10 days - no exceptions.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('paragraph');
  });

  it('returns nothing for empty input', () => {
    expect(parseTerms('')).toEqual([]);
    expect(parseTerms('   \n\n  ')).toEqual([]);
  });

  it('keeps body text that follows a heading on the next line', () => {
    const blocks = parseTerms('## Section:\nImmediately following text.');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph']);
  });

  it('loses no words from a multi-section document', () => {
    const source = [
      '# TITLE',
      '',
      '## One:',
      '',
      'Alpha beta gamma.',
      '',
      '## Two:',
      '',
      'Delta **epsilon** zeta.',
    ].join('\n');

    const rendered = parseTerms(source)
      .map((block) =>
        block.kind === 'title' || block.kind === 'heading'
          ? block.text
          : block.spans.map((s) => s.text).join(''),
      )
      .join(' ');

    for (const word of ['TITLE', 'One:', 'Alpha', 'gamma.', 'Two:', 'epsilon', 'zeta.']) {
      expect(rendered).toContain(word);
    }
  });
});

describe('wordCount', () => {
  it('counts words, ignoring markup', () => {
    expect(wordCount('## Heading:\n\n**Bold** word here.')).toBe(4);
  });

  it('is zero for empty input', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('   ')).toBe(0);
  });
});
