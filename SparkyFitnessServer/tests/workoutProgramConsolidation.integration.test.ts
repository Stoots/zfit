import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error TS7016 — package has no declarations.
import request from 'supertest';
// @ts-expect-error TS7016 — package has no declarations.
import cookieParser from 'cookie-parser';
import express from 'express';
import {
  workoutPlanResponseSchema,
  workoutPlanUpdateRequestSchema,
} from '@workspace/shared';
import type { PoolClient } from 'pg';
import { getClient, getSystemClient } from '../db/poolManager.js';
import * as repository from '../models/workoutProgramConsolidationRepository.js';
import type {
  ConsolidationManifest,
  ConsolidationResult,
} from '../models/workoutProgramConsolidationRepository.js';
import {
  assertConsolidationDisposableDatabase,
  seedConsolidationFixture,
} from './fixtures/workoutProgramConsolidation.js';
import type {
  ConsolidationFixture,
  ConsolidationGraph,
} from './fixtures/workoutProgramConsolidation.js';

export { assertConsolidationDisposableDatabase };
export type { ConsolidationGraph };

type RawRow = Record<string, unknown>;

const RAW_GRAPH_QUERIES = {
  training_programs: 'FROM training_programs t WHERE t.user_id = $1',
  training_program_phases:
    'FROM training_program_phases t WHERE t.user_id = $1',
  training_program_weeks: 'FROM training_program_weeks t WHERE t.user_id = $1',
  training_program_sessions:
    'FROM training_program_sessions t WHERE t.user_id = $1',
  cardio_test_attempts: 'FROM cardio_test_attempts t WHERE t.user_id = $1',
  workout_plan_templates: 'FROM workout_plan_templates t WHERE t.user_id = $1',
  workout_plan_sessions: 'FROM workout_plan_sessions t WHERE t.user_id = $1',
  workout_plan_template_assignments:
    'FROM workout_plan_template_assignments t WHERE t.user_id = $1',
  workout_plan_assignment_sets: `FROM workout_plan_assignment_sets t
    JOIN workout_plan_template_assignments a ON a.id = t.assignment_id WHERE a.user_id = $1`,
  workout_program_consolidations:
    'FROM workout_program_consolidations t WHERE t.user_id = $1',
  exercise_preset_entries:
    'FROM exercise_preset_entries t WHERE t.user_id = $1',
  exercise_entries: 'FROM exercise_entries t WHERE t.user_id = $1',
  exercise_entry_sets:
    'FROM exercise_entry_sets t JOIN exercise_entries e ON e.id = t.exercise_entry_id WHERE e.user_id = $1',
  exercise_entry_activity_details: `FROM exercise_entry_activity_details t
    WHERE t.created_by_user_id = $1
      OR EXISTS (SELECT 1 FROM exercise_entries e WHERE e.id = t.exercise_entry_id AND e.user_id = $1)
      OR EXISTS (SELECT 1 FROM exercise_preset_entries p WHERE p.id = t.exercise_preset_entry_id AND p.user_id = $1)`,
  exercise_entry_gps_points:
    'FROM exercise_entry_gps_points t WHERE t.user_id = $1',
  exercise_entry_hr_zones:
    'FROM exercise_entry_hr_zones t WHERE t.user_id = $1',
  exercise_entry_laps: 'FROM exercise_entry_laps t WHERE t.user_id = $1',
  family_access:
    'FROM family_access t WHERE t.owner_user_id = $1 OR t.family_user_id = $1',
  user_preferences: 'FROM user_preferences t WHERE t.user_id = $1',
  exercises: 'FROM exercises t WHERE t.user_id = $1',
  workout_presets: 'FROM workout_presets t WHERE t.user_id = $1',
  workout_preset_exercises:
    'FROM workout_preset_exercises t JOIN workout_presets p ON p.id = t.workout_preset_id WHERE p.user_id = $1',
  workout_preset_exercise_sets: `FROM workout_preset_exercise_sets t
    JOIN workout_preset_exercises e ON e.id = t.workout_preset_exercise_id
    JOIN workout_presets p ON p.id = e.workout_preset_id WHERE p.user_id = $1`,
};

function rowId(row: RawRow): string {
  if (typeof row.id !== 'string' && typeof row.id !== 'number') {
    throw new Error('Raw graph row has no persistent identifier');
  }
  return String(row.id);
}

function rows(graph: ConsolidationGraph, table: string): RawRow[] {
  const tableRows = graph[table];
  if (!tableRows) throw new Error(`Raw graph is missing ${table}`);
  return tableRows;
}

function rowsById(graph: ConsolidationGraph, table: string): RawRow[] {
  return [...rows(graph, table)].sort((a, b) =>
    rowId(a).localeCompare(rowId(b))
  );
}

function row(
  graph: ConsolidationGraph,
  table: string,
  id: string | number
): RawRow {
  const found = rows(graph, table).find(
    (candidate) => rowId(candidate) === String(id)
  );
  if (!found) throw new Error(`Raw graph is missing ${table}:${id}`);
  return found;
}

function ordered(tableRows: RawRow[], orderField: string): RawRow[] {
  return [...tableRows].sort((a, b) => {
    const left = a[orderField];
    const right = b[orderField];
    if (left !== null && typeof left !== 'number')
      throw new Error(`Invalid ${orderField}`);
    if (right !== null && typeof right !== 'number')
      throw new Error(`Invalid ${orderField}`);
    const identityOrder =
      typeof a.id === 'number' && typeof b.id === 'number'
        ? a.id - b.id
        : rowId(a).localeCompare(rowId(b));
    return (
      (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER) ||
      identityOrder
    );
  });
}

