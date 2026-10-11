import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  presetSessionResponseSchema,
  updatePresetSessionRequestSchema,
  workoutPlanPresetSnapshotSchema,
  workoutPlanSessionResponseSchema,
  workoutPresetCreateRequestSchema,
} from '@workspace/shared';
import type { WorkoutPlanAssignmentSetInput } from '@workspace/shared';

// Intentional test module-loading boundary: static pool/auth/service imports
// initialize database state and auth schema checks before the disposable guard
// when a DB-less suite merely collects this fixture. Lazy imports stay guarded.

export type ConsolidationGraph = Record<string, Record<string, unknown>[]>;
type SessionKind = 'A' | 'B' | 'C' | 'conditioning';

export interface ConsolidationFixture {
  ownerId: string;
  delegateId: string;
  unrelatedOwnerId: string;
  ownerToken: string;
  delegateToken: string;
  unrelatedOwnerToken: string;
  programId: string;
  phaseIds: string[];
  weekIds: string[];
  plannedSessionIds: string[];
  sourceSessionIds: string[];
  sourcePlanIds: number[];
  completedPlannedSessionId: string;
  startedPlannedSessionId: string;
  missedPlannedSessionId: string;
  optionalPlannedSessionId: string;
  diaryParentId: string;
  startedDiaryParentId: string;
  completedDiaryEntryIds: string[];
  startedDiaryEntryIds: string[];
  completedDiarySetIds: number[];
  startedDiarySetIds: number[];
  activityDetailIds: string[];
  exerciseIds: string[];
  presetId: number;
  startDate: string;
  endDate: string;
  kinds: Record<string, SessionKind>;
  weekNumbers: Record<string, number>;
  sourceSessionByPlannedSession: Record<string, string>;
  sourcePlanByPlannedSession: Record<string, number>;
  assignmentIdsBySourceSession: Record<string, number[]>;
  setIdsByAssignment: Record<number, number[]>;
  cleanup(): Promise<void>;
}

export function assertConsolidationDisposableDatabase(): void {
  const host = process.env.SPARKY_FITNESS_DB_HOST;
  const database = process.env.SPARKY_FITNESS_DB_NAME;
  if (
    process.env.RUN_CONSOLIDATION_DB !== '1' ||
    !host ||
    !['localhost', '127.0.0.1', '::1'].includes(host) ||
    !database ||
    !/^zfit_consolidation14_disposable(?:_[a-z0-9]+)?$/.test(database)
  ) {
    throw new Error(
      'Consolidation fixture requires RUN_CONSOLIDATION_DB=1, an explicit loopback SPARKY_FITNESS_DB_HOST, and SPARKY_FITNESS_DB_NAME=zfit_consolidation14_disposable[_suffix].'
    );
  }
}

async function assertConnectedDatabase(client: PoolClient): Promise<void> {
  assertConsolidationDisposableDatabase();
  const result = await client.query<{ database: string }>(
    'SELECT current_database() AS database'
  );
  if (result.rows[0]?.database !== process.env.SPARKY_FITNESS_DB_NAME) {
    throw new Error(
      'Consolidation fixture pool does not target the declared disposable database.'
    );
  }
}

const captureScopes = {
  training_programs: 't.user_id = $1',
  training_program_phases: 't.user_id = $1',
  training_program_weeks: 't.user_id = $1',
  training_program_sessions: 't.user_id = $1',
  workout_plan_templates: 't.user_id = $1',
  workout_plan_sessions: 't.user_id = $1',
  workout_plan_template_assignments:
    'EXISTS (SELECT 1 FROM workout_plan_templates p WHERE p.id = t.template_id AND p.user_id = $1)',
  workout_plan_assignment_sets:
    'EXISTS (SELECT 1 FROM workout_plan_template_assignments a JOIN workout_plan_templates p ON p.id = a.template_id WHERE a.id = t.assignment_id AND p.user_id = $1)',
  workout_presets: 't.user_id = $1',
  workout_preset_exercises:
    'EXISTS (SELECT 1 FROM workout_presets p WHERE p.id = t.workout_preset_id AND p.user_id = $1)',
  workout_preset_exercise_sets:
    'EXISTS (SELECT 1 FROM workout_preset_exercises e JOIN workout_presets p ON p.id = e.workout_preset_id WHERE e.id = t.workout_preset_exercise_id AND p.user_id = $1)',
  exercises: 't.user_id = $1',
  exercise_preset_entries: 't.user_id = $1',
  exercise_entries: 't.user_id = $1',
  exercise_entry_sets:
    'EXISTS (SELECT 1 FROM exercise_entries e WHERE e.id = t.exercise_entry_id AND e.user_id = $1)',
  exercise_entry_activity_details:
    'EXISTS (SELECT 1 FROM exercise_entries e WHERE e.id = t.exercise_entry_id AND e.user_id = $1) OR EXISTS (SELECT 1 FROM exercise_preset_entries p WHERE p.id = t.exercise_preset_entry_id AND p.user_id = $1)',
  family_access: 't.owner_user_id = $1',
  user_preferences: 't.user_id = $1',
  workout_program_consolidations: 't.user_id = $1',
} as const;

