import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../utils/errors.js';
import {
  createCooperRunTestAttempt,
  editCooperRunTestAttempt,
} from '../services/cardioTestAttemptService.js';

const repository = vi.hoisted(() => ({
  createCooperRunAttempt: vi.fn(),
  listCooperRunAttempts: vi.fn(),
  updateCooperRunAttempt: vi.fn(),
}));

vi.mock('../models/cardioTestAttemptRepository.js', () => repository);

const TEST_UUID = '3e45529c-5675-4e98-b105-ec8bf8a3a7a2';
const validInput = { attempt_date: '2026-10-01', distance_meters: 2400 };

async function expectHttpError(action: () => Promise<unknown>, status: number) {
  try {
    await action();
    throw new Error('Expected an HttpError');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status });
  }
}

describe('cardio test attempt service errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a typed client error for an invalid attempt ID', async () => {
    await expectHttpError(
      () =>
        editCooperRunTestAttempt(TEST_UUID, TEST_UUID, 'invalid', validInput),
      400
    );
    expect(repository.updateCooperRunAttempt).not.toHaveBeenCalled();
  });

  it('returns a typed client error for invalid input', async () => {
    await expectHttpError(
      () =>
        createCooperRunTestAttempt(TEST_UUID, TEST_UUID, {
          attempt_date: '2026-10-01',
          distance_meters: 0,
        }),
      400
    );
    expect(repository.createCooperRunAttempt).not.toHaveBeenCalled();
  });

  it('returns a typed not-found error when the attempt is absent', async () => {
    repository.updateCooperRunAttempt.mockResolvedValueOnce(null);
    await expectHttpError(
      () =>
        editCooperRunTestAttempt(TEST_UUID, TEST_UUID, TEST_UUID, validInput),
      404
    );
  });
});