// Independent app-role reads: no expected fixture payloads or repository DTOs.
// JSONB retains every SQL field, audit value, and nested null/absent distinction.
export async function captureRawConsolidationGraph(
  fixture: Pick<
    ConsolidationFixture,
    'ownerId' | 'delegateId' | 'unrelatedOwnerId'
  >
): Promise<ConsolidationGraph> {
  assertConsolidationDisposableDatabase();
  const collected = new Map<string, Map<string, RawRow>>();
  for (const table of Object.keys(RAW_GRAPH_QUERIES))
    collected.set(table, new Map());
  const client: PoolClient = await getClient(fixture.ownerId, fixture.ownerId);
  try {
    const identity = await client.query<{
      database: string;
      is_superuser: boolean;
      bypasses_rls: boolean;
    }>(
      `SELECT current_database() AS database, rolsuper AS is_superuser, rolbypassrls AS bypasses_rls
       FROM pg_roles WHERE rolname = current_user`
    );
    expect(identity.rows).toStrictEqual([
      {
        database: process.env.SPARKY_FITNESS_DB_NAME,
        is_superuser: false,
        bypasses_rls: false,
      },
    ]);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    for (const userId of [
      fixture.ownerId,
      fixture.delegateId,
      fixture.unrelatedOwnerId,
    ]) {
      await client.query('SELECT set_app_context($1, $2)', [userId, userId]);
      for (const [table, query] of Object.entries(RAW_GRAPH_QUERIES)) {
        const result = await client.query<{ row: RawRow }>(
          `SELECT to_jsonb(t) AS row ${query}`,
          [userId]
        );
        const tableRows = collected.get(table)!;
        for (const record of result.rows)
          tableRows.set(rowId(record.row), record.row);
      }
    }
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  return Object.fromEntries(
    [...collected].map(([table, tableRows]) => [table, [...tableRows.values()]])
  );
}

export function assertRawConsolidationGraphsEqual(
  expected: ConsolidationGraph,
  actual: ConsolidationGraph
): void {
  expect(Object.keys(actual).sort()).toStrictEqual(
    Object.keys(expected).sort()
  );
  for (const table of Object.keys(expected)) {
    expect(
      rowsById(actual, table),
      `Every raw field in ${table}`
    ).toStrictEqual(rowsById(expected, table));
  }
}

function acceptMovedMetadataAudit(original: RawRow, moved: RawRow): unknown {
  if (typeof moved.updated_at !== 'string') {
    throw new Error(
      'Moved library metadata must retain a persisted audit timestamp'
    );
  }
  const movedAt = Date.parse(moved.updated_at);
  expect(Number.isNaN(movedAt)).toBe(false);
  if (typeof original.updated_at === 'string') {
    expect(movedAt).toBeGreaterThanOrEqual(Date.parse(original.updated_at));
  }
  return moved.updated_at;
}

// Only manifest-authorized membership/order, clone identifiers/bindings, target
// creation, move metadata audit updates and explicit empty-plan retirement may differ.
export function assertConsolidationGraphPreserved(
  before: ConsolidationGraph,
  after: ConsolidationGraph,
  manifest: ConsolidationManifest,
  result: ConsolidationResult
): void {
  const expected = structuredClone(before);
  expect(result.target_plan_id).toBe(manifest.target_plan.id);
  const targetPlan = row(
    after,
    'workout_plan_templates',
    result.target_plan_id
  );
  expect(targetPlan).toMatchObject({
    id: manifest.target_plan.id,
    user_id: manifest.user_id,
    plan_name: manifest.target_plan.name,
    description: manifest.target_plan.description,
    start_date: null,
    end_date: null,
  });
  rows(expected, 'workout_plan_templates').push(targetPlan);

  for (const mapping of manifest.mapping) {
    const source = row(
      before,
      'workout_plan_sessions',
      mapping.source_session_id
    );
    expect(source.template_id).toBe(mapping.source_plan_id);
    expect(
      mapping.assignments
        .map((assignment) => assignment.source_assignment_id)
        .sort((a, b) => a - b)
    ).toStrictEqual(
      rows(before, 'workout_plan_template_assignments')
        .filter((assignment) => assignment.workout_session_id === source.id)
        .map((assignment) => Number(assignment.id))
        .sort((a, b) => a - b)
    );
    const sourceAssignments = ordered(
      rows(before, 'workout_plan_template_assignments').filter(
        (assignment) => assignment.workout_session_id === source.id
      ),
      'sort_order'
    );
    if (mapping.mode === 'move') {
      expect(mapping.target_session_id).toBe(mapping.source_session_id);
      Object.assign(
        row(expected, 'workout_plan_sessions', mapping.source_session_id),
        {
          template_id: result.target_plan_id,
          sort_order: mapping.sort_order,
          day_of_week: null,
          updated_at: acceptMovedMetadataAudit(
            source,
            row(after, 'workout_plan_sessions', mapping.source_session_id)
          ),
        }
      );
      for (const assignment of sourceAssignments) {
        const moved = row(
          after,
          'workout_plan_template_assignments',
          rowId(assignment)
        );
        const expectedAssignment = row(
          expected,
          'workout_plan_template_assignments',
          rowId(assignment)
        );
        expectedAssignment.template_id = result.target_plan_id;
        expectedAssignment.updated_at = acceptMovedMetadataAudit(
          assignment,
          moved
        );
        const assignmentMap = mapping.assignments.find(
          (candidate) => candidate.source_assignment_id === assignment.id
        );
        if (!assignmentMap)
          throw new Error('Move omitted an exact assignment mapping');
        expect(assignmentMap.target_assignment_id).toBe(assignment.id);
        expect(assignmentMap.sets).toStrictEqual(
          ordered(
            rows(before, 'workout_plan_assignment_sets').filter(
              (set) => set.assignment_id === assignment.id
            ),
            'set_number'
          ).map((set) => ({ source_set_id: set.id, target_set_id: set.id }))
        );
      }
    } else {
      expect(mapping.target_session_id).not.toBe(mapping.source_session_id);
      const targetSession = row(
        after,
        'workout_plan_sessions',
        mapping.target_session_id
      );
      expect(targetSession).toStrictEqual({
        ...source,
        id: mapping.target_session_id,
        template_id: result.target_plan_id,
        sort_order: mapping.sort_order,
        day_of_week: null,
      });
      rows(expected, 'workout_plan_sessions').push(targetSession);
      const targetAssignments = ordered(
        rows(after, 'workout_plan_template_assignments').filter(
          (assignment) => assignment.workout_session_id === targetSession.id
        ),
        'sort_order'
      );
      expect(targetAssignments.length).toBe(sourceAssignments.length);
      for (const [index, original] of sourceAssignments.entries()) {
        const cloned = targetAssignments[index]!;
        const assignmentMap = mapping.assignments.find(
          (candidate) => candidate.source_assignment_id === original.id
        );
        if (!assignmentMap)
          throw new Error('Clone omitted an exact assignment mapping');
        expect(cloned.id).toBe(assignmentMap.target_assignment_id);
        expect(
          rows(before, 'workout_plan_template_assignments').some(
            (candidate) => candidate.id === cloned.id
          )
        ).toBe(false);
        expect(cloned).toStrictEqual({
          ...original,
          id: cloned.id,
          template_id: result.target_plan_id,
          workout_session_id: mapping.target_session_id,
        });
        rows(expected, 'workout_plan_template_assignments').push(cloned);
        const originalSets = ordered(
          rows(before, 'workout_plan_assignment_sets').filter(
            (set) => set.assignment_id === original.id
          ),
          'set_number'
        );
        const clonedSets = ordered(
          rows(after, 'workout_plan_assignment_sets').filter(
            (set) => set.assignment_id === cloned.id
          ),
          'set_number'
        );
        expect(clonedSets.length).toBe(originalSets.length);
        for (const [setIndex, originalSet] of originalSets.entries()) {
          const clonedSet = clonedSets[setIndex]!;
          const setMap = assignmentMap.sets.find(
            (candidate) => candidate.source_set_id === originalSet.id
          );
          if (!setMap) throw new Error('Clone omitted an exact set mapping');
          expect(clonedSet.id).toBe(setMap.target_set_id);
          expect(
            rows(before, 'workout_plan_assignment_sets').some(
              (candidate) => candidate.id === clonedSet.id
            )
          ).toBe(false);
          expect(clonedSet).toStrictEqual({
            ...originalSet,
            id: clonedSet.id,
            assignment_id: cloned.id,
          });
          rows(expected, 'workout_plan_assignment_sets').push(clonedSet);
        }
      }
      for (const plannedId of mapping.planned_session_ids) {
        const planned = row(expected, 'training_program_sessions', plannedId);
        expect(planned.program_id).toBe(manifest.program_id);
        expect(planned.workout_session_id).toBe(mapping.source_session_id);
        planned.workout_session_id = mapping.target_session_id;
      }
    }
  }
  expected.workout_plan_templates = rows(
    expected,
    'workout_plan_templates'
  ).filter((plan) => !manifest.retire_plan_ids.includes(Number(plan.id)));
  const journal = row(
    after,
    'workout_program_consolidations',
    manifest.operation_id
  );
  expect(journal).toMatchObject({
    id: manifest.operation_id,
    user_id: manifest.user_id,
    program_id: manifest.program_id,
    target_plan_id: result.target_plan_id,
  });
  expect(journal.manifest).toStrictEqual(manifest);
  expect(journal.result).toStrictEqual(result);
  rows(expected, 'workout_program_consolidations').push(journal);
  assertRawConsolidationGraphsEqual(expected, after);
}

function previousUtcMonday(): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) - 7);
  return date.toISOString().slice(0, 10);
}

const run = process.env.RUN_CONSOLIDATION_DB === '1';
if (run) assertConsolidationDisposableDatabase();

