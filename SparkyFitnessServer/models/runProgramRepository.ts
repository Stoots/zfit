import { getClient } from '../db/poolManager.js';
import {
  findProgram,
  runProgramAdjustmentSchema,
  runProgramCompletionSchema,
  runProgramEffortSchema,
  runProgramWorkoutSchema,
  type ProgramState,
  type AdjustResult,
  type RunProgramAdjustment,
  type RunProgramEffort,
  type RunProgramResponse,
  type UpsertRunProgramBody,
} from '@workspace/shared';
import { z } from 'zod';

/**
 * Every column, with the dates as YYYY-MM-DD text: the driver would turn a DATE
 * into a JS Date in the server's time zone, which can name the wrong day.
 */
const COLUMNS = `*,
  to_char(start_date, 'YYYY-MM-DD') AS start_day,
  to_char(end_date, 'YYYY-MM-DD') AS end_day,
  to_char(last_done_date, 'YYYY-MM-DD') AS last_done_day`;

/** Most change-log entries kept per person. */
const MAX_LOG_ENTRIES = 30;

const workoutsSchema = z.array(runProgramWorkoutSchema);
const logSchema = z.array(runProgramAdjustmentSchema);
const effortSchema = z.array(runProgramEffortSchema);
const completionSchema = z.array(runProgramCompletionSchema);

/** Most effort ratings kept per person. */
const MAX_EFFORT_ENTRIES = 40;

/** Most workout-to-entry links kept per person. */
const MAX_COMPLETION_ENTRIES = 200;

function mapRow(row: Record<string, unknown>): RunProgramResponse {
  const workouts = workoutsSchema.safeParse(row.workouts);
  const log = logSchema.safeParse(row.adjustment_log);
  const effort = effortSchema.safeParse(row.effort_log);
  const completions = completionSchema.safeParse(row.completion_log);
  return {
    id: String(row.id),
    program_id: String(row.program_id),
    enabled: Boolean(row.enabled),
    next_index: Number(row.next_index),
    workouts: workouts.success ? workouts.data : [],
    adjustment_log: log.success ? log.data : [],
    effort_log: effort.success ? effort.data : [],
    completion_log: completions.success ? completions.data : [],
    run_days: Array.isArray(row.run_days)
      ? (row.run_days as number[]).map(Number)
      : [],
    start_date: row.start_day ? String(row.start_day) : null,
    end_date: row.end_day ? String(row.end_day) : null,
    last_done_date: row.last_done_day ? String(row.last_done_day) : null,
    updated_at: new Date(row.updated_at as string).toISOString(),
  };
}

