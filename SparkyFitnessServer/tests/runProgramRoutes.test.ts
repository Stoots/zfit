import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error TS7016 supertest typing
import request from 'supertest';
import express from 'express';
import errorHandler from '../middleware/errorHandler.js';
import runProgramRoutes from '../routes/v2/runProgramRoutes.js';
import {
  completeRunProgramWorkout,
  getRunProgram,
  rateRunProgramWorkout,
  UnknownRunProgramError,
  upsertRunProgram,
} from '../models/runProgramRepository.js';

vi.mock('../models/runProgramRepository.js', () => {
  class UnknownRunProgramError extends Error {}
  return {
    getRunProgram: vi.fn(),
    upsertRunProgram: vi.fn(),
    completeRunProgramWorkout: vi.fn(),
    rateRunProgramWorkout: vi.fn(),
    UnknownRunProgramError,
  };
});

let actingAs = 'test-user-id';
const app = express();
app.use(express.json());
app.use(
  (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => {
    req.userId = 'test-user-id';
    req.authenticatedUserId = actingAs;
    req.originalUserId = actingAs;
    next();
  }
);
app.use('/api/v2/run-program', runProgramRoutes);
app.use(errorHandler);

const program = {
  id: 'p1',
  program_id: 'beginner5k',
  enabled: true,
  next_index: 0,
  workouts: [],
  adjustment_log: [],
  effort_log: [],
  completion_log: [],
  run_days: [],
  start_date: null,
  end_date: null,
  last_done_date: null,
  updated_at: '2026-10-10T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  actingAs = 'test-user-id';
});

