import type { PoolClient } from 'pg';
import { getClient } from '../db/poolManager.js';
import { log } from '../config/logging.js';
import type {
  WorkoutPlanSessionResponse,
  WorkoutPlanResponse,
} from '@workspace/shared';
import exerciseService from '../services/exerciseService.js';
import {
  addDays,
  compareDays,
  dayOfWeek,
  localDateToDay,
} from '@workspace/shared';

async function getWorkoutSessionForExecution(
  userId: string,
  sessionId: string,
  transactionClient?: PoolClient
): Promise<WorkoutPlanSessionResponse | null> {
  const client: PoolClient = transactionClient ?? (await getClient(userId));
  try {
    if (transactionClient) {
      // Freeze the saved prescription before a logging transaction reads it.
      // Bulk apply and ordinary authorship take these parents in the same
      // plan -> session -> assignment -> set order. Without this read lock,
      // a start could read an old draft, wait on the diary FK, then log it
      // after a newly applied prescription had already committed.
      await client.query(
        `SELECT t.id FROM workout_plan_templates t JOIN workout_plan_sessions s ON s.template_id = t.id
         WHERE s.id = $1 FOR SHARE OF t`,
        [sessionId]
      );
      await client.query(
        'SELECT id FROM workout_plan_sessions WHERE id = $1 FOR SHARE',
        [sessionId]
      );
      await client.query(
        'SELECT id FROM workout_plan_template_assignments WHERE workout_session_id = $1 ORDER BY id FOR SHARE',
        [sessionId]
      );
      await client.query(
        `SELECT ps.id FROM workout_plan_assignment_sets ps JOIN workout_plan_template_assignments a ON a.id = ps.assignment_id
         WHERE a.workout_session_id = $1 ORDER BY ps.id FOR SHARE OF ps`,
        [sessionId]
      );
    }
    const result = await client.query<WorkoutPlanSessionResponse>(
      `SELECT s.*,
        COALESCE((
          SELECT json_agg(assignment_data ORDER BY assignment_data.sort_order, assignment_data.id)
          FROM (
            SELECT a.*, e.name AS exercise_name, e.modality,
              a.preset_snapshot->>'name' AS workout_preset_name,
              a.preset_snapshot->>'workout_format' AS workout_preset_format,
              COALESCE((
                SELECT json_agg(
                  (to_jsonb(set_data) - 'prescription') || COALESCE(set_data.prescription, '{}'::jsonb)
                  ORDER BY set_data.set_number
                )
                FROM workout_plan_assignment_sets set_data
                WHERE set_data.assignment_id = a.id
              ), '[]'::json) AS sets
            FROM workout_plan_template_assignments a
            LEFT JOIN exercises e ON e.id = a.exercise_id
            WHERE a.workout_session_id = s.id
          ) assignment_data
        ), '[]'::json) AS assignments
       FROM workout_plan_sessions s
       JOIN workout_plan_templates t ON t.id = s.template_id
       WHERE s.id = $1`,
      [sessionId]
    );
    // Both session and parent plan visibility are enforced by the scoped RLS client.
    return result.rows[0] ?? null;
  } finally {
    if (!transactionClient) client.release();
  }
}

async function getWorkoutSessionForAssignments(
  userId: string,
  assignmentIds: readonly number[],
  client: PoolClient
): Promise<WorkoutPlanSessionResponse | null> {
  const result = await client.query<{ id: number; workout_session_id: string }>(
    `SELECT id, workout_session_id FROM workout_plan_template_assignments
     WHERE id = ANY($1::integer[])`,
    [assignmentIds]
  );
  if (result.rows.length !== assignmentIds.length) return null;
  const sessionId = result.rows[0]?.workout_session_id;
  if (
    !sessionId ||
    result.rows.some((row) => row.workout_session_id !== sessionId)
  )
    return null;
  const session = await getWorkoutSessionForExecution(
    userId,
    sessionId,
    client
  );
  if (
    !session ||
    assignmentIds.some(
      (id) => !session.assignments.some((assignment) => assignment.id === id)
    )
  ) {
    return null;
  }
  return session;
}

