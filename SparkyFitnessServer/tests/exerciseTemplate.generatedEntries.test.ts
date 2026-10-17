import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient } from '../db/poolManager.js';
import exerciseService from '../services/exerciseService.js';
import { createExerciseEntriesFromTemplate } from '../models/exerciseTemplate.js';

vi.mock('../db/poolManager.js', () => ({ getClient: vi.fn() }));
vi.mock('../services/exerciseService.js', () => ({
  default: { logWorkoutPlanSession: vi.fn() },
}));

// Session prescriptions replace the old standalone/preset assignment model.
describe('generated session entries (#2677)', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([0, 1])(
    'preserves surviving diary rows (occupied=%i)',
    async (occupied) => {
      const results = [
        {
          rows: [
            {
              schedule_type: 'weekly',
              start_date: '2026-10-07',
              end_date: '2026-10-07',
              sessions: [{ id: 'session', day_of_week: 3 }],
            },
          ],
        },
        { rows: [{ id: 7 }] },
        { rows: [] },
        { rows: [] },
        { rows: [], rowCount: occupied },
        { rows: [] },
      ];
      const client = {
        query: vi.fn(async () => results.shift()),
        release: vi.fn(),
      };
      vi.mocked(getClient).mockResolvedValue(client as never);
      vi.mocked(exerciseService.logWorkoutPlanSession).mockResolvedValue({
        session: { id: 'diary' },
      } as never);

      await createExerciseEntriesFromTemplate(42, 'owner', '2026-10-07');

      expect(exerciseService.logWorkoutPlanSession).toHaveBeenCalledTimes(
        occupied ? 0 : 1
      );
      if (!occupied) {
        expect(exerciseService.logWorkoutPlanSession).toHaveBeenCalledWith(
          'owner',
          'owner',
          'session',
          '2026-10-07',
          undefined,
          new Set([7]),
          undefined,
          undefined
        );
        expect(client.query).toHaveBeenLastCalledWith(
          expect.stringContaining('SET is_weekly_prefill = true'),
          ['owner', 'diary', [7]]
        );
      }
      expect(client.release).toHaveBeenCalledOnce();
    }
  );
});
