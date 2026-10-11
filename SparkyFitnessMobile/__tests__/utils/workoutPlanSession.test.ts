import type { WorkoutPlanSession } from '../../src/types/workoutPlans';
import { buildWorkoutPlanSessionStart } from '../../src/utils/workoutPlanSession';

const exerciseId = '11111111-1111-4111-8111-111111111111';
const firstId = '22222222-2222-4222-8222-222222222222';
const secondId = '33333333-3333-4333-8333-333333333333';
function session(
  id: string,
  assignmentId: number,
  count: number
): WorkoutPlanSession {
  return {
    id,
    name: 'A',
    day_of_week: null,
    sort_order: assignmentId,
    assignments: [
      {
        id: assignmentId,
        workout_session_id: id,
        exercise_id: null,
        workout_preset_id: 10,
        sort_order: 0,
        exercise_name: null,
        modality: null,
        workout_preset_name: 'Library A',
        workout_preset_format: 'standard',
        sets: [],
        preset_snapshot: {
          id: 10,
          name: 'Frozen A',
          description: 'Left then right',
          workout_format: 'interval',
          exercises: [
            {
              id: 20,
              exercise_id: exerciseId,
              exercise_name: 'TRX Row',
              category: 'Strength',
              image_url: null,
              superset_group: 2,
              progression_mode: 'manual',
              ramp_increment: null,
              sets: Array.from({ length: count }, (_, index) => ({
                set_number: index + 1,
                set_type: 'normal',
                reps: 8,
                weight: null,
                duration: null,
                distance: null,
                rest_time: 75,
                notes: '8–10 each side; RPE 7',
                rpe: 7,
                rir: 3,
              })),
            },
          ],
        },
      },
    ],
  };
}

it('starts same-label sessions independently with frozen 2x8 versus 3x8, effort and null load', () => {
  const first = session(firstId, 1, 2);
  const second = session(secondId, 2, 3);
  const before = JSON.stringify(second);
  const a = buildWorkoutPlanSessionStart(first);
  const b = buildWorkoutPlanSessionStart(second);
  expect(a.exercises[0]?.sets).toEqual(
    [1, 2].map((set_number) => ({
      set_number,
      set_type: 'normal',
      reps: 8,
      weight: null,
      duration: null,
      distance: null,
      rest_time: 75,
      notes: '8–10 each side; RPE 7',
      rpe: 7,
      rir: 3,
      completed_at: null,
    }))
  );
  expect(b.exercises[0]?.sets.map((set) => set.reps)).toEqual([8, 8, 8]);
  expect(a.exercises[0]?.workout_plan_assignment_id).toBe(1);
  expect(b.exercises[0]?.workout_plan_assignment_id).toBe(2);
  expect(a.workoutFormat).toBe('interval');
  expect(a.sourcePresetId).toBeUndefined();
  a.exercises[0]!.sets[0]!.reps = 12;
  expect(
    first.assignments[0]?.preset_snapshot?.exercises[0]?.sets[0]?.reps
  ).toBe(8);
  expect(JSON.stringify(second)).toBe(before);
});

it('executes the frozen prescription after the library preset is deleted', () => {
  const selected = session(firstId, 1, 2);
  selected.assignments[0]!.workout_preset_id = null;
  const start = buildWorkoutPlanSessionStart(selected);
  expect(start.workoutSessionId).toBe(firstId);
  expect(start.exercises[0]?.sets.map((set) => set.reps)).toEqual([8, 8]);
  expect(start.workoutFormat).toBe('interval');
});

it('rejects missing snapshots and assignments belonging to another session instead of guessing', () => {
  const missing = session(firstId, 1, 2);
  missing.assignments[0]!.preset_snapshot = null;
  expect(() => buildWorkoutPlanSessionStart(missing)).toThrow(
    'no frozen preset prescription'
  );
  const wrong = session(firstId, 1, 2);
  wrong.assignments[0]!.workout_session_id = secondId;
  expect(() => buildWorkoutPlanSessionStart(wrong)).toThrow('does not belong');
});

it('keeps individual assignments ordered with their full local sets alongside frozen presets', () => {
  const selected = session(firstId, 1, 2);
  selected.assignments.push({
    id: 3,
    workout_session_id: firstId,
    sort_order: 1,
    exercise_id: exerciseId,
    workout_preset_id: null,
    exercise_name: 'TRX Row',
    modality: 'weight_reps',
    workout_preset_name: null,
    workout_preset_format: null,
    preset_snapshot: null,
    sets: [
      {
        set_number: 1,
        reps: 6,
        weight: null,
        rest_time: null,
        notes: 'Per side',
      },
    ],
  });
  const start = buildWorkoutPlanSessionStart(selected);
  expect(
    start.exercises.map((exercise) => exercise.workout_plan_assignment_id)
  ).toEqual([1, 3]);
  expect(start.exercises[1]?.sets[0]).toMatchObject({
    reps: 6,
    weight: null,
    rest_time: null,
    notes: 'Per side',
  });
});

it.each([
  ['amrap', 600, 'amrap', 600, 'amrap', 600],
  ['amrap', 600, 'amrap', 300, 'amrap', null],
  ['amrap', 600, 'emom', 600, 'standard', null],
  ['amrap', null, 'amrap', null, 'amrap', null],
] as const)(
  'derives aggregate timing from frozen formats and caps (%s/%s, %s/%s)',
  (
    firstFormat,
    firstCap,
    secondFormat,
    secondCap,
    expectedFormat,
    expectedCap
  ) => {
    const selected = session(firstId, 1, 2);
    const another = session(firstId, 2, 3);
    selected.assignments[0]!.preset_snapshot!.workout_format = firstFormat;
    selected.assignments[0]!.preset_snapshot!.time_cap_seconds = firstCap;
    another.assignments[0]!.preset_snapshot!.workout_format = secondFormat;
    another.assignments[0]!.preset_snapshot!.time_cap_seconds = secondCap;
    selected.assignments.push(another.assignments[0]!);
    const start = buildWorkoutPlanSessionStart(selected);
    expect(start.workoutFormat).toBe(expectedFormat);
    expect(start.timeCapSeconds).toBe(expectedCap);
    expect(
      start.exercises.map((exercise) => exercise.workout_plan_assignment_id)
    ).toEqual([1, 2]);
  }
);
