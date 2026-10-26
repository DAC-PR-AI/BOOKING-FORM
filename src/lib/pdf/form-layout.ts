/**
 * The geometry of the printed Booking Form, in one place.
 *
 * PLAN.md §4 took the highest-risk decision in this project: `@react-pdf/renderer`
 * is a **separate layout engine** from the browser, so the paper sheet has to be
 * authored twice — once in CSS for the screen, once in react-pdf primitives for
 * the PDF. The mitigation for that, stated when the decision was made, is this
 * module: both renderers read their proportions from here, so a change to the
 * sheet is one edit rather than two that can silently drift apart.
 *
 * It is also what keeps the documented fallback cheap. If the Phase 6 fidelity
 * pass against the photograph fails and DAC is on Vercel Pro by then, swapping
 * to the Chromium path is a renderer change, not a rewrite, because the numbers
 * live here and not inside a component tree.
 *
 * Units are PostScript points (1/72 inch), which is what react-pdf works in.
 * A4 is 595.28 × 841.89 pt.
 *
 * Pure and unit tested: a wrong box count or a signature slot mapped to the
 * wrong cell is a defect you only find by holding the print next to the paper,
 * which is far too late.
 */

export const A4 = { width: 595.28, height: 841.89 } as const;

/** The printed sheet has a generous margin; the corner banners sit inside it. */
export const PAGE_MARGIN = 28;

export const CONTENT_WIDTH = A4.width - PAGE_MARGIN * 2;

/** Type sizes, matched to the photograph by eye at 4× zoom. */
export const FONT = {
  title: 13,
  ribbon: 7.5,
  label: 7,
  value: 8,
  boxChar: 8,
  tiny: 5.5,
  terms: 6.4,
  termsHeading: 7,
} as const;

export const RULE = {
  /** The box borders printed around each section. */
  border: 0.75,
  /** The dotted/solid rule a written value sits on. */
  fill: 0.5,
} as const;

/** Grey of the section ribbons ("PERSONAL INFORMATION", "REMARKS (if any)"). */
export const COLOURS = {
  ink: '#111111',
  rule: '#555555',
  border: '#333333',
  ribbonFill: '#d9d9d9',
  boxBorder: '#444444',
  /** The brand corner banners. */
  bannerBlue: '#1b2a6b',
  bannerRed: '#e03a1e',
  placeholder: '#999999',
} as const;

/**
 * The boxed character inputs, as counted on the photograph at 20× zoom
 * (FIELD_MAP.md marks these `[IMG]` — they were verified, not assumed).
 */
export const BOX_COUNTS = {
  mobile: 10,
  altMobile: 10,
  aadhaar: 12,
  /** D.O.B is printed as four visual pairs: DD MM YYYY → 2 + 2 + 4. */
  dob: 8,
} as const;

/** D.O.B boxes are grouped with a wider gap after the 2nd and 4th. */
export const DOB_GROUPS = [2, 2, 4] as const;

export const CHAR_BOX = {
  width: 11,
  height: 12,
  gap: 1.2,
  /** Extra gap between D.O.B groups. */
  groupGap: 4,
} as const;

/** Total printed width of a run of character boxes. */
export function charBoxRunWidth(count: number, groups?: readonly number[]): number {
  if (count <= 0) return 0;

  const boxes = count * CHAR_BOX.width;
  const gaps = (count - 1) * CHAR_BOX.gap;
  const extra = groups ? (groups.length - 1) * CHAR_BOX.groupGap : 0;
  return boxes + gaps + extra;
}

/** Splits a run of boxes into its printed groups. `[12]` when ungrouped. */
export function boxGroups(count: number, groups?: readonly number[]): number[] {
  if (!groups) return [count];

  const total = groups.reduce((sum, n) => sum + n, 0);
  if (total !== count) {
    throw new Error(`Box groups ${groups.join('+')} do not add up to ${count}.`);
  }
  return [...groups];
}

/**
 * The DAC wordmark, top right.
 *
 * The width comes from the photograph: the printed logo spans roughly an
 * eighth of the form's content width. The height follows the supplied
 * artwork's own aspect ratio (640 × 280) rather than a guessed box, so it is
 * never letterboxed or stretched. If the artwork is replaced with a different
 * shape, change `aspectRatio` here and nothing else.
 */
export const LOGO = { width: 68, aspectRatio: 640 / 280 } as const;

export function logoHeight(): number {
  return LOGO.width / LOGO.aspectRatio;
}

/** The photo box printed to the left of each applicant block. */
export const PHOTO_BOX = { width: 78, height: 104 } as const;

