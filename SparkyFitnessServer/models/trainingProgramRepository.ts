import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  compareDays,
  trainingProgramSchema,
  isValidTimeZone,
  instantToDay,
  dayToUtcRange,
  cardioTestTypeSchema,
  type TrainingProgram,
  type TrainingProgramInput,
  type TrainingProgramOutcomeInput,
  type PresetSessionExerciseRequest,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import { HttpError } from '../utils/errors.js';
import { isOptionalProgramSessionOmitted } from '../utils/trainingProgramOptionality.js';
import { logWorkoutPlanSession } from '../services/exerciseService.js';

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

interface ProgramTreeRows {
  programs: ProgramRow[];
  phases: PhaseRow[];
  weeks: WeekRow[];
  sessions: SessionRow[];
  today: string;
  timezone: string;
}

async function queryProgramRows(
  client: PoolClient,
  userId: string,
  id?: string,
  now = new Date()
): Promise<ProgramTreeRows> {
  const programs = await client.query<ProgramRow>(
    `SELECT id, user_id, name, goal, start_date::text, end_date::text, schedule_type, auto_shift, created_at, updated_at
     FROM training_programs WHERE user_id = $1 ${id ? 'AND id = $2' : ''} ORDER BY start_date, created_at, id`,
    id ? [userId, id] : [userId]
  );
  const ids = programs.rows.map((program) => program.id);
  const preferences = await client.query<{ timezone: string | null }>(
    'SELECT timezone FROM user_preferences WHERE user_id = $1',
    [userId]
  );
  const configuredZone = preferences.rows[0]?.timezone;
  const timezone =
    configuredZone && isValidTimeZone(configuredZone) ? configuredZone : 'UTC';
  const today = instantToDay(now, timezone);
  if (!programs.rows.length)
    return {
      programs: [],
      phases: [],
      weeks: [],
      sessions: [],
      today,
      timezone,
    };
  const phases = await client.query<PhaseRow>(
    'SELECT id, program_id, name, goal, sort_order FROM training_program_phases WHERE user_id = $1 AND program_id = ANY($2::uuid[]) ORDER BY sort_order, id',
    [userId, ids]
  );
  const weeks = await client.query<WeekRow>(
    'SELECT id, program_id, phase_id, start_date::text, end_date::text, sort_order FROM training_program_weeks WHERE user_id = $1 AND program_id = ANY($2::uuid[]) ORDER BY sort_order, id',
    [userId, ids]
  );
  const sessions = await client.query<SessionRow>(
    `SELECT s.id, s.program_id, s.week_id, s.name, s.scheduled_date::text, s.effective_date::text, s.status, s.is_optional, s.outcome_at, s.completed_workout, s.workout_session_id, s.cardio_test_type, s.sort_order,
       ws.template_id AS workout_plan_id, COALESCE(s.workout_plan_name_snapshot, p.plan_name) AS workout_plan_name,
       COALESCE(s.workout_session_name_snapshot, ws.name) AS workout_session_name,
       CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id', a.id, 'test_type', a.test_type, 'attempt_date', a.attempt_date::text, 'results', a.results) END AS completed_test_attempt
     FROM training_program_sessions s
     LEFT JOIN workout_plan_sessions ws ON ws.id = s.workout_session_id AND ws.user_id = s.user_id
     LEFT JOIN workout_plan_templates p ON p.id = ws.template_id AND p.user_id = ws.user_id
     LEFT JOIN cardio_test_attempts a ON a.planned_session_id = s.id AND a.user_id = s.user_id
     WHERE s.user_id = $1 AND s.program_id = ANY($2::uuid[]) ORDER BY s.sort_order, s.id`,
    [userId, ids]
  );
  return {
    programs: programs.rows,
    phases: phases.rows,
    weeks: weeks.rows,
    sessions: sessions.rows,
    today,
    timezone,
  };
}

