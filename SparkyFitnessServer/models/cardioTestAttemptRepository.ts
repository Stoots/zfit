import type {
  CardioTestAttempts,
  CooperRunAttemptInput,
  CardioTestAttemptInput,
} from '@workspace/shared';
import type { PoolClient } from 'pg';
import { getClient } from '../db/poolManager.js';
import { HttpError } from '../utils/errors.js';

function fromRow(row: {
  id: string;
  user_id: string;
  test_type: 'cooper_run';
  attempt_date: string;
  results: { distance_meters: number };
  planned_session_id: string | null;
  created_at: Date;
  updated_at: Date;
}): CardioTestAttempts {
  return {
    ...row,
    attempt_date: row.attempt_date,
    results: row.results,
  };
}

type AttemptRow = {
  id: string;
  user_id: string;
  test_type: CardioTestAttempts['test_type'];
  attempt_date: string;
  results: CardioTestAttempts['results'];
  planned_session_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export async function listCardioTestAttempts(
  userId: string,
  authenticatedUserId: string,
  testType: CardioTestAttemptInput['test_type']
): Promise<CardioTestAttempts[]> {
  const client: PoolClient = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query<AttemptRow>(
      `SELECT id, user_id, test_type, attempt_date::text, results, planned_session_id, created_at, updated_at
       FROM cardio_test_attempts WHERE user_id = $1 AND test_type = $2
       ORDER BY attempt_date ASC, created_at ASC, id ASC`,
      [userId, testType]
    );
    return result.rows as CardioTestAttempts[];
  } finally {
    client.release();
  }
}

export async function saveCardioTestAttempt(
  userId: string,
  authenticatedUserId: string,
  input: CardioTestAttemptInput,
  id?: string
): Promise<CardioTestAttempts | null> {
  const client: PoolClient = await getClient(userId, authenticatedUserId);
  try {
    await client.query('BEGIN');
    let plannedSessionId = input.planned_session_id ?? null;
    if (id) {
      const updatedLink = await updatePlannedSessionLink(
        client,
        userId,
        authenticatedUserId,
        id,
        input.test_type,
        input.planned_session_id
      );
      if (updatedLink === undefined) {
        await client.query('ROLLBACK');
        return null;
      }
      plannedSessionId = updatedLink;
    } else if (plannedSessionId) {
      await claimPlannedSession(
        client,
        userId,
        authenticatedUserId,
        plannedSessionId,
        input.test_type
      );
    }
    const values = [
      userId,
      input.test_type,
      input.attempt_date,
      JSON.stringify(input.results),
      plannedSessionId,
    ];
    const result = id
      ? await client.query<AttemptRow>(
          `UPDATE cardio_test_attempts SET attempt_date = $3, results = $4::jsonb, planned_session_id = $5, updated_at = now()
           WHERE id = $6 AND user_id = $1 AND test_type = $2
           RETURNING id, user_id, test_type, attempt_date::text, results, planned_session_id, created_at, updated_at`,
          [...values, id]
        )
      : await client.query<AttemptRow>(
          `INSERT INTO cardio_test_attempts (user_id, test_type, attempt_date, results, planned_session_id)
           VALUES ($1, $2, $3, $4::jsonb, $5)
           RETURNING id, user_id, test_type, attempt_date::text, results, planned_session_id, created_at, updated_at`,
          values
        );
    await client.query('COMMIT');
    return (result.rows[0] as CardioTestAttempts | undefined) ?? null;
  } catch (error) {
    await client.query('ROLLBACK');
    if (isDuplicateLink(error))
      throw new HttpError('This assessment already has a Test Attempt.', 409);
    throw error;
  } finally {
    client.release();
  }
}

