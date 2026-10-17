import { describe, expect, it } from 'vitest';
import { canLinkDiaryWorkout } from '@workspace/shared';

describe('diary workout completion eligibility', () => {
  it.each([
    { duration_minutes: 0, expected: false },
    { duration_minutes: 30, expected: true },
  ])(
    'allows an individual with a blank backing set only with positive duration: $duration_minutes',
    ({ duration_minutes, expected }) => {
      expect(
        canLinkDiaryWorkout({
          type: 'individual',
          duration_minutes,
          sets: [
            { reps: null, duration: null, distance: null, completed_at: null },
          ],
        })
      ).toBe(expected);
    }
  );

  it('does not count entry duration for untouched prefill or grouped workouts', () => {
    const exercise = {
      duration_minutes: 30,
      sets: [
        { reps: null, duration: null, distance: null, completed_at: null },
      ],
    };
    expect(
      canLinkDiaryWorkout({
        ...exercise,
        type: 'individual',
        is_weekly_prefill: true,
      })
    ).toBe(false);
    expect(canLinkDiaryWorkout({ type: 'preset', exercises: [exercise] })).toBe(
      false
    );
  });
});
