import { buildWorkoutPlanSessionPreset } from '@/utils/workoutPlanSession';
import type { WorkoutPlanTemplate, WorkoutPreset } from '@/types/workout';
import type { Exercise } from '@/types/exercises';

const snapshot = (id: number): WorkoutPreset =>
  ({
    id,
    user_id: 'user-1',
    name: `Preset ${id}`,
    workout_format: 'emom',
    time_cap_seconds: 600,
    exercises: [
      {
        exercise_id: `exercise-${id}`,
        exercise_name: `Exercise ${id}`,
        sets: [{ set_number: 1, reps: 8, weight: 20 }],
      },
    ],
  }) as WorkoutPreset;

const buildPlan = (snapshots: WorkoutPreset[]): WorkoutPlanTemplate =>
  ({
    id: 'plan-1',
    user_id: 'user-1',
    plan_name: 'Intervals',
    sessions: [
      {
        id: 'session-1',
        name: 'EMOM',
        day_of_week: null,
        is_optional: false,
        sort_order: 0,
        assignments: snapshots.map((preset_snapshot, index) => ({
          id: index + 1,
          sort_order: index,
          sets: [],
          preset_snapshot,
        })),
      },
    ],
  }) as WorkoutPlanTemplate;

const unusedFetchExercise = async (_id: string): Promise<Exercise> => {
  throw new Error('A frozen preset should not fetch an exercise');
};

describe('buildWorkoutPlanSessionPreset', () => {
  it('keeps the shared EMOM format and cap from two frozen presets', async () => {
    const preset = await buildWorkoutPlanSessionPreset(
      buildPlan([snapshot(1), snapshot(2)]),
      'session-1',
      'user-1',
      unusedFetchExercise
    );

    expect(preset).toMatchObject({
      workout_format: 'emom',
      time_cap_seconds: 600,
      exercises: [
        { exercise_id: 'exercise-1', workout_plan_assignment_id: 1 },
        { exercise_id: 'exercise-2', workout_plan_assignment_id: 2 },
      ],
    });
  });

  it.each([
    {
      caseName: 'mixed formats',
      second: { ...snapshot(2), workout_format: 'tabata' as const },
      expectedFormat: 'standard',
      expectedCap: null,
    },
    {
      caseName: 'mixed caps',
      second: { ...snapshot(2), time_cap_seconds: 90 },
      expectedFormat: 'emom',
      expectedCap: null,
    },
  ])(
    'falls back for $caseName',
    async ({ second, expectedFormat, expectedCap }) => {
      const preset = await buildWorkoutPlanSessionPreset(
        buildPlan([snapshot(1), second]),
        'session-1',
        'user-1',
        unusedFetchExercise
      );

      expect(preset.workout_format).toBe(expectedFormat);
      expect(preset.time_cap_seconds).toBe(expectedCap);
    }
  );
});
