import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  trainingProgramSchema,
  type TrainingProgram,
  type TrainingProgramInput,
  type TrainingProgramOutcomeInput,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

export class TrainingProgramError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

type ProgramRow = Omit<
  TrainingProgram,
  'phases' | 'created_at' | 'updated_at' | 'schedule_end_date'
> & { created_at: Date; updated_at: Date };
type Phase = TrainingProgram['phases'][number];
type Week = Phase['weeks'][number];
type Session = Week['sessions'][number];
type PhaseRow = Omit<Phase, 'weeks'> & { program_id: string };
type WeekRow = Omit<Week, 'sessions'> & {
  program_id: string;
  phase_id: string;
};
type SessionRow = Omit<Session, 'outcome_at'> & {
  program_id: string;
  week_id: string;
  outcome_at: Date | null;
};

async function readPrograms(
  client: PoolClient,
  userId: string,
  id?: string
): Promise<TrainingProgram[]> {
  const programs = await client.query<ProgramRow>(
    `SELECT id, user_id, name, goal, start_date::text, end_date::text, schedule_type, auto_shift, created_at, updated_at
     FROM training_programs WHERE user_id = $1 ${id ? 'AND id = $2' : ''} ORDER BY start_date, created_at, id`,
    id ? [userId, id] : [userId]
  );
  if (!programs.rows.length) return [];
  const ids = programs.rows.map((program) => program.id);
  const phases = await client.query<PhaseRow>(
    'SELECT id, program_id, name, goal, sort_order FROM training_program_phases WHERE user_id = $1 AND program_id = ANY($2::uuid[]) ORDER BY sort_order, id',
    [userId, ids]
  );
  const weeks = await client.query<WeekRow>(
    'SELECT id, program_id, phase_id, start_date::text, end_date::text, sort_order FROM training_program_weeks WHERE user_id = $1 AND program_id = ANY($2::uuid[]) ORDER BY sort_order, id',
    [userId, ids]
  );
  const sessions = await client.query<SessionRow>(
    `SELECT s.id, s.program_id, s.week_id, s.name, s.scheduled_date::text, s.effective_date::text, s.status, s.outcome_at, s.completed_workout, s.workout_plan_id, s.sort_order, COALESCE(s.workout_plan_name_snapshot, p.plan_name) AS workout_plan_name
     FROM training_program_sessions s JOIN workout_plan_templates p ON p.id = s.workout_plan_id AND p.user_id = s.user_id
     WHERE s.user_id = $1 AND s.program_id = ANY($2::uuid[]) ORDER BY s.sort_order, s.id`,
    [userId, ids]
  );
  const sessionGroups = new Map<string, Session[]>();
  const scheduleEnds = new Map(
    programs.rows.map((program) => [program.id, program.end_date])
  );
  for (const row of sessions.rows) {
    const group = sessionGroups.get(row.week_id) ?? [];
    group.push({ ...row, outcome_at: row.outcome_at?.toISOString() ?? null });
    sessionGroups.set(row.week_id, group);
    if (row.effective_date > scheduleEnds.get(row.program_id)!)
      scheduleEnds.set(row.program_id, row.effective_date);
  }
  const weekGroups = new Map<string, Week[]>();
  for (const row of weeks.rows) {
    const group = weekGroups.get(row.phase_id) ?? [];
    group.push({ ...row, sessions: sessionGroups.get(row.id) ?? [] });
    weekGroups.set(row.phase_id, group);
  }
  const phaseGroups = new Map<string, Phase[]>();
  for (const row of phases.rows) {
    const group = phaseGroups.get(row.program_id) ?? [];
    group.push({ ...row, weeks: weekGroups.get(row.id) ?? [] });
    phaseGroups.set(row.program_id, group);
  }
  return programs.rows.map((row) =>
    trainingProgramSchema.parse({
      ...row,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      schedule_end_date: scheduleEnds.get(row.id)!,
      phases: phaseGroups.get(row.id) ?? [],
    })
  );
}