/**
 * The signature grid across the foot of page 1.
 *
 * The paper prints **eight** cells in two rows of four, plus a separate
 * "Managing Director" rule above them. The configured pipeline has nine steps:
 * the **Sales Co-ordinator** is not on the printed form at all (OPEN_QUESTIONS
 * Q5), so its cell is appended rather than pretending the paper has room for
 * it. The printed order below is read off the photograph, left to right, and is
 * deliberately NOT the pipeline order — the paper groups by seniority, the flow
 * runs by sequence.
 */
export type SignatureCell = {
  /** Matches `flow_steps.pdf_signature_slot`. */
  slot: string;
  label: string;
  row: number;
  column: number;
  /** False for the Sales Co-ordinator, which the paper does not print. */
  onPaper: boolean;
};

export const SIGNATURE_GRID: SignatureCell[] = [
  { slot: 'applicant_1', label: '1ST Applicant', row: 0, column: 0, onPaper: true },
  { slot: 'agm', label: 'AGM', row: 0, column: 1, onPaper: true },
  { slot: 'vp_sales', label: 'VP Sales', row: 0, column: 2, onPaper: true },
  { slot: 'crm', label: 'CRM', row: 0, column: 3, onPaper: true },
  { slot: 'applicant_2', label: '2ND Applicant', row: 1, column: 0, onPaper: true },
  { slot: 'dgm_gm', label: 'DGM / GM', row: 1, column: 1, onPaper: true },
  { slot: 'mis', label: 'MIS', row: 1, column: 2, onPaper: true },
  { slot: 'director', label: 'Director', row: 1, column: 3, onPaper: true },
  // Appended: in the flow, not on the paper.
  { slot: 'sales_coordinator', label: 'Sales Co-ordinator', row: 2, column: 0, onPaper: false },
];

export const SIGNATURE_CELL = {
  labelWidth: 52,
  height: 32,
  columns: 4,
} as const;

/** Width of one signature cell, including its printed label. */
export function signatureCellWidth(): number {
  return CONTENT_WIDTH / SIGNATURE_CELL.columns;
}

/** The three signature labels across the foot of page 2. */
export const TERMS_SIGNATURES = [
  { slot: 'applicant_1', label: 'APPLICANT (1)' },
  { slot: 'applicant_2', label: 'APPLICANT (2)' },
  // Deliberately NOT in the flow (OPEN_QUESTIONS Q7) — a blank rule for a wet
  // signature after download, like the Managing Director line on page 1.
  { slot: null, label: 'AUTHORIZED SIGNATORY' },
] as const;

/** Printed above the page-2 signature row, on the right. */
export const TERMS_COMPANY_LINE = 'For DAC Developers Pvt Ltd,';

export const TERMS_ACCEPTANCE_LINE =
  'I hereby agreed and accepted the above-mentioned terms & condition of this provisional allotment.';

/**
 * The note printed sideways up the left margin of page 1.
 * Transcribed in OPEN_QUESTIONS Q21.
 */
export const VERTICAL_NOTE = '*Agreed terms mentioned in the booking form';

/** Number of blank rules printed in each address box. */
export const ADDRESS_LINES = 4;

// --- value formatting for print --------------------------------------------

/** `1990-05-14` → the eight D.O.B characters, or blanks. */
export function dobCharacters(iso: string | null): string[] {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return Array<string>(BOX_COUNTS.dob).fill('');

  const [year, month, day] = iso.split('-') as [string, string, string];
  return `${day}${month}${year}`.split('');
}

/** Spreads a value across a fixed run of boxes, padding with blanks. */
export function charactersFor(value: string | null, count: number): string[] {
  const characters = (value ?? '').replace(/\s/g, '').slice(0, count).split('');
  return [...characters, ...Array<string>(Math.max(0, count - characters.length)).fill('')];
}

/** The printed tick options, so screen and PDF cannot disagree on wording. */
export const TICKS = {
  propertyType: [
    { value: 'VILLA', label: 'Villa' },
    { value: 'PLOT', label: 'Plot' },
    { value: 'APARTMENT', label: 'Apartment No' },
  ],
  paymentMode: [
    { value: 'CHQ', label: 'Chq' },
    { value: 'CARD', label: 'Card' },
    { value: 'ONLINE', label: 'Online' },
  ],
  paymentSource: [
    { value: 'OWN_FUNDS', label: 'Own Funds' },
    { value: 'HOME_LOAN', label: 'Home Loan' },
  ],
} as const;

/** Printed under the Sale Price box. */
export const SALE_PRICE_NOTE = '(Excluding GST & Registration charges)';
