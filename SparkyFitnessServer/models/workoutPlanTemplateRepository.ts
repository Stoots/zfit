import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { getClient } from '../db/poolManager.js';
import { HttpError } from '../utils/errors.js';
import {
  workoutPlanCreateRequestSchema,
  workoutPlanUpdateRequestSchema,
  workoutPlanPresetSnapshotSchema,
  workoutPlanBulkRequestSchema,
  workoutPlanBulkApplyRequestSchema,
  isValidTimeZone,
  todayInZone,
  type WorkoutPlanBulkRequest,
  type WorkoutPlanBulkApplyRequest,
  type WorkoutPlanBulkCandidate,
  type WorkoutPlanBulkPreview,
  type WorkoutPlanBulkBinding,
  type WorkoutPlanAssignmentInput,
  type WorkoutPlanAssignmentSetInput,
  type WorkoutPlanAssignmentResponse,
  type WorkoutPlanSessionInput,
  type WorkoutPlanSessionResponse,
  type WorkoutPlanCreateRequest,
  type WorkoutPlanUpdateRequest,
  type WorkoutPlanResponse,
  type WorkoutPlanPresetSnapshot,
} from '@workspace/shared';
import { createExerciseEntriesFromTemplate } from './exerciseTemplate.js';
import { computeSequentialPlanProgression } from '../services/workoutPlanProgression.js';

export type {
  WorkoutPlanAssignmentInput,
  WorkoutPlanAssignmentSetInput,
  WorkoutPlanSessionInput,
};
export type WorkoutPlanTemplateCreateInput = WorkoutPlanCreateRequest & {
  user_id: string;
};
export type WorkoutPlanTemplateUpdateInput = WorkoutPlanUpdateRequest;
export type WorkoutPlanAssignmentRow = WorkoutPlanAssignmentResponse;
export type WorkoutPlanSessionRow = WorkoutPlanSessionResponse;
export type WorkoutPlanTemplateRow = Omit<
  WorkoutPlanResponse,
  'created_at' | 'updated_at'
> & {
  created_at?: string | Date;
  updated_at?: string | Date;
};

interface LoggedPlanAssignmentRow {
  id: string;
  workout_plan_assignment_id: number;
  entry_date: string;
  created_at: Date | null;
}

function conflict(message: string): never {
  throw new HttpError(message, 409);
}
function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

const planSelect = `SELECT t.*, COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', s.name, 'day_of_week', s.day_of_week, 'sort_order', s.sort_order,
    'is_optional', s.is_optional,
    'assignments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'workout_session_id', a.workout_session_id, 'sort_order', COALESCE(a.sort_order, 0),
        'workout_preset_id', a.workout_preset_id, 'preset_snapshot', a.preset_snapshot,
        'workout_preset_name', a.preset_snapshot->>'name', 'workout_preset_format', a.preset_snapshot->>'workout_format',
        'exercise_id', a.exercise_id, 'exercise_name', e.name, 'modality', e.modality,
        'sets', COALESCE((
          SELECT jsonb_agg(ps.prescription || (to_jsonb(ps) - 'assignment_id' - 'created_at' - 'updated_at' - 'prescription') ORDER BY ps.set_number, ps.id)
          FROM workout_plan_assignment_sets ps WHERE ps.assignment_id = a.id
        ), '[]'::jsonb)
      ) ORDER BY a.sort_order NULLS LAST, a.id)
      FROM workout_plan_template_assignments a LEFT JOIN exercises e ON e.id = a.exercise_id
      WHERE a.workout_session_id = s.id AND a.template_id = t.id AND a.user_id = s.user_id
    ), '[]'::jsonb)
  ) ORDER BY s.sort_order, s.id) FROM workout_plan_sessions s WHERE s.template_id = t.id AND s.user_id = t.user_id
), '[]'::jsonb) AS sessions FROM workout_plan_templates t`;

async function readPlans(
  client: PoolClient,
  where: string,
  values: unknown[]
): Promise<WorkoutPlanTemplateRow[]> {
  const result = await client.query<WorkoutPlanTemplateRow>(
    `${planSelect} ${where}`,
    values
  );
  return result.rows;
}

async function validateLibraryReferences(
  client: PoolClient,
  assignment: WorkoutPlanAssignmentInput,
  previous?: WorkoutPlanAssignmentRow
): Promise<WorkoutPlanPresetSnapshot | null> {
  if (assignment.exercise_id) {
    const exercise = await client.query(
      'SELECT id FROM exercises WHERE id = $1 FOR KEY SHARE',
      [assignment.exercise_id]
    );
    if (!exercise.rowCount) invalid('Exercise not found or not accessible.');
    return null;
  }
  // Omission keeps the previously frozen prescription. Even a library edit or
  // deletion must not refresh it while an unrelated session/plan field is saved.
  let snapshot = assignment.preset_snapshot;
  const samePreset =
    previous &&
    previous.workout_preset_id === (assignment.workout_preset_id ?? null);
  if (!snapshot && samePreset && previous.preset_snapshot)
    return previous.preset_snapshot;
  if (
    samePreset &&
    snapshot &&
    previous.preset_snapshot &&
    isDeepStrictEqual(snapshot, previous.preset_snapshot)
  )
    return previous.preset_snapshot;
  if (assignment.workout_preset_id && !samePreset) {
    const preset = await client.query(
      'SELECT id FROM workout_presets WHERE id = $1 FOR KEY SHARE',
      [assignment.workout_preset_id]
    );
    if (!preset.rowCount)
      invalid('Workout preset not found or not accessible.');
  }
  if (!snapshot)
    invalid(
      'New or changed preset assignments require an explicit local preset_snapshot.'
    );
  snapshot = workoutPlanPresetSnapshotSchema.parse(snapshot);
  if (
    previous?.preset_snapshot &&
    isDeepStrictEqual(snapshot, previous.preset_snapshot)
  )
    return snapshot;
  for (const exercise of snapshot.exercises) {
    const accessible = await client.query<{ exercise_name: string }>(
      `SELECT public.normalize_exercise_name_initial($2) AS exercise_name
         FROM exercises WHERE id = $1 FOR KEY SHARE`,
      [exercise.exercise_id, exercise.exercise_name]
    );
    if (!accessible.rowCount)
      invalid('Snapshot exercise not found or not accessible.');
    exercise.exercise_name = accessible.rows[0]!.exercise_name;
  }
  return snapshot;
}