export async function getTrainingPrograms(
  userId: string,
  id?: string
): Promise<TrainingProgram[]> {
  const client: PoolClient = await getClient(userId, userId);
  try {
    // One snapshot across the four structure queries, even during concurrent edits.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await readPrograms(client, userId, id);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function validateChildIds(
  input: TrainingProgramInput,
  existing?: TrainingProgram
): void {
  const parents = new Map<string, string>();
  for (const phase of existing?.phases ?? []) {
    parents.set(phase.id, 'program');
    for (const week of phase.weeks) {
      parents.set(week.id, phase.id);
      for (const session of week.sessions) parents.set(session.id, week.id);
    }
  }
  const check = (id: string | undefined, parent: string | undefined) => {
    if (id && (!parent || parents.get(id) !== parent)) {
      throw new TrainingProgramError(
        'A supplied phase, week or session ID does not belong to this location in your Program.',
        400
      );
    }
  };
  for (const phase of input.phases) {
    check(phase.id, 'program');
    for (const week of phase.weeks) {
      check(week.id, phase.id);
      for (const session of week.sessions) check(session.id, week.id);
    }
  }
}

function validateRecordedSessions(
  input: TrainingProgramInput,
  existing?: TrainingProgram
): void {
  const retained = new Map(
    input.phases.flatMap((phase) =>
      phase.weeks.flatMap((week) =>
        week.sessions.map((session) => [session.id, session] as const)
      )
    )
  );
  for (const phase of existing?.phases ?? []) {
    for (const week of phase.weeks) {
      for (const session of week.sessions) {
        if (session.status === 'planned') continue;
        const edited = retained.get(session.id);
        if (
          !edited ||
          edited.name !== session.name ||
          edited.scheduled_date !== session.scheduled_date ||
          edited.workout_plan_id !== session.workout_plan_id
        ) {
          throw new TrainingProgramError(
            'Recorded sessions cannot be removed or rewritten. Keep their IDs, names, authored dates and Workout Plans.',
            409
          );
        }
      }
    }
  }
}

export async function saveTrainingProgram(
  userId: string,
  input: TrainingProgramInput,
  id?: string
): Promise<TrainingProgram | null> {
  const client: PoolClient = await getClient(userId, userId);
  try {
    await client.query('BEGIN');
    let existing: TrainingProgram | undefined;
    if (id) {
      const locked = await client.query(
        'SELECT id FROM training_programs WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [id, userId]
      );
      if (!locked.rowCount) {
        await client.query('ROLLBACK');
        return null;
      }
      existing = (await readPrograms(client, userId, id))[0];
    }
    validateChildIds(input, existing);
    validateRecordedSessions(input, existing);
    const planIds = [
      ...new Set(
        input.phases.flatMap((phase) =>
          phase.weeks.flatMap((week) =>
            week.sessions.map((session) => session.workout_plan_id)
          )
        )
      ),
    ];
    if (planIds.length) {
      const plans = await client.query<{ id: number }>(
        'SELECT id FROM workout_plan_templates WHERE user_id = $1 AND id = ANY($2::integer[]) FOR KEY SHARE',
        [userId, planIds]
      );
      if (plans.rows.length !== planIds.length)
        throw new TrainingProgramError(
          'Every Planned Session must use one of your existing Workout Plans.',
          400
        );
    }
    const programId = id ?? randomUUID();
    const values = [
      programId,
      userId,
      input.name,
      input.goal,
      input.start_date,
      input.end_date,
      input.auto_shift ?? false,
    ];
    if (id) {
      await client.query(
        'UPDATE training_programs SET name = $3, goal = $4, start_date = $5, end_date = $6, auto_shift = $7, updated_at = now() WHERE id = $1 AND user_id = $2',
        values
      );
    } else {
      await client.query(
        'INSERT INTO training_programs (id, user_id, name, goal, start_date, end_date, auto_shift) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        values
      );
    }
    const phaseIds: string[] = [],
      weekIds: string[] = [],
      sessionIds: string[] = [];
    for (const [p, phase] of input.phases.entries()) {
      const phaseId = phase.id ?? randomUUID();
      phaseIds.push(phaseId);
      await client.query(
        `INSERT INTO training_program_phases (id, program_id, user_id, name, goal, sort_order) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, goal = EXCLUDED.goal, sort_order = EXCLUDED.sort_order, updated_at = now()`,
        [phaseId, programId, userId, phase.name, phase.goal, p]
      );
      for (const [w, week] of phase.weeks.entries()) {
        const weekId = week.id ?? randomUUID();
        weekIds.push(weekId);
        await client.query(
          `INSERT INTO training_program_weeks (id, program_id, phase_id, user_id, start_date, end_date, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (id) DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, sort_order = EXCLUDED.sort_order, updated_at = now()`,
          [
            weekId,
            programId,
            phaseId,
            userId,
            week.start_date,
            week.end_date,
            w,
          ]
        );
        for (const [s, session] of week.sessions.entries()) {
          const sessionId = session.id ?? randomUUID();
          sessionIds.push(sessionId);
          await client.query(
            `INSERT INTO training_program_sessions (id, program_id, week_id, user_id, name, scheduled_date, effective_date, workout_plan_id, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, effective_date = CASE WHEN training_program_sessions.scheduled_date = EXCLUDED.scheduled_date THEN training_program_sessions.effective_date ELSE EXCLUDED.scheduled_date END, scheduled_date = EXCLUDED.scheduled_date, workout_plan_id = EXCLUDED.workout_plan_id, sort_order = EXCLUDED.sort_order, updated_at = now()`,
            [
              sessionId,
              programId,
              weekId,
              userId,
              session.name,
              session.scheduled_date,
              session.workout_plan_id,
              s,
            ]
          );
        }
      }
    }
    await client.query(
      'DELETE FROM training_program_sessions WHERE program_id = $1 AND user_id = $2 AND NOT (id = ANY($3::uuid[]))',
      [programId, userId, sessionIds]
    );
    await client.query(
      'DELETE FROM training_program_weeks WHERE program_id = $1 AND user_id = $2 AND NOT (id = ANY($3::uuid[]))',
      [programId, userId, weekIds]
    );
    await client.query(
      'DELETE FROM training_program_phases WHERE program_id = $1 AND user_id = $2 AND NOT (id = ANY($3::uuid[]))',
      [programId, userId, phaseIds]
    );
    const saved = (await readPrograms(client, userId, programId))[0]!;
    await client.query('COMMIT');
    return saved;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteTrainingProgram(
  userId: string,
  id: string
): Promise<boolean> {
  const client: PoolClient = await getClient(userId, userId);
  try {
    const result = await client.query(
      'DELETE FROM training_programs WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return result.rowCount === 1;
  } finally {
    client.release();
  }
}

export async function recordTrainingProgramOutcome(
  userId: string,
  programId: string,
  sessionId: string,
  input: TrainingProgramOutcomeInput
): Promise<TrainingProgram> {
  const client: PoolClient = await getClient(userId, userId);
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT id, auto_shift FROM training_programs WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [programId, userId]
    );
    if (!locked.rowCount)
      throw new TrainingProgramError('Training Program not found.', 404);
    const current = (await readPrograms(client, userId, programId))[0]!;
    const session = current.phases
      .flatMap((phase) => phase.weeks.flatMap((week) => week.sessions))
      .find((item) => item.id === sessionId);
    if (!session)
      throw new TrainingProgramError('Planned Session not found.', 404);
    if (session.status !== 'planned') {
      const same =
        session.status === input.status &&
        (input.status === 'missed' ||
          (session.completed_workout?.id === input.workout.id &&
            session.completed_workout.type === input.workout.type));
      if (!same)
        throw new TrainingProgramError(
          'This session already has a recorded outcome.',
          409
        );
      await client.query('COMMIT');
      return current;
    }
    let workout: Session['completed_workout'] = null;
    if (input.status === 'completed') {
      // Grouped children are not standalone workouts: link their parent instead.
      const result =
        input.workout.type === 'preset'
          ? await client.query(
              'SELECT id, name, entry_date::text FROM exercise_preset_entries WHERE id = $1 AND user_id = $2 FOR SHARE',
              [input.workout.id, userId]
            )
          : await client.query(
              "SELECT id, COALESCE(exercise_name, 'Workout') AS name, entry_date::text FROM exercise_entries WHERE id = $1 AND user_id = $2 AND exercise_preset_entry_id IS NULL AND entry_date IS NOT NULL FOR SHARE",
              [input.workout.id, userId]
            );
      if (!result.rowCount)
        throw new TrainingProgramError(
          'Diary workout not found or not owned by you.',
          404
        );
      workout = { ...result.rows[0], type: input.workout.type };
    } else if (locked.rows[0].auto_shift) {
      const overflow = await client.query(
        "SELECT id FROM training_program_sessions WHERE program_id = $1 AND user_id = $2 AND status = 'planned' AND effective_date > $3::date AND effective_date = DATE '9999-12-31'",
        [programId, userId, session.effective_date]
      );
      if (overflow.rowCount)
        throw new TrainingProgramError(
          'Cannot shift beyond 9999-12-31. Disable auto-shift or change the future authored date first.',
          409
        );
      await client.query(
        "UPDATE training_program_sessions SET effective_date = effective_date + 1, updated_at = now() WHERE program_id = $1 AND user_id = $2 AND status = 'planned' AND effective_date > $3::date",
        [programId, userId, session.effective_date]
      );
    }
    await client.query(
      `UPDATE training_program_sessions SET status = $4, outcome_at = now(), completed_workout = $5::jsonb,
        workout_plan_name_snapshot = $6, exercise_entry_id = $7, exercise_preset_entry_id = $8, updated_at = now()
       WHERE id = $1 AND program_id = $2 AND user_id = $3`,
      [
        sessionId,
        programId,
        userId,
        input.status,
        workout ? JSON.stringify(workout) : null,
        session.workout_plan_name,
        input.status === 'completed' && input.workout.type === 'individual'
          ? input.workout.id
          : null,
        input.status === 'completed' && input.workout.type === 'preset'
          ? input.workout.id
          : null,
      ]
    );
    await client.query(
      'UPDATE training_programs SET updated_at = now() WHERE id = $1 AND user_id = $2',
      [programId, userId]
    );
    const saved = (await readPrograms(client, userId, programId))[0]!;
    await client.query('COMMIT');
    return saved;
  } catch (error) {
    await client.query('ROLLBACK');
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === '23505' &&
      'constraint' in error &&
      error.constraint === 'training_program_sessions_completed_workout_key'
    ) {
      throw new TrainingProgramError(
        'This workout is already linked to a Planned Session.',
        409
      );
    }
    throw error;
  } finally {
    client.release();
  }
}
