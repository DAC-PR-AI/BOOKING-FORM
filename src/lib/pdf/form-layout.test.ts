import { describe, expect, it } from 'vitest';
import {
  A4,
  BOX_COUNTS,
  CHAR_BOX,
  CONTENT_WIDTH,
  DOB_GROUPS,
  PAGE_MARGIN,
  SIGNATURE_CELL,
  SIGNATURE_GRID,
  TERMS_SIGNATURES,
  boxGroups,
  charBoxRunWidth,
  charactersFor,
  dobCharacters,
  signatureCellWidth,
} from './form-layout';

describe('page geometry', () => {
  it('is A4 in points', () => {
    expect(A4.width).toBeCloseTo(595.28, 2);
    expect(A4.height).toBeCloseTo(841.89, 2);
  });

  it('leaves content width consistent with the margins', () => {
    expect(CONTENT_WIDTH).toBeCloseTo(A4.width - PAGE_MARGIN * 2, 5);
  });

  it('keeps the content inside the page', () => {
    expect(CONTENT_WIDTH).toBeGreaterThan(0);
    expect(CONTENT_WIDTH).toBeLessThan(A4.width);
  });
});

describe('box counts match the photograph', () => {
  it('matches what FIELD_MAP verified at 20× zoom', () => {
    expect(BOX_COUNTS.mobile).toBe(10);
    expect(BOX_COUNTS.altMobile).toBe(10);
    expect(BOX_COUNTS.aadhaar).toBe(12);
    expect(BOX_COUNTS.dob).toBe(8);
  });

  it('prints D.O.B as DD MM YYYY', () => {
    expect([...DOB_GROUPS]).toEqual([2, 2, 4]);
    expect(DOB_GROUPS.reduce((a, b) => a + b, 0)).toBe(BOX_COUNTS.dob);
  });
});

describe('charBoxRunWidth', () => {
  it('is zero for no boxes', () => {
    expect(charBoxRunWidth(0)).toBe(0);
  });

  it('is one box wide for a single box, with no gap', () => {
    expect(charBoxRunWidth(1)).toBe(CHAR_BOX.width);
  });

  it('adds a gap between boxes but not after the last', () => {
    expect(charBoxRunWidth(3)).toBeCloseTo(CHAR_BOX.width * 3 + CHAR_BOX.gap * 2, 5);
  });

  it('adds the wider gap between D.O.B groups', () => {
    const ungrouped = charBoxRunWidth(8);
    const grouped = charBoxRunWidth(8, DOB_GROUPS);
    expect(grouped).toBeCloseTo(ungrouped + CHAR_BOX.groupGap * 2, 5);
  });

  it('keeps the widest run inside the content width', () => {
    // Aadhaar is the longest run; two of them plus labels share a row.
    expect(charBoxRunWidth(BOX_COUNTS.aadhaar)).toBeLessThan(CONTENT_WIDTH / 2);
  });
});

describe('boxGroups', () => {
  it('returns one group when ungrouped', () => {
    expect(boxGroups(12)).toEqual([12]);
  });

  it('returns the printed groups', () => {
    expect(boxGroups(8, DOB_GROUPS)).toEqual([2, 2, 4]);
  });

  it('refuses groups that do not add up, rather than printing a wrong row', () => {
    expect(() => boxGroups(8, [2, 2, 3])).toThrow();
  });
});

