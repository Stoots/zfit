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
        assignments: [{ id: 7 }],
      },
    ],
  } as WorkoutPlanTemplate;
  const result = sessionPlanPayload(payload, existing);
  expect(result.sessions).toEqual([
    expect.objectContaining({
      id: 'session',
      is_optional: true,
      assignments: [
        expect.objectContaining({ id: 7, exercise_id: 'exercise' }),
      ],
    }),
  ]);
  expect(result).not.toHaveProperty('assignments');
});
