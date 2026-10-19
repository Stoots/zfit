import {
  compareDays,
  canLinkDiaryWorkout,
  displaySetRir,
  type TrainingProgram,
  type TrainingProgramOutcomeInput,
  type PresetSessionExerciseRequest,
  type PresetSessionResponse,
  type CardioTestAttempts,
} from '@workspace/shared';
import type { PoolClient } from 'pg';
import { getClient } from '../db/poolManager.js';
import {
  HttpError,
  TrainingProgramCompletionConflict,
} from '../utils/errors.js';
import { readPrograms } from './trainingProgramRepository.js';
import { getGroupedExerciseSessionByIdWithClient } from '../services/exerciseEntryHistoryService.js';
import { logWorkoutPlanSession } from '../services/exerciseService.js';

type Session =
  TrainingProgram['phases'][number]['weeks'][number]['sessions'][number];
type OmissionSession = Pick<Session, 'is_optional' | 'effective_date'> & {
  status: string;
};

// Render the same conditions in memory and in SQL so auto-shift cannot drift
// from the athlete's derived Omitted Sessions.
function omissionConditions(today: string) {
  return [
    ['is_optional', '=', true],
    ['status', '=', 'planned'],
    ['effective_date', '<', today],
  ] as const;
}

export function isOptionalProgramSessionOmitted(
  session: OmissionSession,
  today: string
): boolean {
  return omissionConditions(today).every(([field, operator, value]) =>
    operator === '<' ? session[field] < value : session[field] === value
  );
}

/** The date is a bound query parameter, never an athlete-supplied SQL fragment. */
export function omittedSessionSql(todayParameter: `$${number}::date`): string {
  return omissionConditions(todayParameter)
    .map(([field, operator, value]) => {
      const operand =
        operator === '<' || typeof value === 'boolean' ? value : `'${value}'`;
      return `${field} ${operator} ${operand}`;
    })
    .join(' AND ');
}