describe('run program routes', () => {
  it('returns null before a program is chosen', async () => {
    vi.mocked(getRunProgram).mockResolvedValue(null);
    const res = await request(app).get('/api/v2/run-program');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ program: null });
  });

  it('starts a program', async () => {
    vi.mocked(upsertRunProgram).mockResolvedValue(program);
    const res = await request(app)
      .put('/api/v2/run-program')
      .send({ program_id: 'beginner5k' });
    expect(res.status).toBe(200);
    expect(upsertRunProgram).toHaveBeenCalledWith(
      'test-user-id',
      { program_id: 'beginner5k' },
      'test-user-id'
    );
  });

  it('rejects a bad body and an unknown program', async () => {
    const bad = await request(app)
      .put('/api/v2/run-program')
      .send({ program_id: 'beginner5k', next_index: -1 });
    expect(bad.status).toBe(400);

    vi.mocked(upsertRunProgram).mockRejectedValue(
      new UnknownRunProgramError('nope')
    );
    const unknown = await request(app)
      .put('/api/v2/run-program')
      .send({ program_id: 'nope' });
    expect(unknown.status).toBe(400);
  });

  it('completes the due workout and returns the program', async () => {
    vi.mocked(completeRunProgramWorkout).mockResolvedValue(program);
    vi.mocked(getRunProgram).mockResolvedValue(program);
    const res = await request(app)
      .post('/api/v2/run-program/complete')
      .send({ index: 0 });
    expect(res.status).toBe(200);
    expect(completeRunProgramWorkout).toHaveBeenCalledWith(
      'test-user-id',
      0,
      'test-user-id',
      { programId: undefined, day: undefined, entryId: undefined }
    );
    expect(res.body.program.id).toBe('p1');
  });

  it('only completes a workout of the program it was done under', async () => {
    vi.mocked(completeRunProgramWorkout).mockResolvedValue(program);
    vi.mocked(getRunProgram).mockResolvedValue(program);
    await request(app)
      .post('/api/v2/run-program/complete')
      .send({ index: 2, program_id: 'beginner5k' });
    expect(completeRunProgramWorkout).toHaveBeenLastCalledWith(
      'test-user-id',
      2,
      'test-user-id',
      { programId: 'beginner5k', day: undefined, entryId: undefined }
    );
  });

  it('records which diary entry a workout was done as', async () => {
    vi.mocked(completeRunProgramWorkout).mockResolvedValue(program);
    vi.mocked(getRunProgram).mockResolvedValue(program);
    await request(app)
      .post('/api/v2/run-program/complete')
      .send({ index: 1, day: '2026-10-12', entry_id: 'entry-9' });
    expect(completeRunProgramWorkout).toHaveBeenLastCalledWith(
      'test-user-id',
      1,
      'test-user-id',
      { programId: undefined, day: '2026-10-12', entryId: 'entry-9' }
    );
  });

  it('records how hard a finished workout felt', async () => {
    vi.mocked(rateRunProgramWorkout).mockResolvedValue(program);
    vi.mocked(getRunProgram).mockResolvedValue(program);
    const res = await request(app)
      .post('/api/v2/run-program/effort')
      .send({ index: 3, rating: 8, program_id: 'beginner5k' });
    expect(res.status).toBe(200);
    expect(rateRunProgramWorkout).toHaveBeenCalledWith(
      'test-user-id',
      3,
      8,
      'test-user-id',
      'beginner5k'
    );
  });

  it('rejects a rating outside 1 to 10', async () => {
    for (const rating of [0, 11, 5.5]) {
      const res = await request(app)
        .post('/api/v2/run-program/effort')
        .send({ index: 3, rating });
      expect(res.status).toBe(400);
    }
    expect(rateRunProgramWorkout).not.toHaveBeenCalled();
  });

  it('refuses to rate on behalf of someone else', async () => {
    actingAs = 'someone-else';
    const res = await request(app)
      .post('/api/v2/run-program/effort')
      .send({ index: 3, rating: 8 });
    expect(res.status).toBe(403);
    expect(rateRunProgramWorkout).not.toHaveBeenCalled();
  });

  it('records the day a workout was done', async () => {
    vi.mocked(completeRunProgramWorkout).mockResolvedValue(program);
    vi.mocked(getRunProgram).mockResolvedValue(program);
    await request(app)
      .post('/api/v2/run-program/complete')
      .send({ index: 1, day: '2026-10-12' });
    expect(completeRunProgramWorkout).toHaveBeenLastCalledWith(
      'test-user-id',
      1,
      'test-user-id',
      { programId: undefined, day: '2026-10-12', entryId: undefined }
    );
  });

  it('saves the Diary days and the first day, and rejects bad ones', async () => {
    vi.mocked(upsertRunProgram).mockResolvedValue(program);
    const ok = await request(app)
      .put('/api/v2/run-program')
      .send({
        program_id: 'beginner5k',
        run_days: [1, 3, 5],
        start_date: '2026-10-13',
      });
    expect(ok.status).toBe(200);
    expect(upsertRunProgram).toHaveBeenLastCalledWith(
      'test-user-id',
      expect.objectContaining({
        run_days: [1, 3, 5],
        start_date: '2026-10-13',
      }),
      'test-user-id'
    );
    const cleared = await request(app)
      .put('/api/v2/run-program')
      .send({ program_id: 'beginner5k', start_date: null });
    expect(cleared.status).toBe(200);
    const goal = await request(app)
      .put('/api/v2/run-program')
      .send({ program_id: 'beginner5k', end_date: '2026-12-06' });
    expect(goal.status).toBe(200);
    expect(upsertRunProgram).toHaveBeenLastCalledWith(
      'test-user-id',
      expect.objectContaining({ end_date: '2026-12-06' }),
      'test-user-id'
    );
    for (const bad of [
      { run_days: [7] },
      { start_date: 'tomorrow' },
      { end_date: '12/06' },
      // The right shape but not a day, and a goal before the first day.
      { start_date: '2026-02-31' },
      { end_date: '2026-13-01' },
      { start_date: '2026-10-20', end_date: '2026-10-19' },
    ]) {
      const res = await request(app)
        .put('/api/v2/run-program')
        .send({ program_id: 'beginner5k', ...bad });
      expect(res.status).toBe(400);
    }
  });

  it('rejects an impossible day on completion too', async () => {
    const res = await request(app)
      .post('/api/v2/run-program/complete')
      .send({ index: 0, day: '2026-02-30' });
    expect(res.status).toBe(400);
  });

  it('validates the completed index', async () => {
    const res = await request(app)
      .post('/api/v2/run-program/complete')
      .send({ index: 'x' });
    expect(res.status).toBe(400);
  });

  it('is owner-only: a delegated context is refused', async () => {
    actingAs = 'someone-else';
    const res = await request(app).get('/api/v2/run-program');
    expect(res.status).toBe(403);
    expect(getRunProgram).not.toHaveBeenCalled();
  });
});
