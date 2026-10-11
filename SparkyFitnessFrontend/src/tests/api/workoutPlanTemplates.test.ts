import { apiCall } from '@/api/api';
import { updateWorkoutPlanTemplate } from '@/api/Exercises/workoutPlanTemplates';
import type { WorkoutPreset } from '@/types/workout';

jest.mock('@/api/api', () => ({ apiCall: jest.fn() }));

it('serializes frozen local prescriptions and persisted links without leaking client DnD IDs', async () => {
  jest.mocked(apiCall).mockResolvedValue({ id: 17 });
  const set = {
    id: 'temporary-set',
    set_number: 1,
    reps: null,
    weight: null,
    duration: 45,
    rest_time: null,
    distance: 0.2,
    rpe: 7,
    rir: 3,
    notes: '45–60 seconds per side',
  };
  const snapshot = {
    id: 42,
    user_id: 'athlete',
    name: 'Conditioning',
    description: '',
    workout_format: 'interval',
    exercises: [
      {
        id: 'temporary-exercise',
        exercise_id: '10000000-0000-4000-8000-000000000099',
        exercise_name: 'Carry',
        category: 'Cardio',
        modality: 'duration_distance',
        image_url: '',
        superset_group: null,
        sets: [set],
      },
    ],
  } as WorkoutPreset;
  await updateWorkoutPlanTemplate('17', {
    plan_name: 'Build',
    schedule_type: 'weekly',
    entry_mode: 'prompt',
    sessions: [
      {
        id: '10000000-0000-4000-8000-000000000001',
        name: 'A',
        day_of_week: 2,
        sort_order: 0,
        assignments: [
          {
            id: 101,
            workout_preset_id: null,
            preset_snapshot: snapshot,
            sort_order: 0,
            sets: [],
          },
          {
            id: 'temporary-assignment',
            exercise_id: '10000000-0000-4000-8000-000000000098',
            sort_order: 1,
            sets: [set],
          },
        ],
      },
    ],
  });
  const payload = JSON.parse(
    jest.mocked(apiCall).mock.calls[0]![1]!.body as string
  );
  const assignments = payload.sessions[0].assignments;
  expect(assignments[0].id).toBe(101);
  expect(assignments[1].id).toBeUndefined();
  expect(assignments[0].preset_snapshot.exercises[0].id).toBeUndefined();
  const expected = {
    set_number: 1,
    reps: null,
    weight: null,
    duration: 45,
    rest_time: null,
    distance: 0.2,
    rpe: 7,
    rir: 3,
    notes: '45–60 seconds per side',
  };
  expect(assignments[0].preset_snapshot.exercises[0].sets[0]).toEqual(expected);
  expect(assignments[1].sets[0]).toEqual(expected);
  expect(assignments[0].preset_snapshot.workout_format).toBe('interval');
});