export async function listCooperRunAttempts(
  userId: string,
  authenticatedUserId: string
): Promise<CardioTestAttempts[]> {
  const client: PoolClient = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query<{
      id: string;
      user_id: string;
      test_type: 'cooper_run';
      attempt_date: string;
      results: { distance_meters: number };
      planned_session_id: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, user_id, test_type, attempt_date::text, results, planned_session_id, created_at, updated_at
       FROM cardio_test_attempts
       WHERE user_id = $1 AND test_type = 'cooper_run'
       ORDER BY attempt_date ASC, created_at ASC, id ASC`,
      [userId]
    );
    return result.rows.map(fromRow);
  } finally {
    client.release();
  }
}

export async function createCooperRunAttempt(
  userId: string,
  authenticatedUserId: string,
  input: CooperRunAttemptInput
): Promise<CardioTestAttempts> {
  const client: PoolClient = await getClient(userId, authenticatedUserId);
  try {
    await client.query('BEGIN');
    if (input.planned_session_id)
      await claimPlannedSession(
        client,
        userId,
        authenticatedUserId,
        input.planned_session_id,
        'cooper_run'
      );
    const result = await client.query<{
      id: string;
      user_id: string;
      test_type: 'cooper_run';
      attempt_date: string;
      results: { distance_meters: number };
      planned_session_id: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO cardio_test_attempts (user_id, test_type, attempt_date, results, planned_session_id)
       VALUES ($1, 'cooper_run', $2, jsonb_build_object('distance_meters', $3::numeric), $4)
       RETURNING id, user_id, test_type, attempt_date::text, results, planned_session_id, created_at, updated_at`,
      [
        userId,
        input.attempt_date,
        input.distance_meters,
        input.planned_session_id ?? null,
      ]
    );
    await client.query('COMMIT');
    return fromRow(result.rows[0]!);
  } catch (error) {
    await client.query('ROLLBACK');
    if (isDuplicateLink(error))
      throw new HttpError('This assessment already has a Test Attempt.', 409);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateCooperRunAttempt(
  userId: string,
  authenticatedUserId: string,
  id: string,
  input: CooperRunAttemptInput
): Promise<CardioTestAttempts | null> {
  const client: PoolClient = await getClient(userId, authenticatedUserId);
  try {
    await client.query('BEGIN');
    const newLink = await updatePlannedSessionLink(
      client,
      userId,
      authenticatedUserId,
      id,
      'cooper_run',
      input.planned_session_id
    );
    if (newLink === undefined) {
      await client.query('ROLLBACK');
      return null;
    }
    const result = await client.query<{
      id: string;
      user_id: string;
      test_type: 'cooper_run';
      attempt_date: string;
      results: { distance_meters: number };
      planned_session_id: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE cardio_test_attempts
       SET attempt_date = $3,
           results = jsonb_build_object('distance_meters', $4::numeric),
           planned_session_id = $5,
           updated_at = now()
       WHERE id = $1 AND user_id = $2 AND test_type = 'cooper_run'
       RETURNING id, user_id, test_type, attempt_date::text, results, planned_session_id, created_at, updated_at`,
      [id, userId, input.attempt_date, input.distance_meters, newLink]
    );
    await client.query('COMMIT');
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  } catch (error) {
    await client.query('ROLLBACK');
    if (isDuplicateLink(error))
      throw new HttpError('This assessment already has a Test Attempt.', 409);
    throw error;
  } finally {
    client.release();
  }
}

function isDuplicateLink(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'constraint' in error &&
    error.constraint === 'cardio_test_attempts_planned_session_key'
  );
}

async function updatePlannedSessionLink(
  client: PoolClient,
  userId: string,
  authenticatedUserId: string,
  attemptId: string,
  testType: CardioTestAttempts['test_type'],
  requestedLink: string | null | undefined
): Promise<string | null | undefined> {
  const existing = await client.query<{ planned_session_id: string | null }>(
    'SELECT planned_session_id FROM cardio_test_attempts WHERE id = $1 AND user_id = $2 AND test_type = $3 FOR UPDATE',
    [attemptId, userId, testType]
  );
  if (!existing.rowCount) return undefined;
  const oldLink = existing.rows[0]!.planned_session_id;
  const newLink = requestedLink === undefined ? oldLink : requestedLink;
  if ((oldLink || newLink) && userId !== authenticatedUserId)
    throw new HttpError('Training Programs are owner-only.', 403);
  if (newLink !== oldLink) {
    if (oldLink)
      await client.query(
        "UPDATE training_program_sessions SET status = 'planned', outcome_at = NULL, updated_at = now() WHERE id = $1 AND user_id = $2",
        [oldLink, userId]
      );
    if (newLink)
      await claimPlannedSession(
        client,
        userId,
        authenticatedUserId,
        newLink,
        testType
      );
  }
  return newLink;
}

async function claimPlannedSession(
  client: PoolClient,
  userId: string,
  authenticatedUserId: string,
  sessionId: string,
  testType: CardioTestAttempts['test_type']
): Promise<void> {
  if (userId !== authenticatedUserId)
    throw new HttpError('Training Programs are owner-only.', 403);
  const program = await client.query<{ program_id: string }>(
    'SELECT program_id FROM training_program_sessions WHERE id = $1 AND user_id = $2',
    [sessionId, userId]
  );
  if (!program.rowCount)
    throw new HttpError('Planned assessment not found.', 404);
  await client.query(
    'SELECT id FROM training_programs WHERE id = $1 AND user_id = $2 FOR UPDATE',
    [program.rows[0]!.program_id, userId]
  );
  const session = await client.query<{
    status: string;
    cardio_test_type: string | null;
    is_optional: boolean;
  }>(
    'SELECT status, cardio_test_type, is_optional FROM training_program_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE',
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