function assembleTrainingPrograms(
  rows: ProgramTreeRows,
  today: string,
  timezone: string
): TrainingProgram[] {
  const sessionGroups = new Map<string, Session[]>();
  const scheduleEnds = new Map(
    rows.programs.map((program) => [program.id, program.end_date])
  );
  for (const row of rows.sessions) {
    const group = sessionGroups.get(row.week_id) ?? [];
    const omitted = isOptionalProgramSessionOmitted(row, today);
    group.push({
      ...row,
      status: omitted ? 'omitted' : row.status,
      outcome_at: omitted
        ? dayToUtcRange(row.effective_date, timezone).end.toISOString()
        : (row.outcome_at?.toISOString() ?? null),
    });
    sessionGroups.set(row.week_id, group);
    if (row.effective_date > scheduleEnds.get(row.program_id)!)
      scheduleEnds.set(row.program_id, row.effective_date);
  }
  const weekGroups = new Map<string, Week[]>();
  for (const row of rows.weeks) {
    const group = weekGroups.get(row.phase_id) ?? [];
    group.push({ ...row, sessions: sessionGroups.get(row.id) ?? [] });
    weekGroups.set(row.phase_id, group);
  }
  const phaseGroups = new Map<string, Phase[]>();
  for (const row of rows.phases) {
    const group = phaseGroups.get(row.program_id) ?? [];
    group.push({ ...row, weeks: weekGroups.get(row.id) ?? [] });
    phaseGroups.set(row.program_id, group);
  }
  return rows.programs.map((row) =>
    trainingProgramSchema.parse({
      ...row,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      schedule_end_date: scheduleEnds.get(row.id)!,
      phases: phaseGroups.get(row.id) ?? [],
    })
  );
}

async function readPrograms(
  client: PoolClient,
  userId: string,
  id?: string,
  now = new Date()
): Promise<TrainingProgram[]> {
  const rows = await queryProgramRows(client, userId, id, now);
  return assembleTrainingPrograms(rows, rows.today, rows.timezone);
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
      throw new HttpError(
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
          (edited.workout_session_id ?? null) !== session.workout_session_id ||
          (edited.cardio_test_type ?? null) !== session.cardio_test_type ||
          (edited.is_optional ?? session.is_optional) !== session.is_optional
        ) {
          throw new HttpError(
            'Recorded sessions cannot be removed or rewritten. Keep their IDs, names, authored dates and session binding.',
            409
          );
        }
      }
    }
  }
}

