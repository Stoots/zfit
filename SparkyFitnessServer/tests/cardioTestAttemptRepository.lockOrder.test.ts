import { expect, it, vi } from 'vitest';
import { getClient } from '../db/poolManager.js';
import { updateCooperRunAttempt } from '../models/cardioTestAttemptRepository.js';

vi.mock('../db/poolManager.js', () => ({ getClient: vi.fn() }));

it('locks both Programs in ID order before moving an attempt between sessions', async () => {
  const oldSession = '11111111-1111-4111-8111-111111111111';
  const newSession = '22222222-2222-4222-8222-222222222222';
  const oldProgram = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const newProgram = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.startsWith('SELECT planned_session_id FROM cardio_test_attempts'))
      return { rowCount: 1, rows: [{ planned_session_id: oldSession }] };
    if (
      sql.startsWith("UPDATE training_program_sessions SET status = 'planned'")
    )
      return { rowCount: 1, rows: [{ program_id: oldProgram }] };
    if (sql.startsWith('SELECT program_id FROM training_program_sessions'))
      return { rowCount: 1, rows: [{ program_id: newProgram }] };
    if (sql.startsWith('SELECT status, cardio_test_type'))
      return {
        rowCount: 1,
        rows: [
          {
            status: 'planned',
            cardio_test_type: 'cooper_run',
            is_optional: false,
          },
        ],
      };
    if (sql.includes('UPDATE cardio_test_attempts'))
      return {
        rowCount: 1,
        rows: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            user_id: 'owner',
            test_type: 'cooper_run',
            attempt_date: '2026-10-14',
            results: { distance_meters: 2400 },
            planned_session_id: newSession,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      };
    return { rowCount: 1, rows: [{ id: newProgram }] };
  });
  vi.mocked(getClient).mockResolvedValue({ query, release: vi.fn() } as never);

  await updateCooperRunAttempt(
    'owner',
    'owner',
    '33333333-3333-4333-8333-333333333333',
    {
      attempt_date: '2026-10-14',
      distance_meters: 2400,
      planned_session_id: newSession,
    }
  );

  const calls = query.mock.calls.map(([sql]) => sql);
  const lock = calls.findIndex((sql) => sql.includes('ORDER BY id FOR UPDATE'));
  const release = calls.findIndex((sql) =>
    sql.startsWith("UPDATE training_program_sessions SET status = 'planned'")
  );
  const claim = calls.findIndex((sql) =>
    sql.startsWith('SELECT status, cardio_test_type')
  );
  expect(lock).toBeGreaterThan(-1);
  expect(lock).toBeLessThan(release);
  expect(lock).toBeLessThan(claim);
  expect(query.mock.calls[lock]?.[1]).toEqual([
    'owner',
    [oldSession, newSession],
  ]);
});
