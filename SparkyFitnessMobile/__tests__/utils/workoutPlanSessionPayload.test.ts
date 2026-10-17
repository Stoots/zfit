import {
  createWorkoutPlanDraft,
  buildWorkoutPlanPayload,
} from '../../src/utils/workoutPlanForm';
import { sessionPlanPayload } from '../../src/services/api/workoutPlansApi';
import type {
  SaveWorkoutPlanPayload,
  WorkoutPlanTemplate,
} from '../../src/types/workoutPlans';

jest.mock('../../src/services/api/apiClient', () => ({ apiFetch: jest.fn() }));
jest.mock('../../src/services/api/trainingProgramsApi', () => ({}));

it('preserves exact session identity and optionality when the native form saves', () => {
  const payload: SaveWorkoutPlanPayload = {
    plan_name: 'Plan',
    description: '',
    start_date: '2026-10-17',
    end_date: null,
    is_active: true,
    schedule_type: 'weekly',
    entry_mode: 'prompt',
    assignments: [
      {
        id: '7',
        day_of_week: 6,
        session_index: null,
        session_name: 'Saturday',
        sort_order: 0,
        exercise_id: 'exercise',
        sets: [],
      },
    ],
  };
  const existing = {
    sessions: [
      {
        id: 'session',
        name: 'Saturday',
        day_of_week: 6,
        sort_order: 0,
        is_optional: true,
        assignments: [{ id: 7, sets: [{ id: 9, set_number: 1, reps: 8 }] }],
      },
    ],
  } as WorkoutPlanTemplate;
  payload.assignments.push({
    day_of_week: 6,
    session_index: null,
    session_name: 'Saturday',
    sort_order: 1,
    exercise_id: 'added',
    sets: [],
  });
  const result = sessionPlanPayload(payload, existing);
  expect(result.sessions).toEqual([
    expect.objectContaining({
      id: 'session',
      is_optional: true,
      assignments: [
        expect.objectContaining({
          id: 7,
          exercise_id: 'exercise',
          sets: [{ id: 9, set_number: 1, reps: 8 }],
        }),
        expect.objectContaining({ exercise_id: 'added' }),
      ],
    }),
  ]);
  expect(result).not.toHaveProperty('assignments');
});

it('sends the selected local prescription for a new preset assignment', () => {
  const snapshot = {
    id: 8,
    name: 'Intervals',
    description: null,
    workout_format: 'amrap' as const,
    time_cap_seconds: 600,
    exercises: [],
  };
  const result = sessionPlanPayload({
    plan_name: 'Plan',
    description: '',
    start_date: '2026-10-17',
    end_date: null,
    is_active: true,
    schedule_type: 'weekly',
    entry_mode: 'prompt',
    assignments: [
      {
        day_of_week: 6,
        session_index: null,
        session_name: null,
        sort_order: 0,
        workout_preset_id: '8',
        preset_snapshot: snapshot,
        sets: [],
      },
    ],
  });
  expect(result.sessions[0].assignments[0]).toMatchObject({
    workout_preset_id: 8,
    preset_snapshot: snapshot,
  });
});

it('retains a frozen preset after its library source was deleted', () => {
  const draft = createWorkoutPlanDraft('2026-10-17');
  draft.planName = 'Plan';
  draft.assignments = [
    {
      id: '7',
      key: '7',
      day_of_week: 6,
      session_index: null,
      workout_preset_id: null,
      workout_preset_name: 'Deleted preset',
      exercise_id: null,
      exercise_name: null,
      sets: [],
      preset_snapshot: {
        id: 8,
        name: 'Deleted preset',
        description: null,
        workout_format: 'standard',
        exercises: [],
      },
    },
  ];
  const payload = buildWorkoutPlanPayload(draft);
  expect(payload.assignments).toHaveLength(1);
  expect(payload.assignments[0].preset_snapshot?.name).toBe('Deleted preset');
});
