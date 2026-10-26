/**
 * Reading the project master list out of a Google Sheet.
 *
 * PLAN.md §2A reverses the direction the brief set — the app normally never
 * reads business data back from Sheets — and sets the rules this parser has to
 * honour. The two that matter most:
 *
 *   * **Upsert by a stable code, never by name.** If the sync keys on the name
 *     and somebody fixes a typo in the sheet, a keyed-by-name sync silently
 *     creates a *duplicate* project and splits the reporting. Keyed on a code,
 *     the same edit is a rename.
 *   * **A project that vanishes from the sheet is deactivated, never deleted.**
 *     Bookings from six months ago must still resolve their project name.
 *
 * A real sheet is maintained by people: columns get reordered, a header gets
 * renamed, somebody leaves a blank row in the middle or pads a name with
 * spaces. So the parser finds its columns by header text rather than position,
 * and reports what it could not use instead of throwing the whole sync away.
 *
 * Pure and unit tested: a silently mis-parsed sheet would quietly corrupt the
 * project list that every booking references.
 */

export type SheetProject = {
  /** The stable key. Upserts match on this. */
  externalCode: string;
  name: string;
  location: string | null;
  /** False when the sheet marks the row inactive. */
  isActive: boolean;
  /** 1-based row number in the sheet, for error messages. */
  sourceRow: number;
};

export type SheetProblem = {
  sourceRow: number;
  reason: string;
};

export type ParsedSheet = {
  projects: SheetProject[];
  problems: SheetProblem[];
  /** Which header each column was found under, for the admin screen. */
  columns: { code: string | null; name: string | null; location: string | null; active: string | null };
};

/** Header spellings we accept, lower-cased and stripped of punctuation. */
const HEADERS = {
  code: ['code', 'projectcode', 'project code', 'id', 'projectid', 'short code', 'shortcode'],
  name: ['name', 'project', 'projectname', 'project name', 'title'],
  location: ['location', 'city', 'area', 'place', 'address'],
  active: ['active', 'isactive', 'is active', 'status', 'live'],
} as const;

function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z ]/g, '');
}

function findColumn(headers: string[], candidates: readonly string[]): number {
  const normalised = headers.map(normaliseHeader);

  // Exact match first, so a sheet with both "Project" and "Project Code"
  // does not match the wrong one.
  for (const candidate of candidates) {
    const index = normalised.indexOf(normaliseHeader(candidate));
    if (index !== -1) return index;
  }
  return -1;
}

/**
 * Whether a row's status cell means "do not offer this any more".
 *
 * Deliberately generous about what counts as active, and strict about what
 * counts as inactive: a sheet full of ticks, "Yes", "TRUE" and blanks should
 * not silently hide half the project list because of an unrecognised word.
 */
export function isActiveCell(value: string | undefined): boolean {
  if (value === undefined) return true;

  const text = value.trim().toLowerCase();
  if (text === '') return true;

  return !['no', 'n', 'false', '0', 'inactive', 'closed', 'archived', 'sold out', 'soldout'].includes(
    text,
  );
}

/**
 * Derives a code for a sheet that has no code column.
 *
 * PLAN.md §2A rule 3: if the sheet turns out to have no code column, generate
 * one on first sight and warn the admin that later renames will need a manual
 * merge — because a derived code changes when the name does, which is exactly
 * the duplicate-on-typo problem the rule exists to prevent. This is the
 * fallback, not the design.
 */
export function deriveCode(name: string): string {
  return (
    name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'UNNAMED'
  );
}

