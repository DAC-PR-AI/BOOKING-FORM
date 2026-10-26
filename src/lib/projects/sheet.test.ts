import { describe, expect, it } from 'vitest';
import {
  deriveCode,
  isActiveCell,
  parseProjectSheet,
  planSync,
  type ExistingProject,
  type SheetProject,
} from './sheet';

const HEADERS = ['Project Code', 'Project Name', 'Location', 'Active'];

function sheet(...rows: string[][]): string[][] {
  return [HEADERS, ...rows];
}

describe('parseProjectSheet — the ordinary case', () => {
  it('reads the rows', () => {
    const { projects, problems } = parseProjectSheet(
      sheet(['ARIYA', 'DAC Ariya Phase II', 'Chennai', 'Yes']),
    );

    expect(problems).toEqual([]);
    expect(projects).toEqual([
      {
        externalCode: 'ARIYA',
        name: 'DAC Ariya Phase II',
        location: 'Chennai',
        isActive: true,
        sourceRow: 2,
      },
    ]);
  });

  it('finds columns by header, not by position', () => {
    const reordered = [
      ['Location', 'Active', 'Project Name', 'Project Code'],
      ['Chennai', 'Yes', 'DAC Ariya', 'ARIYA'],
    ];
    const { projects } = parseProjectSheet(reordered);
    expect(projects[0]).toMatchObject({ externalCode: 'ARIYA', name: 'DAC Ariya', location: 'Chennai' });
  });

  it('accepts alternative header spellings', () => {
    const { projects } = parseProjectSheet([
      ['code', 'name', 'city'],
      ['A1', 'Alpha', 'Madurai'],
    ]);
    expect(projects[0]).toMatchObject({ externalCode: 'A1', name: 'Alpha', location: 'Madurai' });
  });

  it('does not confuse "Project" with "Project Code"', () => {
    const { projects } = parseProjectSheet([
      ['Project', 'Project Code'],
      ['Alpha', 'A1'],
    ]);
    expect(projects[0]).toMatchObject({ name: 'Alpha', externalCode: 'A1' });
  });

  it('trims the padding people leave in cells', () => {
    const { projects } = parseProjectSheet(sheet(['  ARIYA  ', '  DAC Ariya  ', ' Chennai ', ' Yes ']));
    expect(projects[0]).toMatchObject({
      externalCode: 'ARIYA',
      name: 'DAC Ariya',
      location: 'Chennai',
    });
  });

  it('upper-cases the code so casing drift is not a new project', () => {
    const { projects } = parseProjectSheet(sheet(['ariya', 'DAC Ariya', '', '']));
    expect(projects[0]?.externalCode).toBe('ARIYA');
  });

  it('reports a missing location as null rather than an empty string', () => {
    const { projects } = parseProjectSheet(sheet(['A1', 'Alpha', '', 'Yes']));
    expect(projects[0]?.location).toBeNull();
  });

  it('skips blank rows in the middle without complaining', () => {
    const { projects, problems } = parseProjectSheet(
      sheet(['A1', 'Alpha', '', ''], ['', '', '', ''], ['B2', 'Bravo', '', '']),
    );
    expect(projects).toHaveLength(2);
    expect(problems).toEqual([]);
  });

  it('skips leading blank rows before the header', () => {
    const { projects } = parseProjectSheet([[''], [], HEADERS, ['A1', 'Alpha', '', '']]);
    expect(projects[0]?.name).toBe('Alpha');
  });

  it('tolerates short rows', () => {
    const { projects } = parseProjectSheet(sheet(['A1', 'Alpha']));
    expect(projects[0]).toMatchObject({ externalCode: 'A1', name: 'Alpha', location: null });
  });
});

describe('parseProjectSheet — problems are reported, not thrown', () => {
  it('reports an empty sheet', () => {
    const result = parseProjectSheet([]);
    expect(result.projects).toEqual([]);
    expect(result.problems[0]?.reason).toContain('empty');
  });

  it('refuses a sheet with no name column, and says what it found', () => {
    const result = parseProjectSheet([
      ['Code', 'Town'],
      ['A1', 'Chennai'],
    ]);
    expect(result.projects).toEqual([]);
    expect(result.problems[0]?.reason).toContain('No project name column');
    expect(result.problems[0]?.reason).toContain('Code');
  });

  it('skips a row with no name and keeps going', () => {
    const { projects, problems } = parseProjectSheet(
      sheet(['A1', '', 'Chennai', ''], ['B2', 'Bravo', '', '']),
    );
    expect(projects).toHaveLength(1);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.sourceRow).toBe(2);
  });

  it('skips a duplicate code and points at the first use', () => {
    const { projects, problems } = parseProjectSheet(
      sheet(['A1', 'Alpha', '', ''], ['A1', 'Alpha again', '', '']),
    );
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe('Alpha');
    expect(problems[0]?.reason).toContain('row 2');
  });

  it('reports the sheet row number, not the array index', () => {
    const { problems } = parseProjectSheet(sheet(['A1', 'Alpha', '', ''], ['B2', '', '', '']));
    expect(problems[0]?.sourceRow).toBe(3);
  });

  it('says which headers it matched, for the admin screen', () => {
    const { columns } = parseProjectSheet(sheet(['A1', 'Alpha', 'Chennai', 'Yes']));
    expect(columns).toEqual({
      code: 'Project Code',
      name: 'Project Name',
      location: 'Location',
      active: 'Active',
    });
  });
});