describe('the signature grid', () => {
  it('prints eight cells, as the paper does', () => {
    expect(SIGNATURE_GRID.filter((c) => c.onPaper)).toHaveLength(8);
  });

  it('covers all nine pipeline steps', () => {
    expect(SIGNATURE_GRID).toHaveLength(9);
  });

  it('appends the Sales Co-ordinator, which the paper does not print', () => {
    const coordinator = SIGNATURE_GRID.find((c) => c.slot === 'sales_coordinator');
    expect(coordinator?.onPaper).toBe(false);
    expect(coordinator?.row).toBe(2);
  });

  it('matches the slots the seed configures', () => {
    const slots = SIGNATURE_GRID.map((c) => c.slot).sort();
    expect(slots).toEqual(
      [
        'agm',
        'applicant_1',
        'applicant_2',
        'crm',
        'director',
        'dgm_gm',
        'mis',
        'sales_coordinator',
        'vp_sales',
      ].sort(),
    );
  });

  it('has no duplicate slots', () => {
    const slots = SIGNATURE_GRID.map((c) => c.slot);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('places the printed cells in the order read off the photograph', () => {
    const printed = SIGNATURE_GRID.filter((c) => c.onPaper)
      .slice()
      .sort((a, b) => a.row - b.row || a.column - b.column)
      .map((c) => c.slot);

    expect(printed).toEqual([
      'applicant_1',
      'agm',
      'vp_sales',
      'crm',
      'applicant_2',
      'dgm_gm',
      'mis',
      'director',
    ]);
  });

  it('occupies no cell twice', () => {
    const printed = SIGNATURE_GRID.filter((c) => c.onPaper);
    const cells = printed.map((c) => `${c.row}:${c.column}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('stays within four columns', () => {
    for (const cell of SIGNATURE_GRID) {
      expect(cell.column).toBeLessThan(SIGNATURE_CELL.columns);
    }
  });

  it('divides the content width evenly', () => {
    expect(signatureCellWidth() * SIGNATURE_CELL.columns).toBeCloseTo(CONTENT_WIDTH, 5);
  });
});

describe('the page-2 signatures', () => {
  it('prints three labels', () => {
    expect(TERMS_SIGNATURES).toHaveLength(3);
  });

  it('reuses the two applicant signatures', () => {
    expect(TERMS_SIGNATURES[0]?.slot).toBe('applicant_1');
    expect(TERMS_SIGNATURES[1]?.slot).toBe('applicant_2');
  });

  it('leaves the Authorized Signatory unmapped, for a wet signature', () => {
    // OPEN_QUESTIONS Q7: deliberately not in the digital flow.
    expect(TERMS_SIGNATURES[2]?.slot).toBeNull();
    expect(TERMS_SIGNATURES[2]?.label).toBe('AUTHORIZED SIGNATORY');
  });
});

describe('dobCharacters', () => {
  it('prints DDMMYYYY, which is what the box labels say', () => {
    expect(dobCharacters('1990-05-14')).toEqual(['1', '4', '0', '5', '1', '9', '9', '0']);
  });

  it('is blank when there is no date', () => {
    expect(dobCharacters(null)).toEqual(['', '', '', '', '', '', '', '']);
  });

  it('is blank rather than wrong for a malformed date', () => {
    expect(dobCharacters('14/05/1990')).toEqual(['', '', '', '', '', '', '', '']);
    expect(dobCharacters('')).toEqual(['', '', '', '', '', '', '', '']);
  });

  it('always returns exactly eight characters', () => {
    expect(dobCharacters('2001-01-01')).toHaveLength(BOX_COUNTS.dob);
    expect(dobCharacters(null)).toHaveLength(BOX_COUNTS.dob);
  });
});

describe('charactersFor', () => {
  it('spreads a value one character per box', () => {
    expect(charactersFor('9876543210', 10)).toEqual(
      ['9', '8', '7', '6', '5', '4', '3', '2', '1', '0'],
    );
  });

  it('pads a short value with blanks', () => {
    expect(charactersFor('987', 5)).toEqual(['9', '8', '7', '', '']);
  });

  it('never overflows the printed boxes', () => {
    expect(charactersFor('123456789012345', 12)).toHaveLength(12);
  });

  it('ignores spacing in a stored value', () => {
    expect(charactersFor('2345 6789 0123', 12)).toEqual(
      ['2', '3', '4', '5', '6', '7', '8', '9', '0', '1', '2', '3'],
    );
  });

  it('is all blanks for a missing value', () => {
    expect(charactersFor(null, 4)).toEqual(['', '', '', '']);
  });
});