async function saveAssignmentSets(
  client: PoolClient,
  assignmentId: number,
  sets: WorkoutPlanAssignmentSetInput[]
): Promise<void> {
  const existing = await client.query<{ id: number; set_number: number }>(
    'SELECT id, set_number FROM workout_plan_assignment_sets WHERE assignment_id = $1 ORDER BY id FOR UPDATE',
    [assignmentId]
  );
  const byId = new Map(existing.rows.map((row) => [row.id, row]));
  const retained = new Set<number>();
  for (const set of sets) {
    const row =
      set.id !== undefined
        ? byId.get(set.id)
        : existing.rows.find(
            (candidate) =>
              candidate.set_number === set.set_number &&
              !retained.has(candidate.id)
          );
    if (set.id !== undefined && !row)
      invalid('A supplied set ID does not belong to this assignment.');
    if (row && retained.has(row.id))
      invalid('Set IDs must be unique within an assignment.');
    const { id: _id, ...prescription } = set;
    const values = [
      assignmentId,
      set.set_number,
      set.set_type ?? null,
      set.reps ?? null,
      set.weight ?? null,
      set.duration ?? null,
      set.distance ?? null,
      set.rest_time ?? null,
      set.notes ?? null,
      JSON.stringify(prescription),
    ];
    if (row) {
      await client.query(
        `UPDATE workout_plan_assignment_sets SET set_number = $2, set_type = $3, reps = $4, weight = $5,
        duration = $6, distance = $7, rest_time = $8, notes = $9, prescription = $10::jsonb
        WHERE assignment_id = $1 AND id = $11`,
        [...values, row.id]
      );
      retained.add(row.id);
    } else {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO workout_plan_assignment_sets
        (assignment_id, set_number, set_type, reps, weight, duration, distance, rest_time, notes, prescription)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING id`,
        values
      );
      retained.add(inserted.rows[0]!.id);
    }
  }
  await client.query(
    'DELETE FROM workout_plan_assignment_sets WHERE assignment_id = $1 AND NOT (id = ANY($2::integer[]))',
    [assignmentId, [...retained]]
  );
}

async function saveSessions(
  client: PoolClient,
  planId: number,
  userId: string,
  sessions: WorkoutPlanSessionInput[],
  previous: WorkoutPlanSessionRow[],
  scheduleType: 'weekly' | 'sequential'
): Promise<void> {
  const existingSessions = new Map(
    previous.map((session) => [session.id, session])
  );
  const existingAssignments = new Map(
    previous.flatMap((session) =>
      session.assignments.map(
        (assignment) => [assignment.id, assignment] as const
      )
    )
  );
  const retainedSessions = new Set<string>();
  const retainedAssignments = new Set<number>();
  // Validate all supplied identities before any child mutation. Supplied IDs are
  // never interpreted as authority to update an arbitrary accessible plan row.
  for (const session of sessions) {
    if (
      session.id &&
      (!existingSessions.has(session.id) || retainedSessions.has(session.id))
    )
      invalid(
        'A supplied session ID does not belong to this plan or is duplicated.'
      );
    if (session.id) retainedSessions.add(session.id);
    if (scheduleType === 'sequential' && session.day_of_week !== null)
      invalid('Sequential sessions must have a null weekday.');
    for (const assignment of session.assignments) {
      if (assignment.id !== undefined) {
        const old = existingAssignments.get(assignment.id);
        if (
          !old ||
          old.workout_session_id !== session.id ||
          retainedAssignments.has(assignment.id)
        )
          invalid(
            'A supplied assignment ID does not belong to this session and plan or is duplicated.'
          );
        retainedAssignments.add(assignment.id);
        if (
          old.exercise_id !== (assignment.exercise_id ?? null) ||
          old.workout_preset_id !== (assignment.workout_preset_id ?? null)
        ) {
          const linked = await client.query(
            'SELECT 1 FROM exercise_entries WHERE workout_plan_assignment_id = $1 LIMIT 1',
            [assignment.id]
          );
          if (linked.rowCount)
            conflict(
              'A diary-linked assignment cannot be changed to another exercise or preset. Create a new assignment instead.'
            );
        }
      }
    }
  }
  const removedSessions = previous
    .filter((session) => !retainedSessions.has(session.id))
    .map((session) => session.id);
  const removedAssignments = [...existingAssignments.keys()].filter(
    (id) => !retainedAssignments.has(id)
  );
  if (removedSessions.length) {
    const referenced = await client.query(
      'SELECT 1 FROM training_program_sessions WHERE workout_session_id = ANY($1::uuid[]) LIMIT 1',
      [removedSessions]
    );
    if (referenced.rowCount)
      conflict(
        'Remove the exact Workout Session references from Training Programs before deleting a session.'
      );
  }
  if (removedAssignments.length) {
    const linked = await client.query(
      'SELECT 1 FROM exercise_entries WHERE workout_plan_assignment_id = ANY($1::integer[]) LIMIT 1',
      [removedAssignments]
    );
    if (linked.rowCount)
      conflict(
        'Diary-linked assignments cannot be removed; their identity and history links must be retained.'
      );
  }
  for (const session of sessions) {
    const sessionId = session.id ?? randomUUID();
    if (session.id) {
      await client.query(
        'UPDATE workout_plan_sessions SET name = $4, day_of_week = $5, sort_order = $6, is_optional = $7 WHERE id = $1 AND template_id = $2 AND user_id = $3',
        [
          sessionId,
          planId,
          userId,
          session.name,
          session.day_of_week,
          session.sort_order,
          session.is_optional,
        ]
      );
    } else {
      await client.query(
        'INSERT INTO workout_plan_sessions (id, template_id, user_id, name, day_of_week, sort_order, is_optional) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          sessionId,
          planId,
          userId,
          session.name,
          session.day_of_week,
          session.sort_order,
          session.is_optional,
        ]
      );
    }
    for (const assignment of session.assignments) {
      const old =
        assignment.id === undefined
          ? undefined
          : existingAssignments.get(assignment.id);
      const snapshot = await validateLibraryReferences(client, assignment, old);
      const values = [
        planId,
        sessionId,
        userId,
        assignment.workout_preset_id ?? null,
        assignment.exercise_id ?? null,
        assignment.sort_order,
        snapshot ? JSON.stringify(snapshot) : null,
      ];
      let assignmentId = assignment.id;
      if (assignmentId !== undefined) {
        const result = await client.query(
          `UPDATE workout_plan_template_assignments SET workout_preset_id = $4,
          exercise_id = $5, sort_order = $6, preset_snapshot = $7::jsonb
          WHERE template_id = $1 AND workout_session_id = $2 AND user_id = $3 AND id = $8 RETURNING id`,
          [...values, assignmentId]
        );
        if (!result.rowCount)
          invalid('Assignment identity changed while saving.');
      } else {
        const inserted = await client.query<{ id: number }>(
          `INSERT INTO workout_plan_template_assignments
          (template_id, workout_session_id, user_id, workout_preset_id, exercise_id, sort_order, preset_snapshot)
          VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id`,
          values
        );
        assignmentId = inserted.rows[0]!.id;
      }
      if (assignment.sets !== undefined)
        await saveAssignmentSets(client, assignmentId, assignment.sets);
    }
  }
  await client.query(
    'DELETE FROM workout_plan_template_assignments WHERE template_id = $1 AND user_id = $2 AND id = ANY($3::integer[])',
    [planId, userId, removedAssignments]
  );
  await client.query(
    'DELETE FROM workout_plan_sessions WHERE template_id = $1 AND user_id = $2 AND id = ANY($3::uuid[])',
    [planId, userId, removedSessions]
  );
}

function translateIntegrityError(error: unknown): never {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === '23503'
  )
    conflict(
      'This plan/session/assignment is still referenced or a referenced identity is invalid. No changes were saved.'
    );
  throw error;
}

async function createWorkoutPlanTemplate(
  planData: WorkoutPlanTemplateCreateInput,
  prefillDate?: string
): Promise<WorkoutPlanTemplateRow> {
  const { user_id: userId, ...body } = planData;
  const input = workoutPlanCreateRequestSchema.parse(body);
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN');
    const scheduleType = input.schedule_type ?? 'sequential';
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO workout_plan_templates
      (user_id, plan_name, description, start_date, end_date, is_active, schedule_type, entry_mode)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        userId,
        input.plan_name,
        input.description ?? null,
        input.start_date ?? null,
        input.end_date ?? null,
        input.is_active ?? false,
        scheduleType,
        scheduleType === 'sequential'
          ? 'prompt'
          : (input.entry_mode ?? 'prompt'),
      ]
    );
    const planId = inserted.rows[0]!.id;
    await saveSessions(
      client,
      planId,
      userId,
      input.sessions,
      [],
      scheduleType
    );
    if (
      prefillDate &&
      input.is_active &&
      scheduleType === 'weekly' &&
      input.entry_mode === 'prefill'
    )
      await createExerciseEntriesFromTemplate(
        planId,
        userId,
        prefillDate,
        client
      );
    const saved = (
      await readPlans(client, 'WHERE t.id = $1 AND t.user_id = $2', [
        planId,
        userId,
      ])
    )[0]!;
    await client.query('COMMIT');
    return saved;
  } catch (error) {
    await client.query('ROLLBACK');
    translateIntegrityError(error);
  } finally {
    client.release();
  }
}

async function getWorkoutPlanTemplatesByUserId(
  userId: string
): Promise<WorkoutPlanTemplateRow[]> {
  const client: PoolClient = await getClient(userId);
  try {
    return await readPlans(
      client,
      'WHERE t.user_id = $1 ORDER BY t.created_at DESC',
      [userId]
    );
  } finally {
    client.release();
  }
}
async function getWorkoutPlanTemplateById(
  templateId: string | number,
  userId: string
): Promise<WorkoutPlanTemplateRow | null> {
  const client: PoolClient = await getClient(userId);
  try {
    return (
      (await readPlans(client, 'WHERE t.id = $1', [templateId]))[0] ?? null
    );
  } finally {
    client.release();
  }
}
async function updateWorkoutPlanTemplate(
  templateId: string | number,
  userId: string,
  updateData: WorkoutPlanTemplateUpdateInput,
  prefillDate?: string
): Promise<WorkoutPlanTemplateRow> {
  const input = workoutPlanUpdateRequestSchema.parse(updateData);
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT id FROM workout_plan_templates WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [templateId, userId]
    );
    if (!locked.rowCount)
      throw Object.assign(new Error('Workout plan template not found.'), {
        status: 404,
      });
    // Session locks serialize Program binding/removal with this replacement.
    await client.query(
      'SELECT id FROM workout_plan_sessions WHERE template_id = $1 AND user_id = $2 ORDER BY id FOR UPDATE',
      [templateId, userId]
    );
    await client.query(
      'SELECT id FROM workout_plan_template_assignments WHERE template_id = $1 AND user_id = $2 ORDER BY id FOR UPDATE',
      [templateId, userId]
    );
    const previous = (
      await readPlans(client, 'WHERE t.id = $1 AND t.user_id = $2', [
        templateId,
        userId,
      ])
    )[0]!;
    const scheduleType = input.schedule_type ?? previous.schedule_type;
    if (scheduleType !== previous.schedule_type && input.sessions === undefined)
      invalid('Changing schedule_type requires providing sessions.');
    if (input.sessions !== undefined)
      await saveSessions(
        client,
        Number(templateId),
        userId,
        input.sessions,
        previous.sessions,
        scheduleType
      );
    const next = {
      ...previous,
      ...input,
      entry_mode:
        scheduleType === 'sequential'
          ? 'prompt'
          : (input.entry_mode ?? previous.entry_mode),
    };
    await client.query(
      `UPDATE workout_plan_templates SET plan_name = $3, description = $4, start_date = $5, end_date = $6,
      is_active = $7, schedule_type = $8, entry_mode = $9 WHERE id = $1 AND user_id = $2`,
      [
        templateId,
        userId,
        next.plan_name,
        next.description,
        next.start_date,
        next.end_date,
        next.is_active,
        scheduleType,
        next.entry_mode,
      ]
    );
    // Idempotent insertion only. Existing diary snapshots and their links are
    // never deleted, unlinked or rewritten when a prescription is edited.
    if (
      prefillDate &&
      next.is_active &&
      scheduleType === 'weekly' &&
      next.entry_mode === 'prefill'
    )
      await createExerciseEntriesFromTemplate(
        templateId,
        userId,
        prefillDate,
        client
      );
    const saved = (
      await readPlans(client, 'WHERE t.id = $1 AND t.user_id = $2', [
        templateId,
        userId,
      ])
    )[0]!;
    await client.query('COMMIT');
    return saved;
  } catch (error) {
    await client.query('ROLLBACK');
    translateIntegrityError(error);
  } finally {
    client.release();
  }
}
async function deleteWorkoutPlanTemplate(
  templateId: string | number,
  userId: string,
  today: string
): Promise<WorkoutPlanTemplateRow | null> {
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT id FROM workout_plan_templates WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [templateId, userId]
    );
    if (!locked.rowCount) {
      await client.query('ROLLBACK');
      return null;
    }
    const references = await client.query(
      `SELECT 1 FROM training_program_sessions ps JOIN workout_plan_sessions s ON s.id = ps.workout_session_id
      WHERE s.template_id = $1 AND s.user_id = $2 LIMIT 1`,
      [templateId, userId]
    );
    if (references.rowCount) {
      throw new HttpError(
        'Remove this Workout Plan’s exact session references from Training Programs before deleting it.',
        409
      );
    }
    // Remove only still-incomplete, future rows generated by this plan's
    // weekly prefill. Completed sets and every Program-linked row are history.
    const removed = await client.query<{
      exercise_preset_entry_id: string | null;
    }>(
      `DELETE FROM exercise_entries entry
       USING workout_plan_template_assignments assignment
       JOIN workout_plan_templates plan ON plan.id = assignment.template_id
         AND plan.user_id = assignment.user_id
       WHERE assignment.template_id = $1 AND assignment.user_id = $2
         AND plan.schedule_type = 'weekly' AND plan.entry_mode = 'prefill'
         AND entry.user_id = $2
         AND entry.workout_plan_assignment_id = assignment.id
         AND entry.source = 'Workout Plan'
         AND entry.entry_date >= $3::date
         AND NOT EXISTS (
           SELECT 1 FROM exercise_entry_sets completed_set
           WHERE completed_set.exercise_entry_id = entry.id
             AND completed_set.completed_at IS NOT NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM training_program_sessions program
           WHERE program.user_id = $2
             AND (
               program.exercise_entry_id = entry.id
               OR (
                 entry.exercise_preset_entry_id IS NOT NULL
                 AND program.exercise_preset_entry_id = entry.exercise_preset_entry_id
               )
               OR (
                 program.status = 'completed'
                 AND (
                   (
                     program.completed_workout->>'type' = 'individual'
                     AND program.completed_workout->>'id' = entry.id::text
                   )
                   OR (
                     program.completed_workout->>'type' = 'preset'
                     AND program.completed_workout->>'id' = entry.exercise_preset_entry_id::text
                   )
                 )
               )
             )
         )
       RETURNING entry.exercise_preset_entry_id`,
      [templateId, userId, today]
    );
    const parentIds = [
      ...new Set(
        removed.rows.flatMap(({ exercise_preset_entry_id }) =>
          exercise_preset_entry_id ? [exercise_preset_entry_id] : []
        )
      ),
    ];
    if (parentIds.length) {
      await client.query(
        `DELETE FROM exercise_preset_entries parent
         WHERE parent.user_id = $1 AND parent.id = ANY($2::uuid[])
           AND NOT EXISTS (
             SELECT 1 FROM exercise_entries child
             WHERE child.exercise_preset_entry_id = parent.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM training_program_sessions program
             WHERE program.user_id = $1
               AND (
                 program.exercise_preset_entry_id = parent.id
                 OR (
                   program.status = 'completed'
                   AND program.completed_workout->>'type' = 'preset'
                   AND program.completed_workout->>'id' = parent.id::text
                 )
               )
           )`,
        [userId, parentIds]
      );
    }
    const diaryReferences = await client.query(
      `SELECT 1 FROM exercise_entries ee
      JOIN workout_plan_template_assignments a ON a.id = ee.workout_plan_assignment_id
      WHERE a.template_id = $1 AND a.user_id = $2 LIMIT 1`,
      [templateId, userId]
    );
    if (diaryReferences.rowCount)
      conflict(
        'This Workout Plan still has diary-linked history that is not an incomplete future prefill entry (for example, completed, past, or Program-linked history).'
      );
    const result = await client.query(
      'DELETE FROM workout_plan_templates WHERE id = $1 AND user_id = $2 RETURNING *',
      [templateId, userId]
    );
    await client.query('COMMIT');
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query('ROLLBACK');
    translateIntegrityError(error);
  } finally {
    client.release();
  }
}
async function getWorkoutPlanTemplateOwnerId(
  templateId: string | number,
  userId: string
): Promise<string | null> {
  const client: PoolClient = await getClient(userId);
  try {
    const result = await client.query<{ user_id: string }>(
      'SELECT user_id FROM workout_plan_templates WHERE id = $1',
      [templateId]
    );
    return result.rows[0]?.user_id ?? null;
  } finally {
    client.release();
  }
}
async function getActiveWorkoutPlanForDate(
  userId: string,
  date: string
): Promise<WorkoutPlanTemplateRow[]> {
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const plans = await readPlans(
      client,
      `WHERE t.user_id = $1 AND t.is_active = TRUE
      AND $2::date >= COALESCE(t.start_date, DATE '0001-01-01') AND $2::date <= COALESCE(t.end_date, DATE '9999-12-31') ORDER BY t.created_at, t.id`,
      [userId, date]
    );
    for (const plan of plans) {
      // A frozen preset expands into several children, but is one assignment
      // occurrence. Do not consume those children as separate progression cycles.
      const logged = await client.query<LoggedPlanAssignmentRow>(
        `SELECT id, workout_plan_assignment_id, entry_date::text AS entry_date, created_at FROM (
        SELECT DISTINCT ON (ee.workout_plan_assignment_id, COALESCE(ee.exercise_preset_entry_id, ee.id))
          ee.id, ee.workout_plan_assignment_id, ee.entry_date, ee.created_at
        FROM exercise_entries ee JOIN workout_plan_template_assignments a ON a.id = ee.workout_plan_assignment_id
        WHERE a.template_id = $1 AND ee.entry_date <= $2::date AND ee.entry_date >= COALESCE($3::date, DATE '0001-01-01')
          AND ee.user_id = $4
        ORDER BY ee.workout_plan_assignment_id, COALESCE(ee.exercise_preset_entry_id, ee.id), ee.created_at, ee.id
      ) occurrences ORDER BY entry_date, created_at, id`,
        [plan.id, date, plan.start_date, userId]
      );
      if (plan.schedule_type === 'sequential') {
        const progression = computeSequentialPlanProgression(
          plan.sessions,
          logged.rows
        );
        plan.next_session = progression.nextSession;
        plan.next_assignments = progression.nextAssignments;
        plan.sequence_position = progression.sequencePosition;
      } else {
        const day = new Date(`${date}T00:00:00Z`).getUTCDay();
        const completed = new Set(
          logged.rows
            .filter((row) => row.entry_date === date)
            .map((row) => String(row.workout_plan_assignment_id))
        );
        const next =
          plan.sessions.find(
            (session) =>
              session.day_of_week === day &&
              session.assignments.some(
                (assignment) => !completed.has(String(assignment.id))
              )
          ) ?? null;
        plan.next_session = next;
        plan.next_assignments = next?.assignments ?? [];
        plan.sequence_position = null;
      }
    }
    await client.query('COMMIT');
    return plans;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

type BulkBindingRow = WorkoutPlanBulkBinding & {
  workout_session_id: string;
  completed_workout: unknown;
  outcome_at: unknown;
  exercise_entry_id: string | null;
  exercise_preset_entry_id: string | null;
};

interface BulkState {
  plan: WorkoutPlanTemplateRow;
  sourceSession?: WorkoutPlanSessionRow;
  persistedPrescriptions: unknown[];
  bindings: BulkBindingRow[];
  diary: { workout_session_id: string; id: string }[];
  today: string;
}

const bulkSetColumns: Partial<
  Record<WorkoutPlanBulkRequest['fields'][number], string>
> = {
  set_type: 'set_type',
  reps: 'reps',
  weight: 'weight',
  duration: 'duration',
  distance: 'distance',
  rest_time: 'rest_time',
  notes: 'notes',
};

function bulkError(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

function assertBulkOwner(userId: string, actor: string): void {
  if (userId !== actor)
    bulkError('Only the authenticated owner can bulk edit prescriptions.', 403);
}

async function readBulkState(
  client: PoolClient,
  userId: string,
  planId: number,
  programId: string | null,
  sourceSessionId?: string
): Promise<BulkState> {
  const plan = (
    await readPlans(client, 'WHERE t.id = $1 AND t.user_id = $2', [
      planId,
      userId,
    ])
  )[0];
  if (!plan) bulkError('Workout plan not found or not owned by you.', 404);
  let sourceSession: WorkoutPlanSessionRow | undefined;
  const prescriptionPlanIds = [planId];
  if (sourceSessionId) {
    const sourcePlans = await readPlans(
      client,
      'WHERE t.user_id = $1 AND EXISTS (SELECT 1 FROM workout_plan_sessions ws WHERE ws.template_id = t.id AND ws.user_id = t.user_id AND ws.id = $2)',
      [userId, sourceSessionId]
    );
    sourceSession = sourcePlans[0]?.sessions.find(
      (s) => s.id === sourceSessionId
    );
    if (!sourceSession)
      bulkError(
        'Saved source Workout Session not found or not owned by you.',
        404
      );
    if (sourcePlans[0]!.id !== planId)
      prescriptionPlanIds.push(sourcePlans[0]!.id);
  }
  if (programId !== null) {
    const program = await client.query(
      'SELECT id FROM training_programs WHERE id = $1 AND user_id = $2',
      [programId, userId]
    );
    if (!program.rowCount)
      bulkError('Training Program not found or not owned by you.', 404);
  }
  const bindings = await client.query<BulkBindingRow>(
    `SELECT s.*, s.effective_date::text, p.name AS program_name
     FROM training_program_sessions s JOIN training_programs p ON p.id = s.program_id AND p.user_id = s.user_id
     JOIN workout_plan_sessions ws ON ws.id = s.workout_session_id AND ws.user_id = s.user_id
     WHERE ws.template_id = $1 AND ws.user_id = $2 ORDER BY s.program_id, s.id`,
    [planId, userId]
  );
  const diary = await client.query<{ workout_session_id: string; id: string }>(
    `SELECT a.workout_session_id, e.id FROM exercise_entries e
     JOIN workout_plan_template_assignments a ON a.id = e.workout_plan_assignment_id
     WHERE a.template_id = $1 AND a.user_id = $2 ORDER BY e.id`,
    [planId, userId]
  );
  const persisted = await client.query(
    `SELECT to_jsonb(a) AS assignment, COALESCE((
      SELECT jsonb_agg(to_jsonb(ps) ORDER BY ps.id) FROM workout_plan_assignment_sets ps WHERE ps.assignment_id = a.id
     ), '[]'::jsonb) AS sets
     FROM workout_plan_template_assignments a WHERE a.template_id = ANY($1::integer[]) AND a.user_id = $2
     ORDER BY a.template_id, a.id`,
    [prescriptionPlanIds, userId]
  );
  const preference = await client.query<{ timezone: string | null }>(
    'SELECT timezone FROM user_preferences WHERE user_id = $1',
    [userId]
  );
  const timezone = preference.rows[0]?.timezone;
  const today = todayInZone(
    timezone && isValidTimeZone(timezone) ? timezone : 'UTC'
  );
  return {
    plan,
    sourceSession,
    persistedPrescriptions: persisted.rows,
    bindings: bindings.rows,
    diary: diary.rows,
    today,
  };
}

function bulkCandidates(
  state: BulkState,
  programId: string | null
): WorkoutPlanBulkCandidate[] {
  return state.plan.sessions.map((session) => {
    const bindings = state.bindings.filter(
      (b) => b.workout_session_id === session.id
    );
    let reason: string | null = null;
    if (state.diary.some((e) => e.workout_session_id === session.id))
      reason =
        'This Workout Session has diary history, including any prefilled workouts.';
    else if (bindings.some((b) => b.program_id !== programId))
      reason =
        'This Workout Session is referenced outside the selected Training Program scope.';
    else if (
      bindings.some(
        (b) =>
          b.status !== 'planned' ||
          b.completed_workout !== null ||
          b.outcome_at !== null ||
          b.exercise_entry_id !== null ||
          b.exercise_preset_entry_id !== null
      )
    )
      reason =
        'This Workout Session has a recorded outcome or completed workout.';
    else if (bindings.some((b) => b.effective_date <= state.today))
      reason = 'Every Planned Session binding must be strictly in the future.';
    else if (!bindings.length && programId !== null)
      reason =
        'This Workout Session is not bound to the selected Training Program.';
    else if (
      !bindings.length &&
      (!state.plan.start_date ||
        state.plan.start_date <= state.today ||
        (state.plan.end_date !== null &&
          state.plan.end_date < state.plan.start_date))
    )
      reason =
        'Standalone bulk editing requires an explicit future plan start date and an unexpired date range.';
    return {
      workout_session_id: session.id,
      name: session.name,
      assignments: session.assignments,
      bindings,
      eligible: reason === null,
      reason,
    };
  });
}

function exactExerciseMapping(
  source: WorkoutPlanPresetSnapshot,
  target: WorkoutPlanPresetSnapshot
): void {
  const ids = source.exercises.map((e) => e.exercise_id);
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some(
      (id) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id
        )
    ) ||
    ids.length !== target.exercises.length ||
    ids.some((id, i) => id !== target.exercises[i]!.exercise_id)
  )
    bulkError(
      'Preset targets require the exact ordered, unique exercise UUID mapping; no guessed matches are allowed.',
      409
    );
}

function copyBulkSets(
  source: WorkoutPlanAssignmentSetInput[],
  target: WorkoutPlanAssignmentSetInput[],
  fields: WorkoutPlanBulkRequest['fields']
): WorkoutPlanAssignmentSetInput[] {
  if (
    new Set(source.map((s) => s.set_number)).size !== source.length ||
    new Set(target.map((s) => s.set_number)).size !== target.length
  )
    bulkError(
      'Set numbers must be unique for an explicit prescription mapping.',
      400
    );
  if (fields.includes('sets'))
    return source.map((set) => {
      const { id: _sourceId, ...prescription } = set;
      const existing = target.find((t) => t.set_number === set.set_number);
      return {
        ...prescription,
        ...(existing?.id !== undefined ? { id: existing.id } : {}),
      };
    });
  const setFields = fields.filter(
    (f) => !['workout_format', 'time_cap_seconds', 'description'].includes(f)
  );
  if (!setFields.length) return target;
  if (
    source.length !== target.length ||
    source.some((s) => !target.some((t) => t.set_number === s.set_number))
  )
    bulkError(
      'Granular set edits require the exact same set-number shape on every target.',
      409
    );
  return target.map((set) => {
    const prescribed = source.find((s) => s.set_number === set.set_number)!;
    const result = { ...set };
    const values: Record<string, unknown> = result;
    for (const field of setFields) values[field] = prescribed[field] ?? null;
    return result;
  });
}

function bulkAfter(
  source: WorkoutPlanAssignmentRow,
  draft: WorkoutPlanAssignmentInput,
  target: WorkoutPlanAssignmentRow,
  fields: WorkoutPlanBulkRequest['fields']
): WorkoutPlanAssignmentRow {
  if (
    (draft.id !== undefined && draft.id !== source.id) ||
    draft.sort_order !== source.sort_order ||
    (draft.exercise_id !== undefined &&
      draft.exercise_id !== source.exercise_id) ||
    (draft.workout_preset_id !== undefined &&
      draft.workout_preset_id !== source.workout_preset_id)
  )
    bulkError(
      'The source draft cannot change assignment identity or ordering.',
      400
    );
  const result = { ...target };
  if (source.preset_snapshot) {
    if (
      !draft.preset_snapshot ||
      !target.preset_snapshot ||
      target.exercise_id !== null ||
      draft.preset_snapshot.id !== source.preset_snapshot.id
    )
      bulkError(
        'A preset source requires a compatible local preset prescription.',
        409
      );
    exactExerciseMapping(source.preset_snapshot, draft.preset_snapshot);
    exactExerciseMapping(source.preset_snapshot, target.preset_snapshot);
    const snapshot = { ...target.preset_snapshot };
    for (const field of fields) {
      if (field === 'workout_format')
        snapshot.workout_format = draft.preset_snapshot.workout_format;
      if (field === 'description')
        snapshot.description = draft.preset_snapshot.description;
      if (field === 'time_cap_seconds')
        snapshot.time_cap_seconds =
          draft.preset_snapshot.time_cap_seconds ?? null;
    }
    snapshot.exercises = target.preset_snapshot.exercises.map(
      (exercise, i) => ({
        ...exercise,
        sets: copyBulkSets(
          draft.preset_snapshot!.exercises[i]!.sets,
          exercise.sets,
          fields
        ),
      })
    );
    result.preset_snapshot = snapshot;
    result.workout_preset_format = snapshot.workout_format;
  } else {
    if (
      !source.exercise_id ||
      target.exercise_id !== source.exercise_id ||
      target.preset_snapshot ||
      draft.preset_snapshot
    )
      bulkError(
        'Individual exercise targets must reference the exact source exercise UUID.',
        409
      );
    if (
      fields.some((f) =>
        ['workout_format', 'time_cap_seconds', 'description'].includes(f)
      )
    )
      bulkError(
        'Preset format, cap and description fields cannot be applied to an individual exercise.',
        400
      );
    if (!draft.sets)
      bulkError('The source draft must provide explicit sets.', 400);
    result.sets = copyBulkSets(draft.sets, target.sets, fields);
  }
  return result;
}

function stableBulkJson(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value) ?? 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableBulkJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableBulkJson(item)}`)
    .join(',')}}`;
}

function makeBulkPreview(
  state: BulkState,
  request: WorkoutPlanBulkRequest
): WorkoutPlanBulkPreview {
  const sourceSession = state.sourceSession;
  const source = sourceSession?.assignments.find(
    (a) => a.id === request.source_assignment_id
  );
  if (!source)
    bulkError(
      'The saved source assignment does not belong to the selected owned Workout Session.',
      404
    );
  const candidates = bulkCandidates(state, request.program_id);
  const targets = request.targets.map((selection) => {
    const candidate = candidates.find(
      (c) => c.workout_session_id === selection.workout_session_id
    );
    if (!candidate)
      bulkError(
        'A target Workout Session does not belong to the selected plan.',
        404
      );
    if (!candidate.eligible)
      bulkError(`${candidate.name}: ${candidate.reason}`, 409);
    const selectedIds = [...selection.planned_session_ids].sort();
    const actualIds = candidate.bindings.map((b) => b.id).sort();
    if (!isDeepStrictEqual(selectedIds, actualIds))
      bulkError(
        'Explicitly account for every Planned Session binding of each target; refresh the selection.',
        409
      );
    const before = candidate.assignments.find(
      (a) => a.id === selection.assignment_id
    );
    if (!before)
      bulkError(
        'A target assignment does not belong to the selected Workout Session.',
        404
      );
    return {
      workout_session_id: candidate.workout_session_id,
      name: candidate.name,
      bindings: candidate.bindings,
      before,
      after: bulkAfter(source, request.prescription, before, request.fields),
    };
  });
  const revision = createHash('sha256')
    .update(
      stableBulkJson({
        request,
        sourceSession,
        targets,
        plan: state.plan,
        persistedPrescriptions: state.persistedPrescriptions,
        bindings: state.bindings,
        diary: state.diary,
      })
    )
    .digest('hex');
  return { request, revision, targets };
}

async function getBulkPrescriptionCandidates(
  userId: string,
  actor: string,
  planId: number,
  programId: string | null
): Promise<WorkoutPlanBulkCandidate[]> {
  assertBulkOwner(userId, actor);
  const client = await getClient(userId, actor);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const candidates = bulkCandidates(
      await readBulkState(client, userId, planId, programId),
      programId
    );
    await client.query('COMMIT');
    return candidates;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function previewBulkPrescriptions(
  userId: string,
  actor: string,
  input: WorkoutPlanBulkRequest
): Promise<WorkoutPlanBulkPreview> {
  assertBulkOwner(userId, actor);
  const request = workoutPlanBulkRequestSchema.parse(input);
  const client = await getClient(userId, actor);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const preview = makeBulkPreview(
      await readBulkState(
        client,
        userId,
        request.plan_id,
        request.program_id,
        request.source_session_id
      ),
      request
    );
    await client.query('COMMIT');
    return preview;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function applyBulkPrescriptions(
  userId: string,
  actor: string,
  input: WorkoutPlanBulkApplyRequest
) {
  assertBulkOwner(userId, actor);
  const { request, revision } = workoutPlanBulkApplyRequestSchema.parse(input);
  const client: PoolClient = await getClient(userId, actor);
  try {
    await client.query('BEGIN');
    // Program authoring/outcomes lock Program before plan/session. Lock all of
    // this owner's Programs first, including those that might add a binding,
    // rather than reversing that order after acquiring a plan lock.
    await client.query(
      'SELECT id FROM training_programs WHERE user_id = $1 ORDER BY id FOR UPDATE',
      [userId]
    );
    const plan = await client.query<{ id: number }>(
      `SELECT t.id FROM workout_plan_templates t WHERE t.user_id = $2 AND
      (t.id = $1 OR EXISTS (SELECT 1 FROM workout_plan_sessions ws WHERE ws.template_id = t.id AND ws.user_id = t.user_id AND ws.id = $3))
      ORDER BY t.id FOR UPDATE`,
      [request.plan_id, userId, request.source_session_id]
    );
    if (!plan.rows.some((p) => p.id === request.plan_id))
      bulkError('Workout plan not found or not owned by you.', 404);
    const planIds = plan.rows.map((p) => p.id);
    await client.query(
      'SELECT id FROM workout_plan_sessions WHERE template_id = ANY($1::integer[]) AND user_id = $2 ORDER BY template_id, id FOR UPDATE',
      [planIds, userId]
    );
    await client.query(
      'SELECT id FROM workout_plan_template_assignments WHERE template_id = ANY($1::integer[]) AND user_id = $2 ORDER BY template_id, id FOR UPDATE',
      [planIds, userId]
    );
    await client.query(
      `SELECT ps.id FROM workout_plan_assignment_sets ps JOIN workout_plan_template_assignments a ON a.id = ps.assignment_id
      WHERE a.template_id = ANY($1::integer[]) AND a.user_id = $2 ORDER BY a.template_id, ps.id FOR UPDATE OF ps`,
      [planIds, userId]
    );
    await client.query(
      `SELECT s.id FROM training_program_sessions s JOIN workout_plan_sessions ws ON ws.id = s.workout_session_id
      WHERE ws.template_id = $1 AND ws.user_id = $2 ORDER BY s.program_id, s.id FOR UPDATE OF s`,
      [request.plan_id, userId]
    );
    const preview = makeBulkPreview(
      await readBulkState(
        client,
        userId,
        request.plan_id,
        request.program_id,
        request.source_session_id
      ),
      request
    );
    if (preview.revision !== revision)
      bulkError(
        'The source, targets or their bindings changed after preview. Create a new preview.',
        409
      );
    // All validation above completes before the first write. Assignment locks
    // also conflict with the diary FK's key-share lock for new history links.
    for (const target of preview.targets) {
      if (target.after.preset_snapshot) {
        await client.query(
          'UPDATE workout_plan_template_assignments SET preset_snapshot = $2::jsonb WHERE id = $1',
          [target.after.id, JSON.stringify(target.after.preset_snapshot)]
        );
      } else if (request.fields.includes('sets')) {
        await saveAssignmentSets(client, target.after.id, target.after.sets);
      } else {
        // Canonical reads contain column-derived nulls absent from the authored
        // JSON. Patch selected keys only; do not normalize untargeted storage.
        const selected = request.fields.map((field) => {
          const column = bulkSetColumns[field];
          if (!column) invalid('Unsupported individual set field.');
          return { field, column };
        });
        for (const set of target.after.sets) {
          const patch = Object.fromEntries(
            selected.map(({ field }) => [field, set[field] ?? null])
          );
          const updated = await client.query(
            `UPDATE workout_plan_assignment_sets SET prescription = prescription || $3::jsonb,
             ${selected.map(({ column }, index) => `${column} = $${index + 4}`).join(', ')}
             WHERE id = $1 AND assignment_id = $2 RETURNING id`,
            [
              set.id,
              target.after.id,
              JSON.stringify(patch),
              ...selected.map(({ field }) => patch[field]),
            ]
          );
          if (!updated.rowCount)
            conflict('A selected set changed during apply.');
        }
      }
    }
    const saved = (
      await readPlans(client, 'WHERE t.id = $1 AND t.user_id = $2', [
        request.plan_id,
        userId,
      ])
    )[0]!;
    await client.query('COMMIT');
    return { plan: saved };
  } catch (error) {
    await client.query('ROLLBACK');
    translateIntegrityError(error);
  } finally {
    client.release();
  }
}

export {
  createWorkoutPlanTemplate,
  getWorkoutPlanTemplatesByUserId,
  getWorkoutPlanTemplateById,
  updateWorkoutPlanTemplate,
  deleteWorkoutPlanTemplate,
  getWorkoutPlanTemplateOwnerId,
  getActiveWorkoutPlanForDate,
  getBulkPrescriptionCandidates,
  previewBulkPrescriptions,
  applyBulkPrescriptions,
};
export default {
  createWorkoutPlanTemplate,
  getWorkoutPlanTemplatesByUserId,
  getWorkoutPlanTemplateById,
  updateWorkoutPlanTemplate,
  deleteWorkoutPlanTemplate,
  getWorkoutPlanTemplateOwnerId,
  getActiveWorkoutPlanForDate,
  getBulkPrescriptionCandidates,
  previewBulkPrescriptions,
  applyBulkPrescriptions,
};