export const CONSOLIDATION_CAPTURE_TABLES = Object.keys(captureScopes);

export async function captureConsolidationGraph(
  fixture: Pick<
    ConsolidationFixture,
    'ownerId' | 'delegateId' | 'unrelatedOwnerId'
  >
): Promise<ConsolidationGraph> {
  assertConsolidationDisposableDatabase();
  const { getClient } = await import('../../db/poolManager.js');
  const client: PoolClient = await getClient(fixture.ownerId, fixture.ownerId);
  try {
    await assertConnectedDatabase(client);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const graph: ConsolidationGraph = {};
    for (const table of CONSOLIDATION_CAPTURE_TABLES) graph[table] = [];
    for (const userId of [
      fixture.ownerId,
      fixture.delegateId,
      fixture.unrelatedOwnerId,
    ]) {
      await client.query('SELECT set_app_context($1, $2)', [userId, userId]);
      for (const [table, scope] of Object.entries(captureScopes)) {
        const rows = await client.query<{ row: Record<string, unknown> }>(
          `SELECT to_jsonb(t) AS row FROM ${table} t WHERE ${scope} ORDER BY to_jsonb(t)::text`,
          [userId]
        );
        graph[table].push(...rows.rows.map(({ row }) => row));
      }
    }
    await client.query('COMMIT');
    return graph;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupAccounts(userIds: readonly string[]): Promise<void> {
  assertConsolidationDisposableDatabase();
  if (!userIds.length) return;
  const { getSystemClient } = await import('../../db/poolManager.js');
  const client: PoolClient = await getSystemClient();
  try {
    await assertConnectedDatabase(client);
    await client.query('BEGIN');
    // Programs cascade their journals; diary must precede restrictive source deletion.
    for (const table of [
      'training_programs',
      'exercise_entries',
      'exercise_preset_entries',
      'workout_plan_templates',
      'workout_presets',
      'exercises',
    ]) {
      await client.query(
        `DELETE FROM ${table} WHERE user_id = ANY($1::uuid[])`,
        [userIds]
      );
    }
    await client.query(
      'DELETE FROM family_access WHERE owner_user_id = ANY($1::uuid[]) OR family_user_id = ANY($1::uuid[])',
      [userIds]
    );
    await client.query('DELETE FROM public."user" WHERE id = ANY($1::uuid[])', [
      userIds,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function dateAfter(start: string, days: number): string {
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function startMonday(requested?: string): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7) - 7);
  const start = z.iso.date().parse(requested ?? now.toISOString().slice(0, 10));
  if (new Date(`${start}T00:00:00.000Z`).getUTCDay() !== 1) {
    throw new Error(
      'Consolidation fixture startDate must be a Monday in YYYY-MM-DD format.'
    );
  }
  return start;
}

function prescriptionSets(
  week: number,
  kind: SessionKind,
  slot: number,
  exerciseOrder: number
): WorkoutPlanAssignmentSetInput[] {
  return Array.from({ length: week % 2 === 1 ? 2 : 3 }, (_, index) => {
    const cardio = kind === 'conditioning';
    return {
      set_number: index + 1,
      set_type: index === 0 && week % 3 === 0 ? 'warmup' : 'working',
      reps: cardio ? null : 8,
      ...(index % 3 === 0
        ? { weight: null }
        : index % 3 === 1
          ? { weight: cardio ? null : 20 + week * 0.5 + exerciseOrder * 1.25 }
          : {}),
      duration: cardio ? 60 + week * 5 + slot * 10 + index * 15 : null,
      ...(cardio ? { distance: 0.2 + week * 0.01 + index * 0.025 } : {}),
      rest_time: 45 + week + exerciseOrder * 5 + index * 10,
      notes: `W${week} ${kind} slot ${slot}; ${cardio ? 'steady interval' : '8-10 reps each side'}; set ${index + 1}`,
      rpe: 6.5 + ((week + slot + exerciseOrder) % 3) * 0.5,
      rir: 1.5 + ((week + index) % 3) * 0.5,
      per_side: !cardio,
      rep_range: cardio ? null : { min: 8, max: 10 },
      instructions: [
        `Preserve week ${week} prescription`,
        'Do not refresh from library',
      ],
    };
  });
}

interface SourceSession {
  week: number;
  kind: SessionKind;
  slot: number;
  date: string;
  planId: number;
  sessionId: string;
}

export async function seedConsolidationFixture(
  options: { startDate?: string } = {}
): Promise<ConsolidationFixture> {
  assertConsolidationDisposableDatabase();
  const startDate = startMonday(options.startDate);
  const endDate = dateAfter(startDate, 83);
  const { getClient, getSystemClient } =
    await import('../../db/poolManager.js');
  const systemClient: PoolClient = await getSystemClient();
  try {
    await assertConnectedDatabase(systemClient);
  } finally {
    systemClient.release();
  }
  const roleClient: PoolClient = await getClient(randomUUID());
  try {
    await assertConnectedDatabase(roleClient);
    const role = await roleClient.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'
    );
    if (!role.rows[0] || role.rows[0].rolsuper || role.rows[0].rolbypassrls) {
      throw new Error(
        'Consolidation fixture requires a non-superuser, non-BYPASSRLS application role.'
      );
    }
  } finally {
    roleClient.release();
  }

  const userIds: string[] = [];
  try {
    // Auth's module performs schema checks: never import it before the guard.
    const { auth } = await import('../../auth.js');
    const accounts: { id: string; token: string; email: string }[] = [];
    for (const label of ['owner', 'delegate', 'unrelated']) {
      const email = `consolidation14-${label}-${randomUUID()}@example.test`;
      const account = await auth.api.signUpEmail({
        body: {
          name: `Consolidation fixture ${label}`,
          email,
          password: randomBytes(24).toString('base64'),
        },
      });
      userIds.push(account.user.id);
      if (!account.token)
        throw new Error(
          'Consolidation fixture signup did not create an authenticated session.'
        );
      accounts.push({ id: account.user.id, token: account.token, email });
    }
    const [owner, delegate, unrelated] = accounts;
    const { bootstrapUserTimezoneIfUnset, updateUserPreferences } =
      await import('../../models/preferenceRepository.js');
    for (const account of accounts) {
      await bootstrapUserTimezoneIfUnset(account.id, 'UTC');
      await updateUserPreferences(account.id, { timezone: 'UTC' });
    }
    const grantClient: PoolClient = await getClient(owner.id, owner.id);
    try {
      await grantClient.query(
        `INSERT INTO family_access
          (owner_user_id, family_user_id, family_email, access_permissions, access_end_date, is_active, status)
         VALUES ($1, $2, $3, $4::jsonb, NULL, TRUE, 'active')`,
        [
          owner.id,
          delegate.id,
          delegate.email,
          JSON.stringify({ can_manage_checkin: true }),
        ]
      );
    } finally {
      grantClient.release();
    }

    const exerciseService = await import('../../services/exerciseService.js');
    const { createWorkoutPreset } =
      await import('../../services/workoutPresetService.js');
    const { createWorkoutPlanTemplate } =
      await import('../../services/workoutPlanTemplateService.js');
    const { saveProgram, recordProgramOutcome } =
      await import('../../services/trainingProgramService.js');
    const { createActivityDetail } =
      await import('../../models/activityDetailsRepository.js');
    const exerciseNames = [
      'TRX split squat',
      'One-arm dumbbell row',
      'Goblet squat',
      'Bike intervals',
      'Easy run',
      'Row erg',
    ];
    const exerciseIds: string[] = [];
    for (const [index, name] of exerciseNames.entries()) {
      const created = await exerciseService.createExercise(owner.id, {
        name,
        category: index < 3 ? 'Strength' : 'Cardio',
        modality:
          index === 0
            ? 'bodyweight_reps'
            : index < 3
              ? 'weight_reps'
              : 'duration_distance',
        primary_muscles: index < 3 ? ['quadriceps'] : ['cardiovascular system'],
        secondary_muscles: ['core'],
        equipment:
          index === 0
            ? ['suspension trainer']
            : index < 3
              ? ['dumbbell']
              : ['ergometer'],
        instructions: ['Synthetic disposable prescription', 'Controlled tempo'],
        images: [],
        source: 'custom',
        is_custom: true,
        shared_with_public: false,
        calories_per_hour: index < 3 ? 240 : 480,
      });
      exerciseIds.push(z.object({ id: z.uuid() }).parse(created).id);
    }
    const preset = await createWorkoutPreset(
      owner.id,
      workoutPresetCreateRequestSchema.parse({
        name: 'Private source preset — local snapshots deliberately differ',
        description:
          'Library defaults are not the authored local prescriptions.',
        is_public: false,
        workout_format: 'standard',
        time_cap_seconds: 900,
        exercises: [0, 1].map((index) => ({
          exercise_id: exerciseIds[index],
          sort_order: index,
          superset_group: null,
          progression_mode: 'fixed',
          sets: [
            {
              set_number: 1,
              set_type: 'working',
              reps: 5,
              weight: null,
              rest_time: 30,
            },
          ],
        })),
      })
    );
    const presetId = z
      .object({ id: z.number().int().positive() })
      .parse(preset).id;
    const sources: SourceSession[] = [];
    const assignmentIdsBySourceSession: Record<string, number[]> = {};
    const setIdsByAssignment: Record<number, number[]> = {};
    const formats = [
      'standard',
      'interval',
      'tabata',
      'amrap',
      'emom',
      'for_time',
    ] as const;
    for (let week = 1; week <= 12; week++) {
      const kinds: SessionKind[] = ['A', 'conditioning', 'B'];
      if (![4, 8, 12].includes(week)) kinds.push('C');
      kinds.push('conditioning');
      for (const [slot, kind] of kinds.entries()) {
        const cardio = kind === 'conditioning';
        const date = dateAfter(startDate, (week - 1) * 7 + (slot < 2 ? 0 : 3));
        const exerciseIndexes = cardio ? [3, 4, 5] : [0, 1, 2];
        const snapshot = workoutPlanPresetSnapshotSchema.parse({
          id: presetId,
          name: `${kind} local prescription week ${week} slot ${slot}`,
          description:
            week % 3 === 0
              ? null
              : `Authored ${kind} instructions for week ${week}`,
          workout_format: formats[(week + slot) % formats.length],
          ...(slot % 3 === 0
            ? {}
            : { time_cap_seconds: slot % 3 === 1 ? null : 600 + week * 30 }),
          authored_week: week,
          per_side: !cardio,
          instructions: [
            'Local-only edit',
            `Keep ${kind} week ${week} distinct`,
          ],
          exercises: exerciseIndexes
            .slice(0, 2)
            .map((exerciseIndex, order) => ({
              exercise_id: exerciseIds[exerciseIndex],
              exercise_name: exerciseNames[exerciseIndex],
              image_url: null,
              category: cardio ? 'Cardio' : 'Strength',
              modality:
                exerciseIndex === 0
                  ? 'bodyweight_reps'
                  : cardio
                    ? 'duration_distance'
                    : 'weight_reps',
              sort_order: order,
              superset_group: week % 2 === 0 ? 1 : null,
              progression_mode: week % 2 === 0 ? 'rep_goal' : 'fixed',
              rep_goal: week % 2 === 0 ? 24 : null,
              increment_type: week % 2 === 0 ? 'weight' : null,
              increment_value: week % 2 === 0 ? 1.25 : null,
              equipment_brand:
                order === 0 ? null : 'Synthetic adjustable dumbbell',
              ramp_increment: week % 3 === 0 ? 0.5 : null,
              instructions: [`${kind} week ${week}; exercise order ${order}`],
              per_side: !cardio,
              sets: prescriptionSets(week, kind, slot, order),
            })),
        });
        const plan = await createWorkoutPlanTemplate(owner.id, {
          plan_name: `Fragmented ${kind} week ${week} slot ${slot}`,
          description: `Independent original container for ${kind}, week ${week}, slot ${slot}`,
          start_date: startDate,
          end_date: endDate,
          is_active: false,
          schedule_type: 'sequential',
          entry_mode: 'prompt',
          sessions: [
            {
              name: kind,
              day_of_week: null,
              sort_order: 0,
              is_optional: kind === 'A' && week % 2 === 1,
              assignments: [
                {
                  exercise_id: exerciseIds[exerciseIndexes[2]],
                  sort_order: week % 2 === 0 ? 1 : 0,
                  sets: prescriptionSets(week, kind, slot, 2),
                },
                {
                  workout_preset_id: presetId,
                  sort_order: week % 2 === 0 ? 0 : 1,
                  preset_snapshot: snapshot,
                },
              ],
            },
          ],
        });
        // This is the persisted repository result, not a client-generated UUID.
        const session = workoutPlanSessionResponseSchema.parse(
          plan.sessions[0]
        );
        sources.push({
          week,
          kind,
          slot,
          date,
          planId: plan.id,
          sessionId: session.id,
        });
        assignmentIdsBySourceSession[session.id] = session.assignments.map(
          ({ id }) => id
        );
        for (const assignment of session.assignments) {
          setIdsByAssignment[assignment.id] = assignment.sets.map(({ id }) =>
            z.number().int().positive().parse(id)
          );
        }
      }
    }
    const program = await saveProgram(owner.id, {
      name: 'Twelve-week fragmented Program',
      goal: 'Preserve authored strength and conditioning prescriptions during consolidation',
      start_date: startDate,
      end_date: endDate,
      schedule_type: 'fixed',
      auto_shift: false,
      phases: Array.from({ length: 3 }, (_, phase) => ({
        name: `Phase ${phase + 1}`,
        goal: ['Accumulate', 'Build', 'Consolidate'][phase],
        weeks: Array.from({ length: 4 }, (_, offset) => {
          const week = phase * 4 + offset + 1;
          return {
            start_date: dateAfter(startDate, (week - 1) * 7),
            end_date: dateAfter(startDate, week * 7 - 1),
            sessions: sources
              .filter((source) => source.week === week)
              .map((source) => ({
                name: source.kind,
                scheduled_date: source.date,
                workout_session_id: source.sessionId,
                is_optional: source.kind === 'C',
              })),
          };
        }),
      })),
    });
    const weeks = program.phases.flatMap((phase) => phase.weeks);
    const planned = weeks.flatMap((week) => week.sessions);
    const sourceSessionByPlannedSession: Record<string, string> = {};
    const sourcePlanByPlannedSession: Record<string, number> = {};
    const kinds: Record<string, SessionKind> = {};
    const weekNumbers: Record<string, number> = {};
    for (const [index, session] of planned.entries()) {
      const source = sources[index];
      if (!source || session.workout_session_id !== source.sessionId) {
        throw new Error(
          'Consolidation fixture persisted Program order/identity differs from authored source links.'
        );
      }
      sourceSessionByPlannedSession[session.id] = source.sessionId;
      sourcePlanByPlannedSession[session.id] = source.planId;
      kinds[session.id] = source.kind;
      weekNumbers[session.id] = source.week;
    }
    const findPlanned = (week: number, kind: SessionKind) => {
      const session = planned.find(
        (row) => weekNumbers[row.id] === week && kinds[row.id] === kind
      );
      if (!session)
        throw new Error(`Consolidation fixture missing week ${week} ${kind}.`);
      return session;
    };
    const completed = findPlanned(1, 'A');
    const missed = findPlanned(1, 'B');
    const optional = findPlanned(1, 'C');
    const started = findPlanned(12, 'B');
    const completedStart = await exerciseService.logWorkoutPlanSession(
      owner.id,
      owner.id,
      sourceSessionByPlannedSession[completed.id],
      startDate
    );
    const completedSession = presetSessionResponseSchema.parse(
      completedStart.session
    );
    await exerciseService.updateGroupedWorkoutSession(
      owner.id,
      owner.id,
      completedSession.id,
      updatePresetSessionRequestSchema.parse({
        notes:
          'Performed results deliberately differ from the immutable prescription.',
        location: 'Disposable rehearsal gym',
        exercises: completedSession.exercises.map((entry, order) => ({
          id: entry.id,
          exercise_id: entry.exercise_id,
          sort_order: order,
          duration_minutes: 7 + order,
          notes: `Actually performed exercise ${order + 1}`,
          superset_group: entry.superset_group ?? null,
          workout_plan_assignment_id: entry.workout_plan_assignment_id,
          sets: entry.sets.map((set, index) => ({
            id: set.id,
            set_number: set.set_number,
            set_type: set.set_type,
            reps: 9 + index,
            weight: 23.75 + order * 1.25,
            duration: null,
            rest_time: 70 + index,
            rpe: 8.5,
            rir: 1.5,
            notes:
              'Actual result; never copy back into the saved prescription.',
            completed_at: `${startDate}T12:34:56.000Z`,
          })),
        })),
      })
    );
    await recordProgramOutcome(owner.id, program.id, completed.id, {
      status: 'completed',
      workout: { type: 'preset', id: completedSession.id },
    });
    await recordProgramOutcome(owner.id, program.id, missed.id, {
      status: 'missed',
    });
    const startedSource = sources.find(
      (source) => source.sessionId === sourceSessionByPlannedSession[started.id]
    );
    if (!startedSource)
      throw new Error('Consolidation fixture missing started source.');
    const startedResult = await exerciseService.logWorkoutPlanSession(
      owner.id,
      owner.id,
      startedSource.sessionId,
      startedSource.date
    );
    const startedSession = presetSessionResponseSchema.parse(
      startedResult.session
    );
    // No completion outcome is recorded for this link: it requires a clone.
    for (const [parentId, state] of [
      [completedSession.id, 'completed'],
      [startedSession.id, 'started'],
    ] as const) {
      await createActivityDetail(owner.id, {
        exercise_entry_id: null,
        exercise_preset_entry_id: parentId,
        provider_name: 'Disposable fixture watch',
        detail_type: 'full_workout_data',
        detail_data: {
          state,
          source: 'synthetic rehearsal only',
          readings: [
            { seconds: 0, heart_rate: 91 },
            { seconds: 31, heart_rate: 137 },
          ],
          effort: { rpe: 8.5, rir: 1.5 },
          unknown_local_field: {
            preserve: true,
            nullable: null,
            values: [0, 1.25, false],
          },
        },
        created_by_user_id: owner.id,
        updated_by_user_id: owner.id,
      });
    }
    const diaryClient: PoolClient = await getClient(owner.id, owner.id);
    let activityDetailIds: string[];
    let completedDiarySetIds: number[];
    let startedDiarySetIds: number[];
    try {
      const details = await diaryClient.query<{ id: string }>(
        'SELECT id FROM exercise_entry_activity_details WHERE exercise_preset_entry_id = ANY($1::uuid[]) ORDER BY id',
        [[completedSession.id, startedSession.id]]
      );
      activityDetailIds = details.rows.map(({ id }) => id);
      const sets = await diaryClient.query<{ id: number; parent_id: string }>(
        `SELECT s.id, e.exercise_preset_entry_id AS parent_id
         FROM exercise_entry_sets s JOIN exercise_entries e ON e.id = s.exercise_entry_id
         WHERE e.exercise_preset_entry_id = ANY($1::uuid[]) ORDER BY s.id`,
        [[completedSession.id, startedSession.id]]
      );
      completedDiarySetIds = sets.rows
        .filter((row) => row.parent_id === completedSession.id)
        .map(({ id }) => id);
      startedDiarySetIds = sets.rows
        .filter((row) => row.parent_id === startedSession.id)
        .map(({ id }) => id);
    } finally {
      diaryClient.release();
    }
    return {
      ownerId: owner.id,
      delegateId: delegate.id,
      unrelatedOwnerId: unrelated.id,
      ownerToken: owner.token,
      delegateToken: delegate.token,
      unrelatedOwnerToken: unrelated.token,
      programId: program.id,
      phaseIds: program.phases.map(({ id }) => id),
      weekIds: weeks.map(({ id }) => id),
      plannedSessionIds: planned.map(({ id }) => id),
      sourceSessionIds: sources.map(({ sessionId }) => sessionId),
      sourcePlanIds: sources.map(({ planId }) => planId),
      completedPlannedSessionId: completed.id,
      startedPlannedSessionId: started.id,
      missedPlannedSessionId: missed.id,
      optionalPlannedSessionId: optional.id,
      diaryParentId: completedSession.id,
      startedDiaryParentId: startedSession.id,
      completedDiaryEntryIds: completedSession.exercises.map(({ id }) => id),
      startedDiaryEntryIds: startedSession.exercises.map(({ id }) => id),
      completedDiarySetIds,
      startedDiarySetIds,
      activityDetailIds,
      exerciseIds,
      presetId,
      startDate,
      endDate,
      kinds,
      weekNumbers,
      sourceSessionByPlannedSession,
      sourcePlanByPlannedSession,
      assignmentIdsBySourceSession,
      setIdsByAssignment,
      cleanup: () => cleanupAccounts(userIds),
    };
  } catch (error) {
    try {
      await cleanupAccounts(userIds);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Consolidation fixture seed and guarded cleanup failed.',
        { cause: cleanupError }
      );
    }
    throw error;
  }
}