describe('a sheet with no code column', () => {
  it('derives a code from the name', () => {
    const { projects } = parseProjectSheet([
      ['Name', 'Location'],
      ['DAC Ariya Phase II', 'Chennai'],
    ]);
    expect(projects[0]?.externalCode).toBe('DAC-ARIYA-PHASE-II');
  });

  it('reports that no code column was found', () => {
    const { columns } = parseProjectSheet([['Name'], ['Alpha']]);
    expect(columns.code).toBeNull();
  });
});

describe('deriveCode', () => {
  it('upper-cases and hyphenates', () => {
    expect(deriveCode('DAC Ariya Phase II')).toBe('DAC-ARIYA-PHASE-II');
  });

  it('collapses punctuation rather than keeping it', () => {
    expect(deriveCode('Ariya — Phase 2 (North)')).toBe('ARIYA-PHASE-2-NORTH');
  });

  it('never starts or ends with a hyphen', () => {
    expect(deriveCode('  -Alpha-  ')).toBe('ALPHA');
  });

  it('caps the length', () => {
    expect(deriveCode('A'.repeat(100)).length).toBeLessThanOrEqual(40);
  });

  it('falls back rather than returning an empty code', () => {
    expect(deriveCode('!!!')).toBe('UNNAMED');
  });
});

describe('isActiveCell', () => {
  it.each(['Yes', 'y', 'TRUE', '1', 'Active', 'Live', '', '   '])(
    'treats %s as active',
    (value) => {
      expect(isActiveCell(value)).toBe(true);
    },
  );

  it.each(['No', 'n', 'FALSE', '0', 'inactive', 'Closed', 'Archived', 'Sold out'])(
    'treats %s as inactive',
    (value) => {
      expect(isActiveCell(value)).toBe(false);
    },
  );

  it('treats a missing column as active, so an unmarked sheet still works', () => {
    expect(isActiveCell(undefined)).toBe(true);
  });

  it('does not hide a project over an unrecognised word', () => {
    expect(isActiveCell('launching soon')).toBe(true);
  });
});

// --- planSync --------------------------------------------------------------

function sheetProject(overrides: Partial<SheetProject> = {}): SheetProject {
  return {
    externalCode: 'ARIYA',
    name: 'DAC Ariya',
    location: 'Chennai',
    isActive: true,
    sourceRow: 2,
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingProject> = {}): ExistingProject {
  return {
    externalCode: 'ARIYA',
    name: 'DAC Ariya',
    location: 'Chennai',
    isActive: true,
    ...overrides,
  };
}

describe('planSync', () => {
  it('creates a project the database has never seen', () => {
    const plan = planSync([sheetProject()], []);
    expect(plan.created).toHaveLength(1);
    expect(plan.updated).toEqual([]);
  });

  it('leaves an unchanged project alone', () => {
    const plan = planSync([sheetProject()], [existing()]);
    expect(plan.unchanged).toHaveLength(1);
    expect(plan.created).toEqual([]);
    expect(plan.updated).toEqual([]);
  });

  it('treats a renamed project as a rename, not a duplicate', () => {
    // The whole reason the sync keys on a code: fixing a typo in the sheet
    // must not split the reporting across two projects.
    const plan = planSync([sheetProject({ name: 'DAC Ariya Phase II' })], [existing()]);
    expect(plan.created).toEqual([]);
    expect(plan.updated).toHaveLength(1);
    expect(plan.updated[0]?.name).toBe('DAC Ariya Phase II');
  });

  it('notices a changed location', () => {
    const plan = planSync([sheetProject({ location: 'Madurai' })], [existing()]);
    expect(plan.updated).toHaveLength(1);
  });

  it('notices a project switched off in the sheet', () => {
    const plan = planSync([sheetProject({ isActive: false })], [existing()]);
    expect(plan.updated).toHaveLength(1);
    expect(plan.updated[0]?.isActive).toBe(false);
  });

  it('deactivates a project the sheet no longer lists — never deletes it', () => {
    const plan = planSync([], [existing()]);
    expect(plan.deactivated).toEqual([{ externalCode: 'ARIYA', name: 'DAC Ariya' }]);
    // There is deliberately no "deleted" bucket: a booking from six months ago
    // must still resolve its project name.
    expect(Object.keys(plan)).not.toContain('deleted');
  });

  it('does not re-deactivate something already inactive', () => {
    const plan = planSync([], [existing({ isActive: false })]);
    expect(plan.deactivated).toEqual([]);
  });

  it('leaves hand-added projects alone, since the sheet does not know them', () => {
    const byHand = existing({ externalCode: null, name: 'Added by an admin' });
    const plan = planSync([], [byHand]);
    expect(plan.deactivated).toEqual([]);
  });

  it('handles a mixed sync', () => {
    const plan = planSync(
      [
        sheetProject({ externalCode: 'ARIYA' }),
        sheetProject({ externalCode: 'BRAVO', name: 'Bravo Towers', sourceRow: 3 }),
      ],
      [
        existing({ externalCode: 'ARIYA', name: 'Old name' }),
        existing({ externalCode: 'GONE', name: 'Retired Project' }),
      ],
    );

    expect(plan.created.map((p) => p.externalCode)).toEqual(['BRAVO']);
    expect(plan.updated.map((p) => p.externalCode)).toEqual(['ARIYA']);
    expect(plan.deactivated.map((p) => p.externalCode)).toEqual(['GONE']);
  });
});