export async function getRunProgram(
  userId: string,
  authenticatedUserId?: string
): Promise<RunProgramResponse | null> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `SELECT ${COLUMNS} FROM run_programs WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  } finally {
    client.release();
  }
}

/** Thrown for a program id the server does not know. */
export class UnknownRunProgramError extends Error {}

/** Thrown when the goal day would fall before the first day. */
export class InvalidRunProgramScheduleError extends Error {}

const SCHEDULE_CHECK = 'chk_run_programs_end_after_start';

function isScheduleCheckViolation(error: unknown): boolean {
  const { code, constraint } = error as { code?: string; constraint?: string };
  return code === '23514' && constraint === SCHEDULE_CHECK;
}

/**
 * Creates the person's program from the built-in one, or changes the switch
 * and place of the one they have. Choosing a different program replaces the
 * workouts (and the place restarts unless one is given).
 */
export async function upsertRunProgram(
  userId: string,
  body: UpsertRunProgramBody,
  authenticatedUserId?: string
): Promise<RunProgramResponse> {
  try {
    return await saveRunProgram(userId, body, authenticatedUserId);
  } catch (error) {
    // The request body only checks a pair sent together; the table checks the
    // new value against the stored one (e.g. a goal day set before the start).
    if (isScheduleCheckViolation(error)) {
      throw new InvalidRunProgramScheduleError(
        'The goal day cannot be before the first day.'
      );
    }
    throw error;
  }
}

async function saveRunProgram(
  userId: string,
  body: UpsertRunProgramBody,
  authenticatedUserId?: string
): Promise<RunProgramResponse> {
  const template = findProgram(body.program_id);
  if (!template) throw new UnknownRunProgramError(body.program_id);

  // Sorted and without repeats; null leaves the stored days alone.
  const runDays = body.run_days
    ? [...new Set(body.run_days)].sort((a, b) => a - b)
    : null;
  const hasStartDate = body.start_date !== undefined;
  const hasEndDate = body.end_date !== undefined;

  const client = await getClient(userId, authenticatedUserId);
  try {
    const existing = await client.query(
      'SELECT program_id FROM run_programs WHERE user_id = $1',
      [userId]
    );
    const sameProgram = existing.rows[0]?.program_id === body.program_id;
    if (!existing.rows[0] || !sameProgram) {
      const next = Math.min(body.next_index ?? 0, template.workouts.length);
      // Switching programs keeps the person's Diary schedule.
      const result = await client.query(
        `INSERT INTO run_programs
           (user_id, program_id, enabled, next_index, workouts, adjustment_log,
            run_days, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5::jsonb, '[]'::jsonb,
                 COALESCE($6::smallint[], '{}'),
                 CASE WHEN $7::boolean THEN $8::date END,
                 CASE WHEN $9::boolean THEN $10::date END)
         ON CONFLICT ON CONSTRAINT uq_run_programs_user DO UPDATE SET
           program_id = EXCLUDED.program_id,
           enabled = EXCLUDED.enabled,
           next_index = EXCLUDED.next_index,
           workouts = EXCLUDED.workouts,
           adjustment_log = '[]'::jsonb,
           effort_log = '[]'::jsonb,
           completion_log = '[]'::jsonb,
           -- A workout done under the old program does not count for the new one.
           last_done_date = NULL,
           run_days = COALESCE($6::smallint[], run_programs.run_days),
           start_date = CASE WHEN $7::boolean THEN $8::date
                             ELSE run_programs.start_date END,
           end_date = CASE WHEN $9::boolean THEN $10::date
                           ELSE run_programs.end_date END,
           updated_at = NOW()
         RETURNING ${COLUMNS}`,
        [
          userId,
          body.program_id,
          body.enabled ?? true,
          next,
          JSON.stringify(template.workouts),
          runDays,
          hasStartDate,
          body.start_date ?? null,
          hasEndDate,
          body.end_date ?? null,
        ]
      );
      return mapRow(result.rows[0]);
    }
    const result = await client.query(
      `UPDATE run_programs SET
         enabled = COALESCE($2, enabled),
         next_index = LEAST(COALESCE($3, next_index), jsonb_array_length(workouts)),
         run_days = COALESCE($4::smallint[], run_days),
         start_date = CASE WHEN $5::boolean THEN $6::date ELSE start_date END,
         end_date = CASE WHEN $7::boolean THEN $8::date ELSE end_date END,
         updated_at = NOW()
       WHERE user_id = $1
       RETURNING ${COLUMNS}`,
      [
        userId,
        body.enabled ?? null,
        body.next_index ?? null,
        runDays,
        hasStartDate,
        body.start_date ?? null,
        hasEndDate,
        body.end_date ?? null,
      ]
    );
    return mapRow(result.rows[0]);
  } finally {
    client.release();
  }
}

/**
 * Moves on from workout `index`, but only if it is the one due, in one
 * statement so a repeated request cannot skip a workout. With `entryId`, also
 * records which diary entry the workout was done as. Returns null when there
 * is no program or the index was not the due one.
 */
export async function completeRunProgramWorkout(
  userId: string,
  index: number,
  authenticatedUserId?: string,
  options: { programId?: string; day?: string; entryId?: string } = {}
): Promise<RunProgramResponse | null> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    // A workout finished under one program must not tick off another's. The
    // link list keeps its newest entries: the subquery drops the oldest ones
    // past the cap.
    const result = await client.query(
      `UPDATE run_programs SET next_index = next_index + 1,
         last_done_date = COALESCE($4::date, last_done_date),
         completion_log = CASE WHEN $5::text IS NULL THEN completion_log ELSE (
           SELECT COALESCE(jsonb_agg(item ORDER BY pos), '[]'::jsonb)
           FROM jsonb_array_elements(
             completion_log || jsonb_build_array(jsonb_build_object(
               'index', $2::int, 'entry_id', $5::text, 'at', $6::text))
           ) WITH ORDINALITY AS log(item, pos)
           WHERE pos > jsonb_array_length(completion_log) + 1 - $7::int
         ) END,
         updated_at = NOW()
       WHERE user_id = $1 AND next_index = $2
         AND next_index < jsonb_array_length(workouts)
         AND ($3::text IS NULL OR program_id = $3)
       RETURNING ${COLUMNS}`,
      [
        userId,
        index,
        options.programId ?? null,
        options.day ?? null,
        options.entryId ?? null,
        new Date().toISOString(),
        MAX_COMPLETION_ENTRIES,
      ]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  } finally {
    client.release();
  }
}

/**
 * Records how hard finished workout `index` felt, replacing an earlier rating
 * of the same workout. Only a workout already done (before the place) can be
 * rated, and only under the program it belonged to. Returns null when there is
 * no program or the workout does not qualify.
 */
export async function rateRunProgramWorkout(
  userId: string,
  index: number,
  rating: number,
  authenticatedUserId?: string,
  programId?: string
): Promise<RunProgramResponse | null> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT ${COLUMNS} FROM run_programs WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    const program = current.rows[0] ? mapRow(current.rows[0]) : null;
    if (
      !program ||
      index >= program.next_index ||
      (programId !== undefined && programId !== program.program_id)
    ) {
      await client.query('ROLLBACK');
      return null;
    }
    const log: RunProgramEffort[] = [
      ...program.effort_log.filter((entry) => entry.index !== index),
      { index, rating, at: new Date().toISOString() },
    ].slice(-MAX_EFFORT_ENTRIES);
    const updated = await client.query(
      `UPDATE run_programs SET effort_log = $2::jsonb, updated_at = NOW()
       WHERE user_id = $1 RETURNING ${COLUMNS}`,
      [userId, JSON.stringify(log)]
    );
    await client.query('COMMIT');
    return mapRow(updated.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reads the program under a row lock, lets `change` compute the new workouts
 * and place, and saves them with a log entry. `change` may throw to refuse.
 * Returns null when the person has no program.
 */
export async function adjustRunProgram(
  userId: string,
  source: RunProgramAdjustment['source'],
  change: (state: ProgramState & { programId: string }) => AdjustResult,
  authenticatedUserId?: string
): Promise<RunProgramResponse | null> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT ${COLUMNS} FROM run_programs WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const program = mapRow(current.rows[0]);
    const result = change({
      workouts: program.workouts,
      next: program.next_index,
      programId: program.program_id,
    });
    const log: RunProgramAdjustment[] = [
      ...program.adjustment_log,
      { at: new Date().toISOString(), summary: result.summary, source },
    ].slice(-MAX_LOG_ENTRIES);
    const updated = await client.query(
      `UPDATE run_programs SET workouts = $2::jsonb, next_index = $3,
         adjustment_log = $4::jsonb, updated_at = NOW()
       WHERE user_id = $1 RETURNING ${COLUMNS}`,
      [
        userId,
        JSON.stringify(result.workouts),
        result.next,
        JSON.stringify(log),
      ]
    );
    await client.query('COMMIT');
    return mapRow(updated.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