describe.runIf(run)('persisted lossless Workout Program consolidation', () => {
  let fixture: ConsolidationFixture | undefined;
  const extraProgramIds: string[] = [];
  const extraSessionIds: string[] = [];

  function currentFixture(): ConsolidationFixture {
    if (!fixture) throw new Error('Consolidation fixture was not seeded');
    return fixture;
  }

  beforeEach(async () => {
    assertConsolidationDisposableDatabase();
    fixture = await seedConsolidationFixture({
      startDate: previousUtcMonday(),
    });
  }, 120_000);

  afterEach(async () => {
    if (!fixture) return;
    assertConsolidationDisposableDatabase();
    try {
      const client: PoolClient = await getClient(
        fixture.ownerId,
        fixture.ownerId
      );
      try {
        for (const id of extraProgramIds)
          await client.query('DELETE FROM training_programs WHERE id = $1', [
            id,
          ]);
        for (const id of extraSessionIds)
          await client.query(
            'DELETE FROM workout_plan_sessions WHERE id = $1',
            [id]
          );
      } finally {
        client.release();
      }
    } finally {
      extraProgramIds.length = 0;
      extraSessionIds.length = 0;
      await fixture.cleanup();
      fixture = undefined;
    }
  }, 120_000);

  async function captureIdentitySequenceState(): Promise<RawRow[]> {
    assertConsolidationDisposableDatabase();
    const f = currentFixture();
    const client: PoolClient = await getClient(f.ownerId, f.ownerId);
    try {
      const state = await client.query<RawRow>(
        `SELECT c.relname AS id, s.seqstart::text, s.seqincrement::text, s.seqcache::text,
                s.seqcycle, pg_sequence_last_value(s.seqrelid)::text AS last_value
         FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid
         WHERE s.seqrelid IN (
           SELECT pg_get_serial_sequence(table_name, 'id')::regclass
           FROM unnest($1::text[]) AS owned_tables(table_name)
         ) ORDER BY c.relname`,
        [
          [
            'public.workout_plan_templates',
            'public.workout_plan_template_assignments',
            'public.workout_plan_assignment_sets',
          ],
        ]
      );
      return state.rows;
    } finally {
      client.release();
    }
  }
  async function proposal(
    programId = currentFixture().programId
  ): Promise<ConsolidationManifest> {
    const f = currentFixture();
    const before = await captureRawConsolidationGraph(f);
    const sequencesBefore = await captureIdentitySequenceState();
    const preflight = await repository.preflightWorkoutProgramConsolidation(
      f.ownerId,
      {
        program_id: programId,
        target_plan_name: 'Twelve-week strength and conditioning',
        description: 'Full local prescriptions; preserve original history',
        operation_id: randomUUID(),
      }
    );
    assertRawConsolidationGraphsEqual(
      before,
      await captureRawConsolidationGraph(f)
    );
    expect(await captureIdentitySequenceState()).toStrictEqual(sequencesBefore);
    expect(preflight.schema_state).toBe('sessions');
    expect(preflight.blockers).toStrictEqual([]);
    expect(preflight.unresolved).toStrictEqual([]);
    if (!preflight.proposal)
      throw new Error('Session-schema preflight returned no reviewed manifest');
    return preflight.proposal;
  }

  async function rejectWithoutWrites(
    manifest: ConsolidationManifest,
    options: {
      userId?: string;
      authenticatedUserId?: string;
      statuses?: number[];
    } = {}
  ): Promise<void> {
    const f = currentFixture();
    const before = await captureRawConsolidationGraph(f);
    let rejection: unknown;
    try {
      await repository.applyWorkoutProgramConsolidation(
        options.userId ?? f.ownerId,
        manifest,
        options.authenticatedUserId ?? options.userId ?? f.ownerId
      );
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(Error);
    if (!(rejection instanceof Error) || !('status' in rejection)) {
      throw new Error(
        'Rejected consolidation must expose its supported status',
        { cause: rejection }
      );
    }
    expect(options.statuses ?? [400, 404, 409]).toContain(rejection.status);
    assertRawConsolidationGraphsEqual(
      before,
      await captureRawConsolidationGraph(f)
    );
  }

  function secondWeekA(): string {
    const f = currentFixture();
    const plannedId = f.plannedSessionIds.find(
      (id) => f.weekNumbers[id] === 2 && f.kinds[id] === 'A'
    );
    if (!plannedId) throw new Error('Fixture is missing second-week A');
    return plannedId;
  }

  async function mutate(sql: string, values: unknown[]): Promise<void> {
    assertConsolidationDisposableDatabase();
    const f = currentFixture();
    const client: PoolClient = await getClient(f.ownerId, f.ownerId);
    try {
      const changed = await client.query(sql, values);
      expect(changed.rowCount).toBe(1);
    } finally {
      client.release();
    }
  }

  async function addUnselectedSession(): Promise<string> {
    const f = currentFixture();
    const plannedId = secondWeekA();
    const id = randomUUID();
    await mutate(
      `INSERT INTO workout_plan_sessions (id, template_id, user_id, name, sort_order)
       VALUES ($1, $2, $3, 'Unselected library prescription', 99)`,
      [id, f.sourcePlanByPlannedSession[plannedId], f.ownerId]
    );
    extraSessionIds.push(id);
    return id;
  }

  async function addOutsideProgram(): Promise<string> {
    assertConsolidationDisposableDatabase();
    // Intentional opt-in module boundary: service imports can initialize auth
    // through execution dependencies before a DB-less test collection guard.
    const { saveProgram } =
      await import('../services/trainingProgramService.js');
    const f = currentFixture();
    const plannedId = secondWeekA();
    const end = new Date(`${f.startDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    const program = await saveProgram(f.ownerId, {
      name: 'Another Program retains the exact original Session',
      goal: 'Independent training',
      start_date: f.startDate,
      end_date: end.toISOString().slice(0, 10),
      phases: [
        {
          name: 'Independent phase',
          goal: 'Preserve outside references',
          weeks: [
            {
              start_date: f.startDate,
              end_date: end.toISOString().slice(0, 10),
              sessions: [
                {
                  name: 'Outside exact A',
                  scheduled_date: f.startDate,
                  workout_session_id:
                    f.sourceSessionByPlannedSession[plannedId],
                },
              ],
            },
          ],
        },
      ],
    });
    extraProgramIds.push(program.id);
    return program.id;
  }

  async function historicalAcknowledgement() {
    const f = currentFixture();
    const manifest = await proposal();
    const applied = await repository.applyWorkoutProgramConsolidation(
      f.ownerId,
      manifest
    );
    // Seed a separate historical-format journal entry on a real applied graph.
    // Never rewrite the current operation or any retained historical receipt.
    const oldMapping = manifest.mapping.map((mapping) => {
      const old: Record<string, unknown> = { ...mapping };
      delete old.target_day_of_week;
      return old;
    });
    const historical = {
      ...manifest,
      operation_id: randomUUID(),
      mapping: oldMapping,
    };
    const acknowledgement = {
      ...applied,
      operation_id: historical.operation_id,
      mapping: oldMapping,
    };
    await mutate(
      `INSERT INTO workout_program_consolidations
       (id,user_id,program_id,target_plan_id,manifest,result)
       VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [
        historical.operation_id,
        f.ownerId,
        f.programId,
        applied.target_plan_id,
        JSON.stringify(historical),
        JSON.stringify(acknowledgement),
      ]
    );
    return { historical, acknowledgement };
  }

  async function historicalCli(
    manifest: { operation_id: string },
    userId = currentFixture().ownerId
  ) {
    const directory = await mkdtemp(join(tmpdir(), 'zfit14-recorded-replay-'));
    const input = join(directory, 'approved-manifest.json');
    const output = join(directory, 'recovered-receipt.json');
    try {
      await writeFile(input, JSON.stringify(manifest), { mode: 0o600 });
      const operationId = manifest.operation_id;
      const child = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          fileURLToPath(
            new URL(
              '../scripts/consolidateWorkoutProgram.script.ts',
              import.meta.url
            )
          ),
          '--action',
          'apply',
          '--owner',
          userId,
          '--manifest',
          input,
          '--output',
          output,
          '--execute',
          '--confirm-operation',
          operationId,
          '--expected-host',
          process.env.SPARKY_FITNESS_DB_HOST!,
          '--expected-port',
          process.env.SPARKY_FITNESS_DB_PORT!,
          '--expected-database',
          process.env.SPARKY_FITNESS_DB_NAME!,
        ],
        { env: process.env, encoding: 'utf8', timeout: 60_000 }
      );
      if (child.error) throw child.error;
      let receipt: unknown;
      try {
        receipt = JSON.parse(await readFile(output, 'utf8'));
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw error;
      }
      return { status: child.status, stderr: child.stderr, receipt };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async function withoutDataWrites(action: () => Promise<void>) {
    const f = currentFixture();
    const before = await captureRawConsolidationGraph(f);
    const sequences = await captureIdentitySequenceState();
    await action();
    assertRawConsolidationGraphsEqual(
      before,
      await captureRawConsolidationGraph(f)
    );
    expect(await captureIdentitySequenceState()).toStrictEqual(sequences);
  }

  it('recovers an exact recorded historical manifest through the repository without data writes', async () => {
    const { historical, acknowledgement } = await historicalAcknowledgement();
    await withoutDataWrites(async () => {
      expect(
        await repository.applyWorkoutProgramConsolidation(
          currentFixture().ownerId,
          historical
        )
      ).toStrictEqual({ ...acknowledgement, already_applied: true });
    });
  }, 120_000);

  it('recovers an exact recorded historical manifest through the real CLI without data writes', async () => {
    const { historical, acknowledgement } = await historicalAcknowledgement();
    await withoutDataWrites(async () => {
      const recovered = await historicalCli(historical);
      expect(recovered.status, recovered.stderr).toBe(0);
      expect(recovered.receipt).toStrictEqual({
        ...acknowledgement,
        already_applied: true,
      });
    });
  }, 120_000);

  it('rejects an altered recorded historical manifest through repository and CLI without data writes', async () => {
    const { historical } = await historicalAcknowledgement();
    const changed = structuredClone(historical);
    changed.target_plan.name = 'Not the acknowledged approved manifest';
    await withoutDataWrites(async () => {
      await expect(
        repository.applyWorkoutProgramConsolidation(
          currentFixture().ownerId,
          changed
        )
      ).rejects.toMatchObject({
        status: 409,
        message:
          'Operation identity already records a different explicit manifest.',
      });
      const rejected = await historicalCli(changed);
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain('different explicit manifest');
      expect(rejected.receipt).toBeUndefined();
    });
  }, 120_000);

  it('rejects an unrecorded historical manifest through repository and CLI without data writes', async () => {
    const { historical } = await historicalAcknowledgement();
    historical.operation_id = randomUUID();
    await withoutDataWrites(async () => {
      await expect(
        repository.applyWorkoutProgramConsolidation(
          currentFixture().ownerId,
          historical
        )
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('target_day_of_week'),
      });
      const rejected = await historicalCli(historical);
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain('target_day_of_week');
      expect(rejected.receipt).toBeUndefined();
    });
  }, 120_000);

  it('isolates recorded historical acknowledgements from delegates and other owners without data writes', async () => {
    const f = currentFixture();
    const { historical } = await historicalAcknowledgement();
    await withoutDataWrites(async () => {
      await expect(
        repository.applyWorkoutProgramConsolidation(
          f.ownerId,
          historical,
          f.delegateId
        )
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        repository.applyWorkoutProgramConsolidation(
          f.unrelatedOwnerId,
          historical
        )
      ).rejects.toMatchObject({ status: 404 });
      const forgedOwner = { ...historical, user_id: f.unrelatedOwnerId };
      await expect(
        repository.applyWorkoutProgramConsolidation(
          f.unrelatedOwnerId,
          forgedOwner
        )
      ).rejects.toMatchObject({ status: 400 });
      const rejected = await historicalCli(historical, f.unrelatedOwnerId);
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain('does not match the approved manifest');
      expect(rejected.receipt).toBeUndefined();
    });
  }, 120_000);

  it('rejects an approved destination weekday that contradicts the sequential target without writes', async () => {
    const manifest = await proposal();
    const invalid = structuredClone(manifest);
    Object.assign(invalid.mapping[0]!, { target_day_of_week: 1 });
    await rejectWithoutWrites(invalid, { statuses: [400] });
  });

  it('normalizes weekly move and protected clone destinations for authenticated activation without changing Program dates or protected sources', async () => {
    const f = currentFixture();
    const moveId = f.sourceSessionByPlannedSession[secondWeekA()]!;
    const cloneId = f.sourceSessionByPlannedSession[f.startedPlannedSessionId]!;
    for (const [sessionId, weekday] of [
      [moveId, 1],
      [cloneId, 3],
    ] as const) {
      await mutate(
        "UPDATE workout_plan_templates SET schedule_type = 'weekly' WHERE id = (SELECT template_id FROM workout_plan_sessions WHERE id = $1)",
        [sessionId]
      );
      await mutate(
        'UPDATE workout_plan_sessions SET day_of_week = $2 WHERE id = $1',
        [sessionId, weekday]
      );
    }
    const before = await captureRawConsolidationGraph(f);
    const manifest = await proposal();
    expect(
      manifest.mapping.find((m) => m.source_session_id === moveId)?.mode
    ).toBe('move');
    expect(
      manifest.mapping.find((m) => m.source_session_id === cloneId)?.mode
    ).toBe('clone');
    expect(manifest.mapping.map((m) => m.target_day_of_week)).toStrictEqual(
      Array(57).fill(null)
    );
    const applied = await repository.applyWorkoutProgramConsolidation(
      f.ownerId,
      manifest
    );
    const { default: plans } =
      await import('../routes/workoutPlanTemplateRoutes.js');
    const app = express();
    app.use(express.json({ limit: '50mb' }), cookieParser());
    app.use('/api/workout-plan-templates', plans);
    const endpoint = `/api/workout-plan-templates/${applied.target_plan_id}`;
    const loaded = await request(app)
      .get(endpoint)
      .set('Authorization', `Bearer ${f.ownerToken}`);
    expect(loaded.status, JSON.stringify(loaded.body)).toBe(200);
    const plan = workoutPlanResponseSchema.parse(loaded.body);
    expect(plan.schedule_type).toBe('sequential');
    for (const sourceId of [moveId, cloneId]) {
      const mapping = manifest.mapping.find(
        (m) => m.source_session_id === sourceId
      )!;
      expect(
        plan.sessions.find((s) => s.id === mapping.target_session_id)
          ?.day_of_week
      ).toBeNull();
    }
    const after = await captureRawConsolidationGraph(f);
    assertConsolidationGraphPreserved(before, after, manifest, applied);
    expect(row(after, 'workout_plan_sessions', cloneId)).toStrictEqual(
      row(before, 'workout_plan_sessions', cloneId)
    );
    // The same full-plan update used by activation must accept persisted weekdays.
    const activation = workoutPlanUpdateRequestSchema.parse({
      plan_name: plan.plan_name,
      description: plan.description,
      start_date: plan.start_date,
      end_date: plan.end_date,
      schedule_type: plan.schedule_type,
      entry_mode: plan.entry_mode,
      is_active: true,
      sessions: plan.sessions.map((s) => ({
        ...s,
        assignments: s.assignments.map((a) => ({
          ...a,
          workout_preset_id: a.workout_preset_id ?? undefined,
          preset_snapshot: a.preset_snapshot ?? undefined,
        })),
      })),
    });
    const activated = await request(app)
      .put(endpoint)
      .set('Authorization', `Bearer ${f.ownerToken}`)
      .send(activation);
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);
    const reloaded = await request(app)
      .get(endpoint)
      .set('Authorization', `Bearer ${f.ownerToken}`);
    expect(reloaded.status).toBe(200);
    const active = workoutPlanResponseSchema.parse(reloaded.body);
    expect(active.is_active).toBe(true);
    expect(active.sessions).toStrictEqual(plan.sessions);
    const activeResponse = await request(app)
      .get(`/api/workout-plan-templates/active/${f.startDate}`)
      .set('Authorization', `Bearer ${f.ownerToken}`);
    expect(activeResponse.status).toBe(200);
    const mobilePlan = activeResponse.body.find(
      (item: { id: number }) => item.id === active.id
    );
    expect(
      mobilePlan.assignments.map((assignment: { id: number }) => assignment.id)
    ).toEqual(
      active.sessions.flatMap((session) =>
        session.assignments.map((assignment) => assignment.id)
      )
    );
    expect(mobilePlan.sequence_position).toMatchObject({ total: 57 });
    expect(mobilePlan.next_assignment).toMatchObject({
      id: mobilePlan.next_assignments[0].id,
      template_id: active.id,
      session_index: mobilePlan.sequence_position.current,
      session_name: mobilePlan.next_session.name,
    });
    const activatedGraph = await captureRawConsolidationGraph(f);
    for (const table of [
      'training_programs',
      'training_program_phases',
      'training_program_weeks',
      'training_program_sessions',
    ]) {
      expect(rowsById(activatedGraph, table)).toStrictEqual(
        rowsById(after, table)
      );
    }
    expect(row(activatedGraph, 'workout_plan_sessions', cloneId)).toStrictEqual(
      row(before, 'workout_plan_sessions', cloneId)
    );
  }, 120_000);

  it('preserves the full 57-Session Program, performed history and frozen prescriptions; repeats without any row changes', async () => {
    const f = currentFixture();
    const before = await captureRawConsolidationGraph(f);
    const phases = ordered(
      rows(before, 'training_program_phases').filter(
        (phase) => phase.program_id === f.programId
      ),
      'sort_order'
    );
    const weeks = phases.flatMap((phase) =>
      ordered(
        rows(before, 'training_program_weeks').filter(
          (week) => week.phase_id === phase.id
        ),
        'sort_order'
      )
    );
    const planned = weeks.flatMap((week) =>
      ordered(
        rows(before, 'training_program_sessions').filter(
          (session) => session.week_id === week.id
        ),
        'sort_order'
      )
    );
    expect(phases.length).toBe(3);
    expect(weeks.length).toBe(12);
    expect(planned.length).toBe(57);
    expect(
      new Set(planned.map((session) => session.workout_session_id)).size
    ).toBe(57);
    expect(
      planned
        .map((session) => f.kinds[rowId(session)])
        .filter((kind) => kind === 'C').length
    ).toBe(9);
    for (const [index, week] of weeks.entries()) {
      const actualKinds = planned
        .filter((session) => session.week_id === week.id)
        .map((session) => f.kinds[rowId(session)]);
      expect(actualKinds).toStrictEqual(
        [4, 8, 12].includes(index + 1)
          ? ['A', 'conditioning', 'B', 'conditioning']
          : ['A', 'conditioning', 'B', 'C', 'conditioning']
      );
    }
    expect(
      row(before, 'training_program_sessions', f.completedPlannedSessionId)
        .status
    ).toBe('completed');
    expect(
      row(before, 'training_program_sessions', f.missedPlannedSessionId).status
    ).toBe('missed');
    const performedReps = rows(before, 'exercise_entry_sets')
      .filter((set) => f.completedDiarySetIds.includes(Number(set.id)))
      .map((set) => set.reps);
    expect(performedReps).toContain(9);
    expect(performedReps).not.toContain(8);
    const futureParent = row(
      before,
      'exercise_preset_entries',
      f.startedDiaryParentId
    );
    expect(Date.parse(String(futureParent.entry_date))).toBeGreaterThan(
      Date.now()
    );
    expect(
      row(before, 'training_program_sessions', f.optionalPlannedSessionId)
        .status
    ).toBe('planned');
    // Keep service/auth initialization behind the real disposable fixture.
    const { getProgram } =
      await import('../services/trainingProgramService.js');
    const projected = await getProgram(f.ownerId, f.programId);
    const projectedSessions = projected.phases.flatMap((phase) =>
      phase.weeks.flatMap((week) => week.sessions)
    );
    expect(
      projectedSessions.find(
        (session) => session.id === f.optionalPlannedSessionId
      )?.status
    ).toBe('omitted');
    const ordinarySetCounts = rows(before, 'workout_plan_template_assignments')
      .filter((assignment) => assignment.exercise_id !== null)
      .map(
        (assignment) =>
          rows(before, 'workout_plan_assignment_sets').filter(
            (set) => set.assignment_id === assignment.id
          ).length
      );
    expect(ordinarySetCounts).toContain(2);
    expect(ordinarySetCounts).toContain(3);

    const manifest = await proposal();
    expect(
      manifest.mapping.map((mapping) => mapping.source_session_id)
    ).toStrictEqual(planned.map((session) => session.workout_session_id));
    expect(manifest.mapping.map((mapping) => mapping.sort_order)).toStrictEqual(
      Array.from({ length: 57 }, (_, index) => index)
    );
    expect(
      manifest.mapping.flatMap((mapping) => mapping.planned_session_ids).sort()
    ).toStrictEqual(planned.map(rowId).sort());
    expect(
      manifest.mapping.filter((mapping) => mapping.mode === 'move').length
    ).toBe(56);
    const clones = manifest.mapping.filter(
      (mapping) => mapping.mode === 'clone'
    );
    expect(clones.map((mapping) => mapping.source_session_id)).toStrictEqual([
      f.sourceSessionByPlannedSession[f.startedPlannedSessionId],
    ]);
    expect(manifest.retire_plan_ids).toStrictEqual([]);
    const result = await repository.applyWorkoutProgramConsolidation(
      f.ownerId,
      manifest
    );
    expect(result).toStrictEqual({
      operation_id: manifest.operation_id,
      target_plan_id: manifest.target_plan.id,
      already_applied: false,
      mapping: manifest.mapping,
    });
    const after = await captureRawConsolidationGraph(f);
    assertConsolidationGraphPreserved(before, after, manifest, result);
    for (const id of f.sourcePlanIds) {
      expect(row(after, 'workout_plan_templates', id)).toStrictEqual(
        row(before, 'workout_plan_templates', id)
      );
    }
    const repeated = await repository.applyWorkoutProgramConsolidation(
      f.ownerId,
      manifest
    );
    expect(repeated).toStrictEqual({ ...result, already_applied: true });
    assertRawConsolidationGraphsEqual(
      after,
      await captureRawConsolidationGraph(f)
    );
    const mismatch = structuredClone(manifest);
    mismatch.target_plan.name =
      'Different manifest under the same operation UUID';
    await rejectWithoutWrites(mismatch, { statuses: [409] });
  }, 120_000);

  it('deletes a real synthetic owner account with its journal and retains unrelated accounts, then safely cleans up the fixture', async () => {
    assertConsolidationDisposableDatabase();
    const f = currentFixture();
    // Intentional collection boundary: static auth imports initialize its
    // migrated schema even when this opt-in database suite is not selected.
    const { auth } = await import('../auth.js');
    const control = await auth.api.signUpEmail({
      body: {
        name: 'Consolidation cleanup control',
        email: `consolidation-cleanup-control-${randomUUID()}@example.test`,
        password: randomBytes(24).toString('base64'),
      },
    });
    const client: PoolClient = await getSystemClient();
    try {
      expect(
        (
          await client.query<{ database: string }>(
            'SELECT current_database() AS database'
          )
        ).rows
      ).toStrictEqual([{ database: process.env.SPARKY_FITNESS_DB_NAME }]);
      const controlIds = [f.delegateId, f.unrelatedOwnerId, control.user.id];
      const controlsBefore = await client.query<{ row: RawRow }>(
        'SELECT to_jsonb(t) AS row FROM public."user" t WHERE id = ANY($1::uuid[]) ORDER BY id',
        [controlIds]
      );
      const manifest = await proposal();
      await repository.applyWorkoutProgramConsolidation(f.ownerId, manifest);
      const beforeDeletion = await captureRawConsolidationGraph(f);
      const ownerGraph = await captureRawConsolidationGraph({
        ownerId: f.ownerId,
        delegateId: f.ownerId,
        unrelatedOwnerId: f.ownerId,
      });
      expect(
        (
          await client.query(
            'DELETE FROM public."user" WHERE id = $1 RETURNING id',
            [f.ownerId]
          )
        ).rows
      ).toStrictEqual([{ id: f.ownerId }]);
      const expectedAfterDeletion: ConsolidationGraph = {};
      for (const table of Object.keys(beforeDeletion)) {
        const ownerIds = new Set(rows(ownerGraph, table).map(rowId));
        expectedAfterDeletion[table] = rows(beforeDeletion, table).filter(
          (record) => !ownerIds.has(rowId(record))
        );
      }
      assertRawConsolidationGraphsEqual(
        expectedAfterDeletion,
        await captureRawConsolidationGraph(f)
      );
      expect(
        (
          await client.query<{ row: RawRow }>(
            'SELECT to_jsonb(t) AS row FROM public."user" t WHERE id = ANY($1::uuid[]) ORDER BY id',
            [controlIds]
          )
        ).rows
      ).toStrictEqual(controlsBefore.rows);
      await f.cleanup();
      fixture = undefined;
      expect(
        (
          await client.query(
            'SELECT id FROM public."user" WHERE id = ANY($1::uuid[])',
            [[f.ownerId, f.delegateId, f.unrelatedOwnerId]]
          )
        ).rows
      ).toStrictEqual([]);
      const emptyGraph: ConsolidationGraph = {};
      for (const table of Object.keys(beforeDeletion)) emptyGraph[table] = [];
      assertRawConsolidationGraphsEqual(
        emptyGraph,
        await captureRawConsolidationGraph(f)
      );
      expect(
        (
          await client.query<{ row: RawRow }>(
            'SELECT to_jsonb(t) AS row FROM public."user" t WHERE id = $1',
            [control.user.id]
          )
        ).rows
      ).toStrictEqual(
        controlsBefore.rows.filter(
          ({ row: account }) => account.id === control.user.id
        )
      );
    } finally {
      assertConsolidationDisposableDatabase();
      try {
        await client.query('DELETE FROM public."user" WHERE id = $1', [
          control.user.id,
        ]);
      } finally {
        client.release();
      }
    }
  }, 120_000);

  it('clones a prior receipt-protected source and rejects its normal library deletion with 409, preserving its rollback archive', async () => {
    assertConsolidationDisposableDatabase();
    const f = currentFixture();
    // Execution services intentionally load only inside this guarded database
    // test; static loading can initialize auth during DB-less collection.
    const { createWorkoutPlanTemplate, deleteWorkoutPlanTemplate } =
      await import('../services/workoutPlanTemplateService.js');
    const { saveProgram } =
      await import('../services/trainingProgramService.js');
    const sourcePlan = await createWorkoutPlanTemplate(f.ownerId, {
      plan_name: 'Receipt-only source without diary history',
      description: 'Exercise prescription retained for rollback',
      start_date: null,
      end_date: null,
      is_active: false,
      schedule_type: 'sequential',
      entry_mode: 'prompt',
      sessions: [
        {
          name: 'Receipt exact Session',
          day_of_week: null,
          sort_order: 0,
          is_optional: false,
          assignments: [
            {
              exercise_id: f.exerciseIds[0]!,
              sort_order: 0,
              sets: [
                {
                  set_number: 1,
                  set_type: 'working',
                  reps: 8,
                  weight: null,
                  rest_time: 60,
                  notes: 'Retain this unlogged prescription',
                  rpe: 7.5,
                  rir: 2,
                },
              ],
            },
          ],
        },
      ],
    });
    const miniProgram = await saveProgram(f.ownerId, {
      name: 'Receipt-only Program',
      goal: 'Protect an unlogged rollback archive',
      start_date: f.startDate,
      end_date: f.startDate,
      phases: [
        {
          name: 'Receipt phase',
          goal: 'Archive remains available',
          weeks: [
            {
              start_date: f.startDate,
              end_date: f.startDate,
              sessions: [
                {
                  name: 'Receipt occurrence',
                  scheduled_date: f.startDate,
                  workout_session_id: sourcePlan.sessions[0]!.id,
                },
              ],
            },
          ],
        },
      ],
    });
    extraProgramIds.push(miniProgram.id);
    const firstManifest = await proposal(miniProgram.id);
    expect(firstManifest.mapping.map((mapping) => mapping.mode)).toStrictEqual([
      'move',
    ]);
    const beforeFirst = await captureRawConsolidationGraph(f);
    const first = await repository.applyWorkoutProgramConsolidation(
      f.ownerId,
      firstManifest
    );
    const beforeSecond = await captureRawConsolidationGraph(f);
    assertConsolidationGraphPreserved(
      beforeFirst,
      beforeSecond,
      firstManifest,
      first
    );
    const secondManifest = await proposal(miniProgram.id);
    expect(
      secondManifest.mapping.map((mapping) => ({
        mode: mapping.mode,
        source_plan_id: mapping.source_plan_id,
      }))
    ).toStrictEqual([{ mode: 'clone', source_plan_id: first.target_plan_id }]);
    const second = await repository.applyWorkoutProgramConsolidation(
      f.ownerId,
      secondManifest
    );
    const after = await captureRawConsolidationGraph(f);
    assertConsolidationGraphPreserved(
      beforeSecond,
      after,
      secondManifest,
      second
    );
    const archivedSession = firstManifest.mapping[0]!.target_session_id;
    expect(
      rows(after, 'training_program_sessions').filter(
        (session) => session.workout_session_id === archivedSession
      )
    ).toStrictEqual([]);
    const archivedAssignments = new Set(
      firstManifest.mapping[0]!.assignments.map(
        (assignment) => assignment.target_assignment_id
      )
    );
    expect(
      rows(after, 'exercise_entries').filter((entry) =>
        archivedAssignments.has(Number(entry.workout_plan_assignment_id))
      )
    ).toStrictEqual([]);
    await expect(
      deleteWorkoutPlanTemplate(f.ownerId, first.target_plan_id)
    ).rejects.toMatchObject({ status: 409 });
    assertRawConsolidationGraphsEqual(
      after,
      await captureRawConsolidationGraph(f)
    );
  }, 120_000);
  it('retains two selected Planned Session relationships to one distinct exact source, without duplicating its prescription', async () => {
    const f = currentFixture();
    const aId = secondWeekA();
    const bId = f.plannedSessionIds.find(
      (id) => f.weekNumbers[id] === 2 && f.kinds[id] === 'B'
    );
    if (!bId) throw new Error('Fixture has no second-week B');
    await mutate(
      'UPDATE training_program_sessions SET workout_session_id = $2 WHERE id = $1',
      [bId, f.sourceSessionByPlannedSession[aId]]
    );
    const before = await captureRawConsolidationGraph(f);
    const manifest = await proposal();
    expect(manifest.mapping.length).toBe(56);
    const repeatedSource = manifest.mapping.find(
      (mapping) =>
        mapping.source_session_id === f.sourceSessionByPlannedSession[aId]
    );
    expect(repeatedSource?.planned_session_ids).toStrictEqual(
      [aId, bId].sort()
    );
    const result = await repository.applyWorkoutProgramConsolidation(
      f.ownerId,
      manifest
    );
    const after = await captureRawConsolidationGraph(f);
    assertConsolidationGraphPreserved(before, after, manifest, result);
    expect(
      row(after, 'training_program_sessions', aId).workout_session_id
    ).toBe(row(after, 'training_program_sessions', bId).workout_session_id);
  });

  it('consolidates workout sessions alongside a linked Cardio Test without changing the assessment', async () => {
    const f = currentFixture();
    const plannedId = randomUUID();
    const attemptId = randomUUID();
    await mutate(
      `INSERT INTO training_program_sessions
       (id, program_id, week_id, user_id, name, scheduled_date, effective_date, cardio_test_type, sort_order)
       VALUES ($1, $2, $3, $4, 'Cooper assessment', $5, $5, 'cooper_run', 99)`,
      [plannedId, f.programId, f.weekIds[0], f.ownerId, f.startDate]
    );
    await mutate(
      `INSERT INTO cardio_test_attempts
       (id, user_id, test_type, attempt_date, results, planned_session_id)
       VALUES ($1, $2, 'cooper_run', $3, '{"distance_meters":2500}'::jsonb, $4)`,
      [attemptId, f.ownerId, f.startDate, plannedId]
    );
    const before = await captureRawConsolidationGraph(f);
    const manifest = await proposal();
    expect(manifest.mapping).toHaveLength(f.sourceSessionIds.length);
    expect(
      manifest.mapping.flatMap((mapping) => mapping.planned_session_ids)
    ).not.toContain(plannedId);
    const result = await repository.applyWorkoutProgramConsolidation(
      f.ownerId,
      manifest
    );
    const after = await captureRawConsolidationGraph(f);
    assertConsolidationGraphPreserved(before, after, manifest, result);
    expect(row(after, 'training_program_sessions', plannedId)).toStrictEqual(
      row(before, 'training_program_sessions', plannedId)
    );
    expect(row(after, 'cardio_test_attempts', attemptId)).toStrictEqual(
      row(before, 'cardio_test_attempts', attemptId)
    );
  }, 120_000);

  it('reports that an assessment-only Program has no workouts to consolidate', async () => {
    const { saveProgram } =
      await import('../services/trainingProgramService.js');
    const f = currentFixture();
    const end = new Date(`${f.startDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    const program = await saveProgram(f.ownerId, {
      name: 'Assessments only',
      goal: 'Measure progress',
      start_date: f.startDate,
      end_date: end.toISOString().slice(0, 10),
      phases: [
        {
          name: 'Baseline',
          goal: 'Measure progress',
          weeks: [
            {
              start_date: f.startDate,
              end_date: end.toISOString().slice(0, 10),
              sessions: [
                {
                  name: 'Cooper assessment',
                  scheduled_date: f.startDate,
                  cardio_test_type: 'cooper_run',
                },
              ],
            },
          ],
        },
      ],
    });
    extraProgramIds.push(program.id);
    await withoutDataWrites(async () => {
      const preflight = await repository.preflightWorkoutProgramConsolidation(
        f.ownerId,
        {
          program_id: program.id,
          target_plan_name: 'No workout target needed',
        }
      );
      expect(preflight.blockers).toStrictEqual([
        'Selected Program has no Workout Sessions to consolidate.',
      ]);
      expect(preflight.proposal).toBeNull();
    });
  }, 120_000);

  it('rejects an approved target ID occupied by an unrelated actual library write, without undoing that write', async () => {
    const f = currentFixture();
    const manifest = await proposal();
    const client: PoolClient = await getClient(
      f.unrelatedOwnerId,
      f.unrelatedOwnerId
    );
    try {
      const created = await client.query<{ id: number }>(
        `INSERT INTO workout_plan_templates(user_id, plan_name, is_active)
         VALUES ($1, 'Unrelated independently authored plan', false) RETURNING id`,
        [f.unrelatedOwnerId]
      );
      expect(created.rows[0]?.id).toBe(manifest.target_plan.id);
    } finally {
      client.release();
    }
    await rejectWithoutWrites(manifest, { statuses: [409] });
  });
  it.for(['switched delegate', 'delegate own context', 'unrelated owner'])(
    'rejects %s without exposing or changing the owner Program',
    { timeout: 120_000 },
    async (actor) => {
      const f = currentFixture();
      const manifest = await proposal();
      const options =
        actor === 'switched delegate'
          ? {
              userId: f.ownerId,
              authenticatedUserId: f.delegateId,
              statuses: [404],
            }
          : {
              userId:
                actor === 'delegate own context'
                  ? f.delegateId
                  : f.unrelatedOwnerId,
              statuses: [404],
            };
      await rejectWithoutWrites(manifest, options);
      const before = await captureRawConsolidationGraph(f);
      await expect(
        repository.preflightWorkoutProgramConsolidation(
          options.userId,
          { program_id: f.programId, target_plan_name: 'Unauthorized target' },
          options.authenticatedUserId ?? options.userId
        )
      ).rejects.toMatchObject({ status: 404 });
      assertRawConsolidationGraphsEqual(
        before,
        await captureRawConsolidationGraph(f)
      );
    }
  );

  it.for([
    'unknown source UUID',
    'wrong source plan',
    'unknown Planned Session UUID',
    'unknown assignment',
    'cross-session assignment',
    'unknown set',
    'duplicate source',
    'changed occurrence order',
    'occupied clone UUID',
  ])(
    'rejects invalid exact mapping: %s, with no row writes',
    { timeout: 120_000 },
    async (invalid) => {
      const manifest = await proposal();
      const first = manifest.mapping[0]!;
      if (invalid === 'unknown source UUID')
        first.source_session_id = randomUUID();
      if (invalid === 'wrong source plan') first.source_plan_id = 2147483646;
      if (invalid === 'unknown Planned Session UUID')
        first.planned_session_ids = [randomUUID()];
      if (invalid === 'unknown assignment')
        first.assignments[0]!.source_assignment_id = 2147483646;
      if (invalid === 'cross-session assignment') {
        first.assignments[0]!.source_assignment_id =
          manifest.mapping[1]!.assignments[0]!.source_assignment_id;
      }
      if (invalid === 'unknown set') {
        const assignment = manifest.mapping
          .flatMap((mapping) => mapping.assignments)
          .find((candidate) => candidate.sets.length > 0);
        if (!assignment)
          throw new Error('Fixture has no local SQL set prescription');
        assignment.sets[0]!.source_set_id = 2147483646;
      }
      if (invalid === 'duplicate source')
        manifest.mapping.push(structuredClone(first));
      if (invalid === 'changed occurrence order') first.sort_order = 999;
      if (invalid === 'occupied clone UUID') {
        const clone = manifest.mapping.find(
          (mapping) => mapping.mode === 'clone'
        );
        if (!clone)
          throw new Error('Required future history did not protect its source');
        clone.target_session_id = first.source_session_id;
      }
      await rejectWithoutWrites(manifest, { statuses: [400] });
    }
  );

  it('rejects an existing owned Session outside the selected Program scope', async () => {
    const outsideSessionId = await addUnselectedSession();
    const manifest = await proposal();
    const mapping = manifest.mapping.find((candidate) =>
      candidate.planned_session_ids.includes(secondWeekA())
    )!;
    mapping.source_session_id = outsideSessionId;
    await rejectWithoutWrites(manifest, { statuses: [400] });
  });

  it('unknown Program preflight is read-only and does not select another Program', async () => {
    const f = currentFixture();
    const before = await captureRawConsolidationGraph(f);
    await expect(
      repository.preflightWorkoutProgramConsolidation(f.ownerId, {
        program_id: randomUUID(),
        target_plan_name: 'Missing Program must not fall back',
      })
    ).rejects.toMatchObject({ status: 404 });
    assertRawConsolidationGraphsEqual(
      before,
      await captureRawConsolidationGraph(f)
    );
  });

  it.for([
    'prescription',
    'binding',
    'performed history',
    'outside readership',
  ])(
    'rejects a stale %s revision instead of silently rebuilding the reviewed proposal',
    async (changed) => {
      const f = currentFixture();
      const manifest = await proposal();
      if (changed === 'prescription') {
        const assignment = manifest.mapping
          .flatMap((mapping) => mapping.assignments)
          .find((candidate) => candidate.sets.length > 0);
        if (!assignment) throw new Error('Fixture has no SQL sets');
        await mutate(
          "UPDATE workout_plan_assignment_sets SET notes = coalesce(notes, '') || ' reviewed prescription changed' WHERE id = $1",
          [assignment.sets[0]!.source_set_id]
        );
      }
      if (changed === 'binding') {
        await mutate(
          'UPDATE training_program_sessions SET workout_session_id = $2 WHERE id = $1',
          [
            secondWeekA(),
            f.sourceSessionByPlannedSession[f.plannedSessionIds[1]!],
          ]
        );
      }
      if (changed === 'performed history') {
        await mutate(
          "UPDATE exercise_entry_sets SET notes = coalesce(notes, '') || ' athlete corrected performed history' WHERE id = $1",
          [f.completedDiarySetIds[0]]
        );
      }
      if (changed === 'outside readership') {
        await mutate(
          `UPDATE family_access SET access_permissions = access_permissions || '{"can_view_exercise_library":true}'::jsonb
           WHERE owner_user_id = $1 AND family_user_id = $2`,
          [f.ownerId, f.delegateId]
        );
      }
      await rejectWithoutWrites(manifest, { statuses: [409] });
    }
  );

  it.for([
    'other Program',
    'active standalone',
    'unselected library Session',
    'family library reader',
  ])(
    'clones protected %s sources, preserving all original prescriptions and outside consumers',
    async (protection) => {
      const f = currentFixture();
      const selectedId = secondWeekA();
      const sourceSessionId = f.sourceSessionByPlannedSession[selectedId]!;
      if (protection === 'other Program') await addOutsideProgram();
      if (protection === 'active standalone') {
        await mutate(
          'UPDATE workout_plan_templates SET is_active = true WHERE id = $1',
          [f.sourcePlanByPlannedSession[selectedId]]
        );
      }
      if (protection === 'unselected library Session')
        await addUnselectedSession();
      if (protection === 'family library reader') {
        await mutate(
          `UPDATE family_access SET access_permissions = access_permissions || '{"can_view_exercise_library":true}'::jsonb
           WHERE owner_user_id = $1 AND family_user_id = $2`,
          [f.ownerId, f.delegateId]
        );
      }
      const before = await captureRawConsolidationGraph(f);
      const manifest = await proposal();
      const protectedMapping = manifest.mapping.find(
        (mapping) => mapping.source_session_id === sourceSessionId
      );
      expect(protectedMapping?.mode).toBe('clone');
      if (protection === 'family library reader') {
        expect(manifest.mapping.map((mapping) => mapping.mode)).toStrictEqual(
          Array(57).fill('clone')
        );
      }
      const result = await repository.applyWorkoutProgramConsolidation(
        f.ownerId,
        manifest
      );
      const after = await captureRawConsolidationGraph(f);
      assertConsolidationGraphPreserved(before, after, manifest, result);
      expect(
        row(after, 'workout_plan_sessions', sourceSessionId)
      ).toStrictEqual(row(before, 'workout_plan_sessions', sourceSessionId));
      expect(
        row(
          after,
          'workout_plan_templates',
          f.sourcePlanByPlannedSession[selectedId]!
        )
      ).toStrictEqual(
        row(
          before,
          'workout_plan_templates',
          f.sourcePlanByPlannedSession[selectedId]!
        )
      );
      if (protection === 'family library reader') {
        const reader: PoolClient = await getClient(f.ownerId, f.delegateId);
        try {
          expect(
            (
              await reader.query(
                'SELECT id, plan_name, start_date, end_date FROM workout_plan_templates WHERE id = $1',
                [result.target_plan_id]
              )
            ).rows
          ).toStrictEqual([
            {
              id: result.target_plan_id,
              plan_name: manifest.target_plan.name,
              start_date: null,
              end_date: null,
            },
          ]);
          expect(
            (
              await reader.query(
                'SELECT id, start_date, end_date FROM training_programs WHERE id = $1',
                [f.programId]
              )
            ).rows
          ).toStrictEqual([]);
        } finally {
          reader.release();
        }
      }
    }
  );

  it('cannot force a protected future diary prescription to move or retire its source plan', async () => {
    const f = currentFixture();
    const manifest = await proposal();
    const protectedMapping = manifest.mapping.find((mapping) =>
      mapping.planned_session_ids.includes(f.startedPlannedSessionId)
    );
    if (!protectedMapping)
      throw new Error('Required future started Session is missing');
    expect(protectedMapping.mode).toBe('clone');
    const forcedMove = structuredClone(manifest);
    const forcedMapping = forcedMove.mapping.find(
      (mapping) =>
        mapping.source_session_id === protectedMapping.source_session_id
    )!;
    forcedMapping.mode = 'move';
    forcedMapping.target_session_id = forcedMapping.source_session_id;
    for (const assignment of forcedMapping.assignments) {
      assignment.target_assignment_id = assignment.source_assignment_id;
      for (const set of assignment.sets) set.target_set_id = set.source_set_id;
    }
    await rejectWithoutWrites(forcedMove, { statuses: [409] });
    const unsafeRetirement = structuredClone(manifest);
    unsafeRetirement.retire_plan_ids = [protectedMapping.source_plan_id];
    await rejectWithoutWrites(unsafeRetirement, { statuses: [409] });
  });

  it('retires only an explicitly approved, now-empty unprotected move container', async () => {
    const f = currentFixture();
    const before = await captureRawConsolidationGraph(f);
    const manifest = await proposal();
    const mapping = manifest.mapping.find((candidate) =>
      candidate.planned_session_ids.includes(secondWeekA())
    )!;
    expect(mapping.mode).toBe('move');
    manifest.retire_plan_ids = [mapping.source_plan_id];
    const result = await repository.applyWorkoutProgramConsolidation(
      f.ownerId,
      manifest
    );
    const after = await captureRawConsolidationGraph(f);
    assertConsolidationGraphPreserved(before, after, manifest, result);
    expect(
      rows(after, 'workout_plan_templates').filter(
        (plan) => plan.id === mapping.source_plan_id
      )
    ).toStrictEqual([]);
    for (const planId of f.sourcePlanIds.filter(
      (id) => id !== mapping.source_plan_id
    )) {
      expect(row(after, 'workout_plan_templates', planId)).toStrictEqual(
        row(before, 'workout_plan_templates', planId)
      );
    }
  });

  it('rolls back a real post-write fault, replays the same approved manifest after sequence consumption, then repeats without writes', async () => {
    assertConsolidationDisposableDatabase();
    const f = currentFixture();
    const manifest = await proposal();
    const before = await captureRawConsolidationGraph(f);
    const sequencesBefore = await captureIdentitySequenceState();
    const first = manifest.mapping[0]!;
    const second = manifest.mapping[1]!;
    const suffix = randomUUID().replaceAll('-', '');
    const name = `consolidation14_fault_${suffix}`;
    const client: PoolClient = await getSystemClient();
    try {
      expect(
        (
          await client.query<{ database: string }>(
            'SELECT current_database() AS database'
          )
        ).rows
      ).toStrictEqual([{ database: process.env.SPARKY_FITNESS_DB_NAME }]);
      await client.query(`
        CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $fault$
        BEGIN
          IF NEW.user_id = '${f.ownerId}'::uuid AND NEW.id = '${second.target_session_id}'::uuid THEN
            IF EXISTS (
              SELECT 1 FROM workout_plan_sessions
              WHERE id = '${first.target_session_id}'::uuid
                AND user_id = '${f.ownerId}'::uuid
                AND template_id = ${manifest.target_plan.id}
            ) THEN
              RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'consolidation14_after_first_real_write';
            ELSE
              RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'consolidation14_fault_before_first_write';
            END IF;
          END IF;
          RETURN NEW;
        END;
        $fault$`);
      await client.query(`
        CREATE TRIGGER ${name} AFTER INSERT OR UPDATE ON public.workout_plan_sessions
        FOR EACH ROW EXECUTE FUNCTION public.${name}()`);
      await expect(
        repository.applyWorkoutProgramConsolidation(f.ownerId, manifest)
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('P0001'),
      });
      assertRawConsolidationGraphsEqual(
        before,
        await captureRawConsolidationGraph(f)
      );
      // nextval consumption survives rollback, but unused approved numeric
      // slots and an unchanged transactional graph permit the same approval.
      expect(await captureIdentitySequenceState()).not.toStrictEqual(
        sequencesBefore
      );
    } finally {
      assertConsolidationDisposableDatabase();
      try {
        await client.query(
          `DROP TRIGGER IF EXISTS ${name} ON public.workout_plan_sessions`
        );
        await client.query(`DROP FUNCTION IF EXISTS public.${name}()`);
      } finally {
        client.release();
      }
    }
    const applied = await repository.applyWorkoutProgramConsolidation(
      f.ownerId,
      manifest
    );
    expect(applied).toStrictEqual({
      operation_id: manifest.operation_id,
      target_plan_id: manifest.target_plan.id,
      already_applied: false,
      mapping: manifest.mapping,
    });
    const after = await captureRawConsolidationGraph(f);
    assertConsolidationGraphPreserved(before, after, manifest, applied);
    const repeated = await repository.applyWorkoutProgramConsolidation(
      f.ownerId,
      manifest
    );
    expect(repeated).toStrictEqual({ ...applied, already_applied: true });
    assertRawConsolidationGraphsEqual(
      after,
      await captureRawConsolidationGraph(f)
    );
  }, 120_000);
});