async function createExerciseEntriesFromTemplate(
  templateId: string | number,
  userId: string,
  today: string,
  transactionClient?: PoolClient
) {
  const client: PoolClient = transactionClient ?? (await getClient(userId));
  try {
    const result = await client.query<{
      schedule_type: WorkoutPlanResponse['schedule_type'];
      start_date: string | Date | null;
      end_date: string | Date | null;
      sessions: Pick<WorkoutPlanSessionResponse, 'id' | 'day_of_week'>[];
    }>(
      `SELECT t.*, COALESCE((
         SELECT json_agg(s ORDER BY s.sort_order, s.id)
         FROM workout_plan_sessions s WHERE s.template_id = t.id
       ), '[]'::json) AS sessions
       FROM workout_plan_templates t WHERE t.id = $1 AND t.user_id = $2`,
      [templateId, userId]
    );
    const template = result.rows[0];
    if (!template || template.sessions.length === 0) return;
    // Sequential plans are started explicitly through progression, not calendar-generated.
    if (template.schedule_type === 'sequential') return;
    if (!template.start_date) return;
    const startDay =
      typeof template.start_date === 'string'
        ? template.start_date.slice(0, 10)
        : localDateToDay(template.start_date);
    const endDay = template.end_date
      ? typeof template.end_date === 'string'
        ? template.end_date.slice(0, 10)
        : localDateToDay(template.end_date)
      : addDays(startDay, 365);
    let currentDay = compareDays(startDay, today) < 0 ? today : startDay;
    while (compareDays(currentDay, endDay) <= 0) {
      for (const session of template.sessions) {
        if (session.day_of_week === dayOfWeek(currentDay)) {
          // Existing rows are frozen diary snapshots, including incomplete work.
          // Only a newly added assignment or missing calendar date is materialized.
          const missing = await client.query<{ id: number }>(
            `SELECT a.id FROM workout_plan_template_assignments a
             WHERE a.workout_session_id = $1
               AND NOT EXISTS (
                 SELECT 1 FROM exercise_entries entry
                 WHERE entry.user_id = $2 AND entry.entry_date = $3
                   AND entry.workout_plan_assignment_id = a.id
               )`,
            [session.id, userId, currentDay]
          );
          if (missing.rows.length === 0) continue;
          await exerciseService.logWorkoutPlanSession(
            userId,
            userId,
            session.id,
            currentDay,
            transactionClient,
            new Set(missing.rows.map((assignment) => assignment.id))
          );
        }
      }
      currentDay = addDays(currentDay, 1);
    }
  } finally {
    if (!transactionClient) client.release();
  }
}

async function deleteExerciseEntriesByTemplateId(
  templateId: string | number,
  userId: string,
  today: string,
  transactionClient?: PoolClient
) {
  const client: PoolClient = transactionClient ?? (await getClient(userId));
  try {
    // Delete exercise_preset_entries that were generated by this template.
    // exercise_entries.exercise_preset_entry_id has ON DELETE CASCADE, so the
    // child exercise_entries are removed automatically.
    const presetResult = await client.query(
      `DELETE FROM exercise_preset_entries parent
       WHERE parent.user_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM exercise_entries child
           JOIN exercise_entry_sets completed_set ON completed_set.exercise_entry_id = child.id
           WHERE child.exercise_preset_entry_id = parent.id AND completed_set.completed_at IS NOT NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM training_program_sessions completed_session
           WHERE completed_session.exercise_preset_entry_id = parent.id
             AND completed_session.status = 'completed'
         )
         AND id IN (
           SELECT DISTINCT exercise_preset_entry_id
           FROM exercise_entries
           WHERE user_id = $1
             AND entry_date >= $3
             AND exercise_preset_entry_id IS NOT NULL
             AND workout_plan_assignment_id IN (
               SELECT a.id FROM workout_plan_template_assignments a
               JOIN workout_plan_sessions s ON s.id = a.workout_session_id
               WHERE s.template_id = $2
             )
         )`,
      [userId, templateId, today]
    );
    log(
      'info',
      `Deleted ${presetResult.rowCount} exercise preset entries associated with workout plan template ${templateId} for user ${userId}.`
    );

    // Also remove any exercise_entries that belong to the template but were
    // not under a preset entry (e.g. individual-exercise assignments).
    const result = await client.query(
      `DELETE FROM exercise_entries entry
       WHERE entry.user_id = $1
         AND entry.entry_date >= $3
         AND entry.exercise_preset_entry_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM exercise_entry_sets completed_set
           WHERE completed_set.exercise_entry_id = entry.id AND completed_set.completed_at IS NOT NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM training_program_sessions completed_session
           WHERE completed_session.exercise_entry_id = entry.id
             AND completed_session.status = 'completed'
         )
         AND workout_plan_assignment_id IN (
             SELECT a.id FROM workout_plan_template_assignments a
             JOIN workout_plan_sessions s ON s.id = a.workout_session_id
             WHERE s.template_id = $2
         ) RETURNING id`,
      [userId, templateId, today]
    );
    log(
      'info',
      `Deleted ${result.rowCount} exercise entries associated with workout plan template ${templateId} for user ${userId}.`
    );
    return (presetResult.rowCount ?? 0) + (result.rowCount ?? 0);
  } catch (error) {
    log(
      'error',
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      `Error deleting exercise entries for template ${templateId} for user ${userId}: ${error.message}`,
      error
    );
    throw error;
  } finally {
    if (!transactionClient) client.release();
  }
}
export { createExerciseEntriesFromTemplate };
export { getWorkoutSessionForExecution };
export { getWorkoutSessionForAssignments };
export { deleteExerciseEntriesByTemplateId };
export default {
  createExerciseEntriesFromTemplate,
  deleteExerciseEntriesByTemplateId,
};