async function upsertProgramRow(
  client: PoolClient,
  userId: string,
  programId: string,
  input: TrainingProgramInput,
  isUpdate: boolean
): Promise<void> {
  const values = [
    programId,
    userId,
    input.name,
    input.goal,
    input.start_date,
    input.end_date,
    input.auto_shift ?? false,
  ];
  if (isUpdate) {
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
}

interface StructureIds {
  phaseIds: string[];
  weekIds: string[];
  sessionIds: string[];
}

// Changing a session's authored scheduled_date resets its effective_date to
// the new authored date, discarding any auto-shift it had accumulated.
async function upsertProgramStructure(
  client: PoolClient,
  userId: string,
  programId: string,
  input: TrainingProgramInput,
  optionalBySession: ReadonlyMap<string, boolean>,
  existingOptionalById: ReadonlyMap<string, boolean>
): Promise<StructureIds> {
  const ids: StructureIds = { phaseIds: [], weekIds: [], sessionIds: [] };
  for (const [p, phase] of input.phases.entries()) {
    const phaseId = phase.id ?? randomUUID();
    ids.phaseIds.push(phaseId);
    await client.query(
      `INSERT INTO training_program_phases (id, program_id, user_id, name, goal, sort_order) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, goal = EXCLUDED.goal, sort_order = EXCLUDED.sort_order, updated_at = now()`,
      [phaseId, programId, userId, phase.name, phase.goal, p]
    );
    for (const [w, week] of phase.weeks.entries()) {
      const weekId = week.id ?? randomUUID();
      ids.weekIds.push(weekId);
      await client.query(
        `INSERT INTO training_program_weeks (id, program_id, phase_id, user_id, start_date, end_date, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (id) DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, sort_order = EXCLUDED.sort_order, updated_at = now()`,
        [weekId, programId, phaseId, userId, week.start_date, week.end_date, w]
      );
      for (const [s, session] of week.sessions.entries()) {
        const sessionId = session.id ?? randomUUID();
        ids.sessionIds.push(sessionId);
        await client.query(
          `INSERT INTO training_program_sessions (id, program_id, week_id, user_id, name, scheduled_date, effective_date, workout_session_id, cardio_test_type, is_optional, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, effective_date = CASE WHEN training_program_sessions.scheduled_date = EXCLUDED.scheduled_date THEN training_program_sessions.effective_date ELSE EXCLUDED.scheduled_date END, scheduled_date = EXCLUDED.scheduled_date, workout_session_id = EXCLUDED.workout_session_id, cardio_test_type = EXCLUDED.cardio_test_type, is_optional = EXCLUDED.is_optional, sort_order = EXCLUDED.sort_order, updated_at = now()`,
          [
            sessionId,
            programId,
            weekId,
            userId,
            session.name,
            session.scheduled_date,
            session.workout_session_id ?? null,
            session.cardio_test_type ?? null,
            session.is_optional ??
              existingOptionalById.get(sessionId) ??
              (session.workout_session_id
                ? optionalBySession.get(session.workout_session_id)
                : undefined) ??
              false,
            s,
          ]
        );
      }
    }
  }
  return ids;
}

async function deleteRemovedChildren(
  client: PoolClient,
  userId: string,
  programId: string,
  ids: StructureIds
): Promise<void> {
  // Children first: sessions reference weeks, weeks reference phases.
  await client.query(
    'DELETE FROM training_program_sessions WHERE program_id = $1 AND user_id = $2 AND NOT (id = ANY($3::uuid[]))',
    [programId, userId, ids.sessionIds]
  );
  await client.query(
    'DELETE FROM training_program_weeks WHERE program_id = $1 AND user_id = $2 AND NOT (id = ANY($3::uuid[]))',
    [programId, userId, ids.weekIds]
  );
  await client.query(
    'DELETE FROM training_program_phases WHERE program_id = $1 AND user_id = $2 AND NOT (id = ANY($3::uuid[]))',
    [programId, userId, ids.phaseIds]
  );
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
    const now = new Date();
    if (id) {
      const locked = await client.query(
        'SELECT id FROM training_programs WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [id, userId]
      );
      if (!locked.rowCount) {
        await client.query('ROLLBACK');
        return null;
      }
      existing = (await readPrograms(client, userId, id, now))[0];
    }
    validateChildIds(input, existing);
    validateRecordedSessions(input, existing);
    const workoutSessionIds = [
      ...new Set(
        input.phases.flatMap((phase) =>
          phase.weeks.flatMap((week) =>
            week.sessions.flatMap((session) =>
              session.workout_session_id ? [session.workout_session_id] : []
            )
          )
        )
      ),
    ];
    const optionalBySession = new Map<string, boolean>();
    const testTypes = [
      ...new Set(
        input.phases.flatMap((phase) =>
          phase.weeks.flatMap((week) =>
            week.sessions.flatMap((session) =>
              session.cardio_test_type ? [session.cardio_test_type] : []
            )
          )
        )
      ),
    ];
    if (testTypes.some((type) => !cardioTestTypeSchema.safeParse(type).success))
      throw new HttpError('Unsupported Cardio Test protocol.', 400);
    if (workoutSessionIds.length) {
      const workouts = await client.query<{ id: string; is_optional: boolean }>(
        `SELECT ws.id, ws.is_optional FROM workout_plan_sessions ws JOIN workout_plan_templates p
          ON p.id = ws.template_id AND p.user_id = ws.user_id
         WHERE ws.user_id = $1 AND ws.id = ANY($2::uuid[])
         ORDER BY p.id, ws.id FOR KEY SHARE OF p, ws`,
        [userId, workoutSessionIds]
      );
      for (const workout of workouts.rows)
        optionalBySession.set(workout.id, workout.is_optional);
      if (workouts.rows.length !== workoutSessionIds.length)
        throw new HttpError(
          'Every Planned Session must select one of your exact existing Workout Sessions.',
          400
        );
    }
    const existingOptionalById = new Map(
      (existing?.phases ?? []).flatMap((phase) =>
        phase.weeks.flatMap((week) =>
          week.sessions.map(
            (session) => [session.id, session.is_optional] as const
          )
        )
      )
    );
    const programId = id ?? randomUUID();
    await upsertProgramRow(client, userId, programId, input, Boolean(id));
    const ids = await upsertProgramStructure(
      client,
      userId,
      programId,
      input,
      optionalBySession,
      existingOptionalById
    );
    await deleteRemovedChildren(client, userId, programId, ids);
    const saved = (await readPrograms(client, userId, programId, now))[0]!;
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

function findSession(
  program: TrainingProgram,
  sessionId: string
): Session | undefined {
  return program.phases
    .flatMap((phase) => phase.weeks.flatMap((week) => week.sessions))
    .find((item) => item.id === sessionId);
}

// Resolves the diary entry a completion links to. Grouped children are not
// standalone workouts: link their parent preset instead.
async function lookupDiaryWorkout(
  client: PoolClient,
  userId: string,
  workout: { id: string; type: 'preset' | 'individual' }
): Promise<NonNullable<Session['completed_workout']>> {
  const result =
    workout.type === 'preset'
      ? await client.query(
          'SELECT id, name, entry_date::text FROM exercise_preset_entries WHERE id = $1 AND user_id = $2 FOR SHARE',
          [workout.id, userId]
        )
      : await client.query(
          "SELECT id, COALESCE(exercise_name, 'Workout') AS name, entry_date::text FROM exercise_entries WHERE id = $1 AND user_id = $2 AND exercise_preset_entry_id IS NULL AND entry_date IS NOT NULL FOR SHARE",
          [workout.id, userId]
        );
  if (!result.rowCount)
    throw new HttpError('Diary workout not found or not owned by you.', 404);
  return { ...result.rows[0], type: workout.type };
}

// Advances every still-planned session on a strictly later effective date by
// one calendar day. Same-day sessions, recorded sessions, and optional
// sessions already omitted as of the athlete's today never move.
async function shiftLaterSessions(
  client: PoolClient,
  userId: string,
  programId: string,
  missedEffectiveDate: string,
  today: string
): Promise<void> {
  // Match isOptionalProgramSessionOmitted: omission is derived for a planned
  // optional session whose effective date is before the athlete's calendar day.
  const movable =
    "status = 'planned' AND effective_date > $3::date AND NOT (is_optional AND effective_date < $4::date)";
  const overflow = await client.query(
    `SELECT id FROM training_program_sessions WHERE program_id = $1 AND user_id = $2 AND ${movable} AND effective_date = DATE '9999-12-31'`,
    [programId, userId, missedEffectiveDate, today]
  );
  if (overflow.rowCount)
    throw new HttpError(
      'Cannot shift beyond 9999-12-31. Disable auto-shift or change the future authored date first.',
      409
    );
  await client.query(
    `UPDATE training_program_sessions SET effective_date = effective_date + 1, updated_at = now() WHERE program_id = $1 AND user_id = $2 AND ${movable}`,
    [programId, userId, missedEffectiveDate, today]
  );
}

async function writeOutcome(
  client: PoolClient,
  userId: string,
  programId: string,
  session: Session,
  input: TrainingProgramOutcomeInput,
  workout: Session['completed_workout']
): Promise<void> {
  await client.query(
    `UPDATE training_program_sessions SET status = $4, outcome_at = now(), completed_workout = $5::jsonb,
        workout_plan_name_snapshot = $6, workout_session_name_snapshot = $7,
        exercise_entry_id = $8, exercise_preset_entry_id = $9, updated_at = now()
       WHERE id = $1 AND program_id = $2 AND user_id = $3`,
    [
      session.id,
      programId,
      userId,
      input.status,
      workout ? JSON.stringify(workout) : null,
      session.workout_plan_name,
      session.workout_session_name,
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
}

function isDuplicateWorkoutLink(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'training_program_sessions_completed_workout_key'
  );
}

/**
 * Records a one-time outcome for a Planned Session. `today` is the athlete's
 * current calendar day (their timezone); a 'missed' outcome is rejected while
 * the session's effective date is after it.
 */
export async function recordTrainingProgramOutcome(
  userId: string,
  programId: string,
  sessionId: string,
  input: TrainingProgramOutcomeInput,
  today: string
): Promise<TrainingProgram> {
  const client: PoolClient = await getClient(userId, userId);
  try {
    await client.query('BEGIN');
    const now = new Date();
    const locked = await client.query(
      'SELECT id, auto_shift FROM training_programs WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [programId, userId]
    );
    if (!locked.rowCount)
      throw new HttpError('Training Program not found.', 404);
    const current = (await readPrograms(client, userId, programId, now))[0]!;
    const session = findSession(current, sessionId);
    if (!session) throw new HttpError('Planned Session not found.', 404);
    const lateOptionalCompletion =
      session.status === 'omitted' &&
      session.is_optional &&
      input.status === 'completed';
    if (session.status !== 'planned' && !lateOptionalCompletion) {
      const same =
        session.status === input.status &&
        (input.status === 'missed' ||
          (session.completed_workout?.id === input.workout.id &&
            session.completed_workout.type === input.workout.type));
      if (!same)
        throw new HttpError(
          'This session already has a recorded outcome.',
          409
        );
      await client.query('COMMIT');
      return current;
    }
    let workout: Session['completed_workout'] = null;
    if (input.status === 'completed') {
      if (session.cardio_test_type)
        throw new HttpError(
          'Record a Test Attempt to complete this assessment.',
          400
        );
      workout = await lookupDiaryWorkout(client, userId, input.workout);
    } else {
      if (session.is_optional)
        throw new HttpError('Optional sessions cannot be marked missed.', 409);
      if (compareDays(session.effective_date, today) > 0)
        throw new HttpError(
          'A session scheduled after today cannot be marked missed yet.',
          409
        );
      if (locked.rows[0].auto_shift)
        await shiftLaterSessions(
          client,
          userId,
          programId,
          session.effective_date,
          today
        );
    }
    await writeOutcome(client, userId, programId, session, input, workout);
    const saved = (await readPrograms(client, userId, programId, now))[0]!;
    await client.query('COMMIT');
    return saved;
  } catch (error) {
    await client.query('ROLLBACK');
    if (isDuplicateWorkoutLink(error)) {
      throw new HttpError(
        'This workout is already linked to a Planned Session.',
        409
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Creates and links an exact Workout Session under the Program outcome lock. */
export async function completeTrainingProgramSession(
  userId: string,
  programId: string,
  sessionId: string,
  entryDate: string,
  performedExercises?: PresetSessionExerciseRequest[]
): Promise<TrainingProgram> {
  const client = await getClient(userId, userId);
  try {
    await client.query('BEGIN');
    const program = await client.query(
      'SELECT id FROM training_programs WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [programId, userId]
    );
    if (!program.rowCount)
      throw new HttpError('Training Program not found.', 404);
    const locked = await client.query(
      'SELECT id FROM training_program_sessions WHERE id = $1 AND program_id = $2 AND user_id = $3 FOR UPDATE',
      [sessionId, programId, userId]
    );
    if (!locked.rowCount)
      throw new HttpError('Planned Session not found.', 404);
    const current = (await readPrograms(client, userId, programId))[0]!;
    const session = findSession(current, sessionId)!;
    if (session.status === 'completed') {
      await client.query('COMMIT');
      return current;
    }
    if (
      session.status !== 'planned' &&
      !(session.status === 'omitted' && session.is_optional)
    )
      throw new HttpError('This session already has a recorded outcome.', 409);

    const created = await logWorkoutPlanSession(
      userId,
      userId,
      session.workout_session_id,
      entryDate,
      client,
      undefined,
      performedExercises
    );
    if (!created.session)
      throw new Error('Created diary workout could not be read.');
    if (!performedExercises) {
      await client.query(
        `UPDATE exercise_entry_sets SET completed_at = now()
         WHERE exercise_entry_id IN (
           SELECT id FROM exercise_entries WHERE exercise_preset_entry_id = $1 AND user_id = $2
         )`,
        [created.session.id, userId]
      );
    }
    const input: TrainingProgramOutcomeInput = {
      status: 'completed',
      workout: { type: 'preset', id: created.session.id },
    };
    const workout = await lookupDiaryWorkout(client, userId, input.workout);
    await writeOutcome(client, userId, programId, session, input, workout);
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
