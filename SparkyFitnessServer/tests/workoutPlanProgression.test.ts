import { describe, it, expect } from 'vitest';
import type { WorkoutPlanSessionResponse } from '@workspace/shared';
import {
  computeSequentialPlanProgression,
  type LoggedEntryProgressionInput,
} from '../services/workoutPlanProgression.js';

type SessionInput = Parameters<
  typeof computeSequentialPlanProgression
>[0][number] &
  Pick<WorkoutPlanSessionResponse, 'day_of_week'>;
const session = (
  id: string,
  name: string,
  sort_order: number,
  ids: number[]
): SessionInput => ({
  id,
  name,
  sort_order,
  day_of_week: null,
  assignments: ids.map((assignmentId, index) => ({
    id: assignmentId,
    sort_order: index,
  })),
});
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const logs = (...ids: (number | string)[]): LoggedEntryProgressionInput[] =>
  ids.map((id, index) => ({
    id: index + 1,
    workout_plan_assignment_id: id,
    entry_date: '2026-09-20',
  }));

describe('computeSequentialPlanProgression', () => {
  it('returns no session or sequence position for an empty plan', () => {
    const result = computeSequentialPlanProgression([], []);
    expect(result.nextAssignments).toEqual([]);
    expect(result.nextSession).toBeNull();
    expect(result.sequencePosition).toBeNull();
  });

  it('starts and wraps a single-session plan', () => {
    const only = session(A, 'Full Body A', 0, [101]);
    for (const history of [[], logs(101)]) {
      const result = computeSequentialPlanProgression([only], history);
      expect(result.nextSession).toEqual(only);
      expect(result.nextAssignments).toEqual(only.assignments);
      expect(result.sequencePosition).toEqual({
        current: 1,
        total: 1,
        session_name: 'Full Body A',
      });
    }
  });

  it('advances and wraps in authored session order, not input order or label', () => {
    const first = session(A, 'A', 0, [1]);
    const second = session(B, 'A', 1, [2]);
    const third = session(C, 'Legs', 2, [3]);
    const plan = [third, first, second];
    for (const [history, expected, current] of [
      [[], first, 1],
      [logs(1), second, 2],
      [logs(1, 2), third, 3],
      [logs(1, 2, 3), first, 1],
    ] as const) {
      const result = computeSequentialPlanProgression(plan, [...history]);
      expect(result.nextSession?.id).toBe(expected.id);
      expect(result.nextAssignments).toEqual(expected.assignments);
      expect(result.sequencePosition).toEqual({
        current,
        total: 3,
        session_name: expected.name,
      });
    }
  });

  it('requires every assignment in the selected session before advancing', () => {
    const first = session(A, 'Upper Body', 0, [10, 11]);
    const second = session(B, 'Lower Body', 1, [20]);
    const partial = computeSequentialPlanProgression([first, second], logs(10));
    expect(partial.nextSession?.id).toBe(A);
    expect(partial.nextAssignments.map((assignment) => assignment.id)).toEqual([
      10, 11,
    ]);
    const complete = computeSequentialPlanProgression(
      [first, second],
      logs(10, 11)
    );
    expect(complete.nextSession?.id).toBe(B);
    expect(complete.nextAssignments.map((assignment) => assignment.id)).toEqual(
      [20]
    );
  });

  it('does not reuse previous-cycle completions during later rounds', () => {
    const plan = [session(A, 'A', 0, [1]), session(B, 'B', 1, [2])];
    const result = computeSequentialPlanProgression(plan, logs(1, 2, 1));
    expect(result.nextSession?.id).toBe(B);
    expect(result.sequencePosition?.current).toBe(2);
  });

  it('does not count an out-of-order completion as a later session completion', () => {
    const plan = [
      session(A, 'A', 0, [10]),
      session(B, 'B', 1, [20]),
      session(C, 'C', 2, [30]),
    ];
    expect(
      computeSequentialPlanProgression(plan, logs(20)).nextSession?.id
    ).toBe(A);
    expect(
      computeSequentialPlanProgression(plan, logs(20, 10)).nextSession?.id
    ).toBe(B);
  });

  it('uses chronological log order for sessions completed on the same date', () => {
    const plan = [session(A, 'Morning', 0, [1]), session(B, 'Evening', 1, [2])];
    const result = computeSequentialPlanProgression(plan, logs(1, 2));
    expect(result.nextSession?.id).toBe(A);
    expect(result.sequencePosition?.current).toBe(1);
  });

  it('matches persisted numeric assignment IDs returned as strings and ignores unrelated diary logs', () => {
    const plan = [session(A, 'A', 0, [1]), session(B, 'B', 1, [2])];
    expect(
      computeSequentialPlanProgression(plan, logs(999, '1')).nextSession?.id
    ).toBe(B);
  });
});