export function parseProjectSheet(rows: string[][]): ParsedSheet {
  const problems: SheetProblem[] = [];
  const empty: ParsedSheet['columns'] = { code: null, name: null, location: null, active: null };

  const headerIndex = rows.findIndex((row) => row.some((cell) => cell.trim() !== ''));
  if (headerIndex === -1) {
    return {
      projects: [],
      problems: [{ sourceRow: 1, reason: 'The sheet is empty.' }],
      columns: empty,
    };
  }

  const headers = rows[headerIndex] as string[];
  const nameColumn = findColumn(headers, HEADERS.name);
  if (nameColumn === -1) {
    return {
      projects: [],
      problems: [
        {
          sourceRow: headerIndex + 1,
          reason:
            'No project name column. Expected a header called "Name" or "Project Name". ' +
            `Found: ${headers.filter((h) => h.trim()).join(', ') || '(no headers)'}.`,
        },
      ],
      columns: empty,
    };
  }

  const codeColumn = findColumn(headers, HEADERS.code);
  const locationColumn = findColumn(headers, HEADERS.location);
  const activeColumn = findColumn(headers, HEADERS.active);

  const columns: ParsedSheet['columns'] = {
    code: codeColumn === -1 ? null : (headers[codeColumn] ?? null),
    name: headers[nameColumn] ?? null,
    location: locationColumn === -1 ? null : (headers[locationColumn] ?? null),
    active: activeColumn === -1 ? null : (headers[activeColumn] ?? null),
  };

  const projects: SheetProject[] = [];
  const seen = new Map<string, number>();

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const sourceRow = i + 1;

    // A blank row in the middle of a sheet is normal; it is not a problem.
    if (row.every((cell) => (cell ?? '').trim() === '')) continue;

    const name = (row[nameColumn] ?? '').trim();
    if (name === '') {
      problems.push({ sourceRow, reason: 'Row has no project name, so it was skipped.' });
      continue;
    }

    const rawCode = codeColumn === -1 ? '' : (row[codeColumn] ?? '').trim();
    const externalCode = (rawCode || deriveCode(name)).toUpperCase();

    const firstSeen = seen.get(externalCode);
    if (firstSeen !== undefined) {
      problems.push({
        sourceRow,
        reason: `Code "${externalCode}" is already used on row ${firstSeen}, so this row was skipped.`,
      });
      continue;
    }
    seen.set(externalCode, sourceRow);

    const location = locationColumn === -1 ? '' : (row[locationColumn] ?? '').trim();

    projects.push({
      externalCode,
      name,
      location: location === '' ? null : location,
      isActive: isActiveCell(activeColumn === -1 ? undefined : row[activeColumn]),
      sourceRow,
    });
  }

  return { projects, problems, columns };
}

export type SyncPlan = {
  created: SheetProject[];
  updated: SheetProject[];
  unchanged: SheetProject[];
  /** In the database, absent from the sheet — deactivated, never deleted. */
  deactivated: Array<{ externalCode: string; name: string }>;
};

export type ExistingProject = {
  externalCode: string | null;
  name: string;
  location: string | null;
  isActive: boolean;
};

/**
 * What a sync would do, without doing it.
 *
 * Split out so the admin screen can show the effect before anyone commits to
 * it, and so the deactivation rule is assertable: a project the sheet no
 * longer lists must come back as `deactivated`, never as a deletion.
 *
 * Projects added by hand have no `external_code` and are left strictly alone —
 * the sheet does not know about them, so the sheet does not get to retire
 * them.
 */
export function planSync(sheet: SheetProject[], existing: ExistingProject[]): SyncPlan {
  const byCode = new Map(
    existing.filter((p) => p.externalCode !== null).map((p) => [p.externalCode as string, p]),
  );

  const created: SheetProject[] = [];
  const updated: SheetProject[] = [];
  const unchanged: SheetProject[] = [];

  for (const project of sheet) {
    const current = byCode.get(project.externalCode);

    if (!current) {
      created.push(project);
      continue;
    }

    const differs =
      current.name !== project.name ||
      current.location !== project.location ||
      current.isActive !== project.isActive;

    (differs ? updated : unchanged).push(project);
  }

  const inSheet = new Set(sheet.map((p) => p.externalCode));
  const deactivated = existing
    .filter((p) => p.externalCode !== null && p.isActive && !inSheet.has(p.externalCode))
    .map((p) => ({ externalCode: p.externalCode as string, name: p.name }));

  return { created, updated, unchanged, deactivated };
}
