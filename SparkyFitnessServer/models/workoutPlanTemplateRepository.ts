import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { getClient } from '../db/poolManager.js';
import { HttpError } from '../utils/errors.js';
import {
  workoutPlanCreateRequestSchema,
  workoutPlanUpdateRequestSchema,
  workoutPlanPresetSnapshotSchema,
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
    const accessible = await client.query(
      'SELECT id FROM exercises WHERE id = $1 FOR KEY SHARE',
      [exercise.exercise_id]
    );
    if (!accessible.rowCount)
      invalid('Snapshot exercise not found or not accessible.');
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
        'UPDATE workout_plan_sessions SET name = $4, day_of_week = $5, sort_order = $6 WHERE id = $1 AND template_id = $2 AND user_id = $3',
        [
          sessionId,
          planId,
          userId,
          session.name,
          session.day_of_week,
          session.sort_order,
        ]
      );
    } else {
      await client.query(
        'INSERT INTO workout_plan_sessions (id, template_id, user_id, name, day_of_week, sort_order) VALUES ($1,$2,$3,$4,$5,$6)',
        [
          sessionId,
          planId,
          userId,
          session.name,
          session.day_of_week,
          session.sort_order,
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

export {
  createWorkoutPlanTemplate,
  getWorkoutPlanTemplatesByUserId,
  getWorkoutPlanTemplateById,
  updateWorkoutPlanTemplate,
  deleteWorkoutPlanTemplate,
  getWorkoutPlanTemplateOwnerId,
  getActiveWorkoutPlanForDate,
};
export default {
  createWorkoutPlanTemplate,
  getWorkoutPlanTemplatesByUserId,
  getWorkoutPlanTemplateById,
  updateWorkoutPlanTemplate,
  deleteWorkoutPlanTemplate,
  getWorkoutPlanTemplateOwnerId,
  getActiveWorkoutPlanForDate,
};
