import { z } from 'zod';
import {
  cardioTestAttemptsSchema,
  cooperRunAttemptInputSchema,
  cardioTestAttemptInputSchema,
  cardioTestAttemptSchema,
  cardioTestTypeSchema,
  type CardioTestAttempt,
  type CardioTestAttempts,
  type CooperRunAttempt,
} from '@workspace/shared';
import {
  createCooperRunAttempt,
  listCooperRunAttempts,
  updateCooperRunAttempt,
  listCardioTestAttempts,
  saveCardioTestAttempt,
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
  if (normalized.test_type !== 'cooper_run')
    throw new Error('Expected Cooper run attempt');
  return {
    id: normalized.id,
    user_id: normalized.user_id,
    test_type: normalized.test_type,
    attempt_date: normalized.attempt_date,
    distance_meters: normalized.results.distance_meters,
    planned_session_id: normalized.planned_session_id,
    created_at: normalized.created_at.toISOString(),
    updated_at: normalized.updated_at.toISOString(),
  };
}

function protocolResponse(attempt: CardioTestAttempts): CardioTestAttempt {
  const normalized = cardioTestAttemptsSchema.parse(attempt);
  if (normalized.test_type === 'cooper_run')
    throw new Error('Expected protocol attempt');
  return cardioTestAttemptSchema.parse({
    ...normalized,
    created_at: normalized.created_at.toISOString(),
    updated_at: normalized.updated_at.toISOString(),
  });
}

export async function getProtocolAttempts(
  userId: string,
  authenticatedUserId: string,
  protocol: string
) {
  const testType = cardioTestTypeSchema.safeParse(protocol);
  if (!testType.success || testType.data === 'cooper_run')
    throw new HttpError('Unknown Test protocol.', 404);
  return (
    await listCardioTestAttempts(userId, authenticatedUserId, testType.data)
  ).map(protocolResponse);
}

export async function saveProtocolAttempt(
  userId: string,
  authenticatedUserId: string,
  protocol: string,
  body: unknown,
  id?: string
): Promise<CardioTestAttempt> {
  const parsed = cardioTestAttemptInputSchema.safeParse(body);
  if (!parsed.success || parsed.data.test_type !== protocol) {
    throw new HttpError(
      parsed.success
        ? 'Test protocol does not match URL.'
        : parsed.error.issues[0]!.message,
      400
    );
  }
  const attempt = await saveCardioTestAttempt(
    userId,
    authenticatedUserId,
    parsed.data,
    id ? parseId(id) : undefined
  );
  if (!attempt) throw new HttpError('Test Attempt not found.', 404);
  return protocolResponse(attempt);
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
