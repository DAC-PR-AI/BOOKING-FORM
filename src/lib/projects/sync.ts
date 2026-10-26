import 'server-only';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit/log';
import { googleConfig, readProjectRows, sheetUrl } from '@/lib/google/sheets';
import { parseProjectSheet, planSync, type SheetProblem, type SyncPlan } from './sheet';

/**
 * Running the project sync.
 *
 * The decisions are in `sheet.ts`, which is pure and tested; this reads the
 * sheet, applies the plan and records what happened. The ordering rule from
 * PLAN.md §2A holds throughout: **Postgres is the source of truth for foreign
 * keys**, and nothing here can break a booking — a project that disappears
 * from the sheet is deactivated, never deleted, so a booking from six months
 * ago still resolves its project name.
 *
 * Failures are surfaced, not swallowed. A sync that quietly does nothing is
 * worse than one that reports an error, because the dropdown just stops
 * gaining new projects and nobody knows why.
 */

export type SyncOutcome =
  | {
      ok: true;
      created: number;
      updated: number;
      unchanged: number;
      deactivated: number;
      problems: SheetProblem[];
      columns: ReturnType<typeof parseProjectSheet>['columns'];
      /** True when the sheet had no code column and codes were derived. */
      derivedCodes: boolean;
      sheetLink: string;
      at: Date;
    }
  | { ok: false; error: string; at: Date };

export type SyncStatus = {
  configured: boolean;
  sheetLink: string | null;
  tab: string | null;
  lastSyncedAt: Date | null;
  activeProjects: number;
  syncedProjects: number;
  handAddedProjects: number;
};

export async function syncStatus(organizationId: string): Promise<SyncStatus> {
  const config = googleConfig();

  const [activeProjects, syncedProjects, handAdded, latest] = await Promise.all([
    prisma.project.count({ where: { organizationId, isActive: true } }),
    prisma.project.count({ where: { organizationId, externalCode: { not: null } } }),
    prisma.project.count({ where: { organizationId, externalCode: null } }),
    prisma.project.findFirst({
      where: { organizationId, syncedAt: { not: null } },
      orderBy: { syncedAt: 'desc' },
      select: { syncedAt: true },
    }),
  ]);

  return {
    configured: config !== null,
    sheetLink: config ? sheetUrl(config) : null,
    tab: config?.tab ?? null,
    lastSyncedAt: latest?.syncedAt ?? null,
    activeProjects,
    syncedProjects,
    handAddedProjects: handAdded,
  };
}

/**
 * Reads the sheet and applies it.
 *
 * `dryRun` returns the same plan without writing, so the admin screen can show
 * what a sync would do — particularly which projects it would deactivate —
 * before anyone commits to it.
 */
export async function runProjectSync(input: {
  organizationId: string;
  userId?: string;
  dryRun?: boolean;
}): Promise<SyncOutcome> {
  const at = new Date();
  const config = googleConfig();

  if (!config) {
    return {
      ok: false,
      at,
      error:
        'The project sheet is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, ' +
        'GOOGLE_PRIVATE_KEY and GOOGLE_PROJECTS_SHEET_ID, then share the sheet with the ' +
        'service account as a Viewer.',
    };
  }

  let rows: string[][];
  try {
    rows = await readProjectRows(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read the sheet.';
    console.error('[projects] sheet read failed', { error });

    if (!input.dryRun) {
      await audit({
        organizationId: input.organizationId,
        userId: input.userId,
        action: 'SYNC',
        detail: `Project sync failed: ${message}`,
      });
    }
    return { ok: false, error: message, at };
  }

  const parsed = parseProjectSheet(rows);
  if (parsed.projects.length === 0) {
    const reason =
      parsed.problems[0]?.reason ?? 'The sheet has no usable project rows.';
    return { ok: false, error: reason, at };
  }

  const existing = await prisma.project.findMany({
    where: { organizationId: input.organizationId },
    select: { externalCode: true, name: true, location: true, isActive: true },
  });

  const plan: SyncPlan = planSync(parsed.projects, existing);

  if (input.dryRun) {
    return {
      ok: true,
      at,
      created: plan.created.length,
      updated: plan.updated.length,
      unchanged: plan.unchanged.length,
      deactivated: plan.deactivated.length,
      problems: parsed.problems,
      columns: parsed.columns,
      derivedCodes: parsed.columns.code === null,
      sheetLink: sheetUrl(config),
    };
  }

  // One transaction: a half-applied sync would leave the dropdown in a state
  // nobody chose, with some renames landed and others not.
  await prisma.$transaction(async (tx) => {
    for (const project of [...plan.created, ...plan.updated]) {
      await tx.project.upsert({
        where: {
          organizationId_externalCode: {
            organizationId: input.organizationId,
            externalCode: project.externalCode,
          },
        },
        update: {
          name: project.name,
          location: project.location,
          isActive: project.isActive,
          syncedAt: at,
        },
        create: {
          organizationId: input.organizationId,
          externalCode: project.externalCode,
          name: project.name,
          location: project.location,
          isActive: project.isActive,
          syncedAt: at,
        },
      });
    }

    // Touch the unchanged rows' syncedAt so "last seen in the sheet" stays
    // honest — otherwise an untouched project looks abandoned.
    if (plan.unchanged.length > 0) {
      await tx.project.updateMany({
        where: {
          organizationId: input.organizationId,
          externalCode: { in: plan.unchanged.map((p) => p.externalCode) },
        },
        data: { syncedAt: at },
      });
    }

    if (plan.deactivated.length > 0) {
      await tx.project.updateMany({
        where: {
          organizationId: input.organizationId,
          externalCode: { in: plan.deactivated.map((p) => p.externalCode) },
        },
        // Deactivated, never deleted (PLAN.md §2A rule 4).
        data: { isActive: false },
      });
    }
  });

  await audit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: 'SYNC',
    detail:
      `Project sync: ${plan.created.length} added, ${plan.updated.length} updated, ` +
      `${plan.unchanged.length} unchanged, ${plan.deactivated.length} deactivated` +
      (parsed.problems.length > 0 ? `, ${parsed.problems.length} row(s) skipped` : '') +
      '.',
  });

  return {
    ok: true,
    at,
    created: plan.created.length,
    updated: plan.updated.length,
    unchanged: plan.unchanged.length,
    deactivated: plan.deactivated.length,
    problems: parsed.problems,
    columns: parsed.columns,
    derivedCodes: parsed.columns.code === null,
    sheetLink: sheetUrl(config),
  };
}