/** Program reads have already projected derived omission into the status. */
export function hasSessionOutcome(session: Pick<Session, 'status'>): boolean {
  return session.status !== 'planned';
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
      ? await client.query<{ id: string; name: string; entry_date: string }>(
          'SELECT id, name, entry_date::text FROM exercise_preset_entries WHERE id = $1 AND user_id = $2 FOR SHARE',
          [workout.id, userId]
        )
      : await client.query<{ id: string; name: string; entry_date: string }>(
          "SELECT id, COALESCE(exercise_name, 'Workout') AS name, entry_date::text FROM exercise_entries WHERE id = $1 AND user_id = $2 AND exercise_preset_entry_id IS NULL AND entry_date IS NOT NULL FOR SHARE",
          [workout.id, userId]
        );
  if (!result.rowCount)
    throw new HttpError('Diary workout not found or not owned by you.', 404);
  const entries = await client.query<{
    duration_minutes: number;
    is_weekly_prefill: boolean;
    source: string | null;
    sets: {
      completed_at: string | null;
      reps: number | null;
      duration: number | null;
      distance: number | null;
    }[];
  }>(
    `SELECT ee.duration_minutes, ee.is_weekly_prefill, ee.source,
       COALESCE((SELECT json_agg(json_build_object('completed_at', s.completed_at,
         'reps', s.reps, 'duration', s.duration, 'distance', s.distance))
         FROM exercise_entry_sets s WHERE s.exercise_entry_id = ee.id), '[]') AS sets
     FROM exercise_entries ee
     WHERE ee.user_id = $2 AND ${workout.type === 'preset' ? 'ee.exercise_preset_entry_id' : 'ee.id'} = $1
     FOR SHARE`,
    [workout.id, userId]
  );
  const eligible =
    workout.type === 'preset'
      ? canLinkDiaryWorkout({ type: 'preset', exercises: entries.rows })
      : entries.rows[0] &&
        canLinkDiaryWorkout({ type: 'individual', ...entries.rows[0] });
  if (!eligible)
    throw new HttpError(
      'Link a workout with at least one performed set, or a duration-only individual entry with a positive duration.',
      400
    );
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
  const movable = `status = 'planned' AND effective_date > $3::date AND NOT (${omittedSessionSql('$4::date')})`;
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
    const locked = await client.query<{ id: string; auto_shift: boolean }>(
      'SELECT id, auto_shift FROM training_programs WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [programId, userId]
    );
    if (!locked.rowCount)
      throw new HttpError('Training Program not found.', 404);
    await client.query(
      'SELECT id FROM training_program_sessions WHERE id = $1 AND program_id = $2 AND user_id = $3 FOR UPDATE',
      [sessionId, programId, userId]
    );
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
      if (locked.rows[0]!.auto_shift)
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

function matchesPerformedWorkout(
  saved: PresetSessionResponse,
  entryDate: string,
  sessionId: string,
  performed: PresetSessionExerciseRequest[]
): boolean {
  const marker = saved.activity_details.some((detail) => {
    const data = detail.detail_data;
    return (
      detail.detail_type === 'training_program_completion' &&
      typeof data === 'object' &&
      data !== null &&
      'session_id' in data &&
      data.session_id === sessionId
    );
  });
  if (
    !marker ||
    saved.entry_date !== entryDate ||
    saved.exercises.length !== performed.length
  )
    return false;
  const fields = [
    'set_number',
    'set_type',
    'reps',
    'weight',
    'duration',
    'distance',
    'rest_time',
    'notes',
    'rpe',
    'rir',
  ] as const;
  return performed.every((exercise, index) => {
    const logged = saved.exercises[index];
    return (
      !!logged &&
      logged.exercise_id === exercise.exercise_id &&
      Number(logged.workout_plan_assignment_id) ===
        Number(exercise.workout_plan_assignment_id) &&
      (logged.notes ?? null) === (exercise.notes ?? null) &&
      logged.sets.length === exercise.sets.length &&
      exercise.sets.every((set, setIndex) => {
        const actual = logged.sets[setIndex];
        return (
          !!actual &&
          fields.every((field) =>
            field === 'rir'
              ? displaySetRir({ ...set, rir: set.rir ?? undefined }) ===
                displaySetRir({ ...actual, rir: actual.rir ?? undefined })
              : (set[field] ?? null) === (actual[field] ?? null)
          ) &&
          (!set.completed_at ||
            Date.parse(set.completed_at) ===
              Date.parse(actual.completed_at ?? ''))
        );
      })
    );
  });
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
    if (!session.workout_session_id)
      throw new HttpError(
        'This Planned Session has no bound Workout Session.',
        409
      );
    if (session.status === 'completed') {
      if (performedExercises) {
        const linked = session.completed_workout;
        const saved =
          linked?.type === 'preset'
            ? await getGroupedExerciseSessionByIdWithClient(
                client,
                userId,
                linked.id
              )
            : null;
        if (
          !saved ||
          !matchesPerformedWorkout(
            saved,
            entryDate,
            sessionId,
            performedExercises
          )
        ) {
          throw new TrainingProgramCompletionConflict(current);
        }
      }
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
      { programSessionId: sessionId, performedExercises }
    );
    if (!created.session)
      throw new Error('Created diary workout could not be read.');
    await client.query(
      `UPDATE exercise_entry_sets SET completed_at = now()
       WHERE completed_at IS NULL AND exercise_entry_id IN (
         SELECT id FROM exercise_entries WHERE exercise_preset_entry_id = $1 AND user_id = $2
       )`,
      [created.session.id, userId]
    );
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

/** Caller owns the transaction, including persisting the returned attempt link. */
export async function updatePlannedSessionLink(
  client: PoolClient,
  userId: string,
  authenticatedUserId: string,
  attemptId: string,
  testType: CardioTestAttempts['test_type'],
  requestedLink: string | null | undefined
): Promise<string | null | undefined> {
  const observed = await client.query<{ planned_session_id: string | null }>(
    'SELECT planned_session_id FROM cardio_test_attempts WHERE id = $1 AND user_id = $2 AND test_type = $3',
    [attemptId, userId, testType]
  );
  if (!observed.rowCount) return undefined;
  const observedLink = observed.rows[0]!.planned_session_id;
  const newLink = requestedLink === undefined ? observedLink : requestedLink;
  if (observedLink && userId !== authenticatedUserId) return undefined;
  if (newLink && userId !== authenticatedUserId)
    throw new HttpError('Training Programs are owner-only.', 403);
  await lockAssessmentSessions(client, userId, [observedLink, newLink]);
  const existing = await client.query<{ planned_session_id: string | null }>(
    'SELECT planned_session_id FROM cardio_test_attempts WHERE id = $1 AND user_id = $2 AND test_type = $3 FOR UPDATE',
    [attemptId, userId, testType]
  );
  if (!existing.rowCount) return undefined;
  const oldLink = existing.rows[0]!.planned_session_id;
  if (oldLink && userId !== authenticatedUserId) return undefined;
  if (newLink && userId !== authenticatedUserId)
    throw new HttpError('Training Programs are owner-only.', 403);
  if (oldLink !== observedLink)
    throw new HttpError(
      'This Test Attempt changed. Reload and try again.',
      409
    );
  if (newLink !== oldLink) {
    if (oldLink) {
      const released = await client.query<{ program_id: string }>(
        "UPDATE training_program_sessions SET status = 'planned', outcome_at = NULL, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING program_id",
        [oldLink, userId]
      );
      if (released.rowCount)
        await client.query(
          'UPDATE training_programs SET updated_at = now() WHERE id = $1 AND user_id = $2',
          [released.rows[0]!.program_id, userId]
        );
    }
    if (newLink) await claimLockedAssessment(client, userId, newLink, testType);
  }
  return newLink;
}

// Parent locks also serialize Program edits/deletion; session locks precede
// attempts even when editing measurements without changing the link.
async function lockAssessmentSessions(
  client: PoolClient,
  userId: string,
  sessionIds: (string | null)[]
): Promise<void> {
  const ids = sessionIds.filter((id): id is string => id !== null);
  if (!ids.length) return;
  await client.query(
    `SELECT id FROM training_programs
     WHERE user_id = $1 AND id IN (
       SELECT program_id FROM training_program_sessions
       WHERE user_id = $1 AND id = ANY($2::uuid[])
     )
     ORDER BY id FOR UPDATE`,
    [userId, ids]
  );
  await client.query(
    `SELECT id FROM training_program_sessions
     WHERE user_id = $1 AND id = ANY($2::uuid[])
     ORDER BY id FOR UPDATE`,
    [userId, ids]
  );
}

/** Caller inserts the Test Attempt in the same transaction as this claim. */
export async function claimPlannedSession(
  client: PoolClient,
  userId: string,
  authenticatedUserId: string,
  sessionId: string,
  testType: CardioTestAttempts['test_type']
): Promise<void> {
  if (userId !== authenticatedUserId)
    throw new HttpError('Training Programs are owner-only.', 403);
  await lockAssessmentSessions(client, userId, [sessionId]);
  await claimLockedAssessment(client, userId, sessionId, testType);
}

async function claimLockedAssessment(
  client: PoolClient,
  userId: string,
  sessionId: string,
  testType: CardioTestAttempts['test_type']
): Promise<void> {
  const program = await client.query<{ program_id: string }>(
    'SELECT program_id FROM training_program_sessions WHERE id = $1 AND user_id = $2',
    [sessionId, userId]
  );
  if (!program.rowCount)
    throw new HttpError('Planned assessment not found.', 404);
  const session = await client.query<{
    status: string;
    cardio_test_type: string | null;
    is_optional: boolean;
  }>(
    'SELECT status, cardio_test_type, is_optional FROM training_program_sessions WHERE id = $1 AND user_id = $2',
    [sessionId, userId]
  );
  if (!session.rowCount)
    throw new HttpError('Planned assessment not found.', 404);
  if (session.rows[0]!.cardio_test_type !== testType)
    throw new HttpError(
      'This Planned Session uses a different Cardio Test protocol.',
      400
    );
  if (
    session.rows[0]!.status !== 'planned' &&
    !(session.rows[0]!.status === 'omitted' && session.rows[0]!.is_optional)
  )
    throw new HttpError('This Planned Session already has an outcome.', 409);
  await client.query(
    "UPDATE training_program_sessions SET status = 'completed', outcome_at = now(), updated_at = now() WHERE id = $1 AND user_id = $2",
    [sessionId, userId]
  );
  await client.query(
    'UPDATE training_programs SET updated_at = now() WHERE id = $1 AND user_id = $2',
    [program.rows[0]!.program_id, userId]
  );
}
