import type {
  CardioTestAttempts,
  CooperRunAttemptInput,
  CardioTestAttemptInput,
} from '@workspace/shared';
import type { PoolClient } from 'pg';
import { getClient } from '../db/poolManager.js';

function fromRow(row: {
  id: string;
  user_id: string;
  test_type: 'cooper_run';
  attempt_date: string;
  results: { distance_meters: number };
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
      `SELECT id, user_id, test_type, attempt_date, results, created_at, updated_at
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
    const values = [
      userId,
      input.test_type,
      input.attempt_date,
      JSON.stringify(input.results),
    ];
    const result = id
      ? await client.query<AttemptRow>(
          `UPDATE cardio_test_attempts SET attempt_date = $3, results = $4::jsonb, updated_at = now()
           WHERE id = $5 AND user_id = $1 AND test_type = $2
           RETURNING id, user_id, test_type, attempt_date, results, created_at, updated_at`,
          [...values, id]
        )
      : await client.query<AttemptRow>(
          `INSERT INTO cardio_test_attempts (user_id, test_type, attempt_date, results)
           VALUES ($1, $2, $3, $4::jsonb)
           RETURNING id, user_id, test_type, attempt_date, results, created_at, updated_at`,
          values
        );
    return (result.rows[0] as CardioTestAttempts | undefined) ?? null;
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
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, user_id, test_type, attempt_date, results, created_at, updated_at
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
    const result = await client.query<{
      id: string;
      user_id: string;
      test_type: 'cooper_run';
      attempt_date: string;
      results: { distance_meters: number };
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO cardio_test_attempts (user_id, test_type, attempt_date, results)
       VALUES ($1, 'cooper_run', $2, jsonb_build_object('distance_meters', $3::numeric))
       RETURNING id, user_id, test_type, attempt_date, results, created_at, updated_at`,
      [userId, input.attempt_date, input.distance_meters]
    );
    return fromRow(result.rows[0]!);
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
    const result = await client.query<{
      id: string;
      user_id: string;
      test_type: 'cooper_run';
      attempt_date: string;
      results: { distance_meters: number };
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE cardio_test_attempts
       SET attempt_date = $3,
           results = jsonb_build_object('distance_meters', $4::numeric),
           updated_at = now()
       WHERE id = $1 AND user_id = $2 AND test_type = 'cooper_run'
       RETURNING id, user_id, test_type, attempt_date, results, created_at, updated_at`,
      [id, userId, input.attempt_date, input.distance_meters]
    );
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  } finally {
    client.release();
  }
}
