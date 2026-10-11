import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { getWorkoutSessionForAssignments } from '../models/exerciseTemplate.js';

vi.mock('../db/poolManager.js', () => ({ getClient: vi.fn() }));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../services/exerciseService.js', () => ({
  default: { logWorkoutPlanSession: vi.fn() },
}));

describe('linked completion session identity', () => {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';

  it.each([
    {
      label: 'missing or RLS-hidden assignment',
      links: [{ id: 51, workout_session_id: first }],
      parentVisible: true,
    },
    {
      label: 'same-label sessions with distinct UUIDs',
      links: [
        { id: 51, workout_session_id: first },
        { id: 52, workout_session_id: second },
      ],
      parentVisible: true,
    },
    {
      label: 'inaccessible parent session',
      links: [
        { id: 51, workout_session_id: first },
        { id: 52, workout_session_id: first },
      ],
      parentVisible: false,
    },
  ])(
    'rejects $label without guessing a session',
    async ({ links, parentVisible }) => {
      const query = vi
        .fn()
        .mockResolvedValueOnce({ rows: links })
        .mockResolvedValueOnce({
          rows: parentVisible
            ? [{ id: first, name: 'A', assignments: [{ id: 51 }, { id: 52 }] }]
            : [],
        });
      // A query-only fake deliberately supplies just the PoolClient behavior used here.
      const client = { query } as unknown as PoolClient;
      expect(
        await getWorkoutSessionForAssignments('owner', [51, 52], client)
      ).toBeNull();
    }
  );

  it('accepts only the exact shared session containing every linked assignment', async () => {
    const session = {
      id: second,
      name: 'A',
      assignments: [{ id: 51 }, { id: 52 }],
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          { id: 51, workout_session_id: second },
          { id: 52, workout_session_id: second },
        ],
      })
      .mockResolvedValueOnce({ rows: [session] });
    // A query-only fake deliberately supplies just the PoolClient behavior used here.
    const client = { query } as unknown as PoolClient;
    expect(
      await getWorkoutSessionForAssignments('owner', [51, 52], client)
    ).toEqual(session);
  });
});
