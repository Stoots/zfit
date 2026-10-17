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

  it.each([{ reps: 8 }, { duration: 30 }, { distance: 0.1 }])(
    'requires a logged set for Workout Plan prescriptions: %j',
    (set) => {
      const exercise = {
        source: 'Workout Plan',
        is_weekly_prefill: false,
        duration_minutes: 30,
        sets: [set],
      };
      expect(
        canLinkDiaryWorkout({ type: 'preset', exercises: [exercise] })
      ).toBe(false);
      expect(canLinkDiaryWorkout({ type: 'individual', ...exercise })).toBe(
        false
      );
      expect(
        canLinkDiaryWorkout({
          type: 'preset',
          exercises: [
            {
              ...exercise,
              sets: [{ ...set, completed_at: '2026-10-25T12:00:00Z' }],
            },
          ],
        })
      ).toBe(true);
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
