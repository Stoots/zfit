import { describe, expect, it } from 'vitest';
import {
  displaySetRir,
  decideAdaptiveAdjustment,
  legacyRpePatch,
} from '@workspace/shared';
import type { ExerciseCoachingSignal } from '@workspace/shared';

describe('strength RIR', () => {
  it('clears legacy RPE only when editing RIR', () => {
    expect(legacyRpePatch('rir')).toEqual({ rpe: null });
    expect(legacyRpePatch('rpe')).toEqual({});
    expect(legacyRpePatch('reps')).toEqual({});
  });
  it('prefers explicit RIR, including zero, and converts legacy effort only as fallback', () => {
    expect(displaySetRir({ rir: 0, rpe: 8 })).toBe(0);
    expect(displaySetRir({ rpe: 8 })).toBe(2);
    expect(displaySetRir({ rir: null, rpe: 8 })).toBeNull();
    expect(displaySetRir({ rpe: 12 })).toBe(0);
    expect(displaySetRir({ rpe: -2 })).toBe(10);
    expect(displaySetRir({})).toBeNull();
  });
  it('uses RIR ahead of contradictory legacy RPE for coaching', () => {
    const signal: ExerciseCoachingSignal = {
      exercise_id: 'squat',
      last_performed_date: '2026-10-17',
      days_since_last_performed: 1,
      last_difficulty: null,
      last_pain: null,
      too_easy_streak: 0,
      too_hard_streak: 0,
      pain_streak: 0,
      avg_rpe: 10,
      avg_rir: 3,
      sessions_in_variation_window: 1,
    };
    expect(decideAdaptiveAdjustment(signal).kind).toBe('none');
    expect(decideAdaptiveAdjustment({ ...signal, avg_rir: 0 }).kind).toBe(
      'hold'
    );
    expect(decideAdaptiveAdjustment({ ...signal, avg_rir: null }).kind).toBe(
      'hold'
    );
  });
});
