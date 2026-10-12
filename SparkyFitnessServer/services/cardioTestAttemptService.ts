import { z } from 'zod';
import {
  cardioTestAttemptsSchema,
  cooperRunAttemptInputSchema,
  type CardioTestAttempts,
  type CooperRunAttempt,
} from '@workspace/shared';
import {
  createCooperRunAttempt,
  listCooperRunAttempts,
  updateCooperRunAttempt,
} from '../models/cardioTestAttemptRepository.js';
import { HttpError } from '../utils/errors.js';

function parseId(id: string): string {
  const result = z.uuid().safeParse(id);
  if (!result.success) {
    throw new HttpError('Invalid Test Attempt ID.', 400);
  }
  return result.data;
}

function parseInput(input: unknown) {
  const result = cooperRunAttemptInputSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new HttpError(`${issue.path.join('.')}: ${issue.message}`, 400);
  }
  return result.data;
}

function response(attempt: CardioTestAttempts): CooperRunAttempt {
  const normalized = cardioTestAttemptsSchema.parse(attempt);
  return {
    id: normalized.id,
    user_id: normalized.user_id,
    test_type: normalized.test_type,
    attempt_date: normalized.attempt_date,
    distance_meters: normalized.results.distance_meters,
    created_at: normalized.created_at.toISOString(),
    updated_at: normalized.updated_at.toISOString(),
  };
}

export async function getCooperRunAttempts(
  userId: string,
  authenticatedUserId: string
): Promise<CooperRunAttempt[]> {
  const attempts = await listCooperRunAttempts(userId, authenticatedUserId);
  return attempts.map(response);
}

export async function createCooperRunTestAttempt(
  userId: string,
  authenticatedUserId: string,
  input: unknown
): Promise<CooperRunAttempt> {
  const attempt = await createCooperRunAttempt(
    userId,
    authenticatedUserId,
    parseInput(input)
  );
  return response(attempt);
}

export async function editCooperRunTestAttempt(
  userId: string,
  authenticatedUserId: string,
  id: string,
  input: unknown
): Promise<CooperRunAttempt> {
  const attempt = await updateCooperRunAttempt(
    userId,
    authenticatedUserId,
    parseId(id),
    parseInput(input)
  );
  if (!attempt) {
    throw new HttpError('Test Attempt not found.', 404);
  }
  return response(attempt);
}
