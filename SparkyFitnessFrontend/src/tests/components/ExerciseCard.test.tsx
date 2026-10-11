import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ExerciseCard from '@/pages/Diary/ExerciseCard';
import type { WorkoutPlanTemplate, WorkoutPreset } from '@/types/workout';
import type { TrainingProgram } from '@workspace/shared';
import type { WorkoutPlaybackRouteState } from '@/utils/workoutPlayback';

const mockNavigate = jest.fn();
let mockActivePlans: WorkoutPlanTemplate[] = [];
let mockAllPlans: WorkoutPlanTemplate[] = [];
let mockPrograms: TrainingProgram[] = [];
let mockEntries: {
  type: 'individual';
  id: string;
  workout_plan_assignment_id: number;
  duration_minutes: number;
  calories_burned: number;
  sets: [];
}[] = [];
let mockDelegate = false;
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));
jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);
jest.mock('@/i18n', () => ({
  __esModule: true,
  default: { t: (key: string, fallback?: string) => fallback ?? key },
}));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'athlete' } }),
}));
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({
    activeUserId: mockDelegate ? 'family' : 'athlete',
    isActingOnBehalf: mockDelegate,
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    loggingLevel: 'ERROR',
    energyUnit: 'kcal',
    convertEnergy: (value: number) => value,
    getEnergyUnitString: () => 'kcal',
  }),
}));
jest.mock('@/hooks/use-toast', () => ({ toast: jest.fn() }));
jest.mock('@/hooks/Exercises/useWorkoutPlans', () => ({
  useActiveWorkoutPlans: () => ({ data: mockActivePlans }),
  useWorkoutPlanTemplates: () => ({ data: mockAllPlans, isPending: false }),
}));
jest.mock('@/hooks/TrainingPrograms/useTrainingPrograms', () => ({
  useTrainingProgramsList: (_user: string, enabled: boolean) => ({
    data: enabled ? mockPrograms : undefined,
  }),
}));
jest.mock('@/hooks/Exercises/useExerciseEntries', () => ({
  useExerciseEntries: () => ({ data: mockEntries, isLoading: false }),
  useDeleteExerciseEntryMutation: () => ({ mutateAsync: jest.fn() }),
  useDeleteExercisePresetEntryMutation: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock('@/pages/Exercises/AddExerciseDialog', () => () => null);
jest.mock('@/pages/Diary/EditExerciseEntryDialog', () => () => null);
jest.mock('@/pages/Diary/ExercisePlaybackModal', () => () => null);
jest.mock('@/pages/Diary/LogExerciseEntryDialog', () => () => null);
jest.mock('@/pages/Diary/EditExerciseDatabaseDialog', () => () => null);
jest.mock('@/pages/Diary/ExerciseEntryDisplay', () => () => null);
jest.mock('@/pages/Diary/ExercisePresetEntryDisplay', () => () => null);

const firstId = '10000000-0000-4000-8000-000000000001';
const laterId = '10000000-0000-4000-8000-000000000002';
function fixture(): WorkoutPlanTemplate {
  const snapshot = (count: number): WorkoutPreset =>
    ({
      id: 42,
      user_id: 'athlete',
      name: 'Frozen A',
      workout_format: 'standard',
      exercises: [
        {
          exercise_id: 'exercise',
          exercise_name: 'Lunge',
          sets: Array.from({ length: count }, (_, i) => ({
            set_number: i + 1,
            reps: 8,
            weight: null,
            duration: null,
            rpe: 7,
            rir: 3,
            rest_time: 75,
            distance: 0.2,
            notes: '8–10 per side',
          })),
        },
      ],
    }) as WorkoutPreset;
  return {
    id: '17',
    user_id: 'athlete',
    plan_name: 'Inactive Program Plan',
    is_active: false,
    schedule_type: 'sequential',
    sessions: [
      {
        id: firstId,
        name: 'A',
        day_of_week: null,
        sort_order: 0,
        assignments: [
          {
            id: 101,
            workout_preset_id: 42,
            preset_snapshot: snapshot(2),
            sort_order: 0,
            sets: [],
          },
        ],
      },
      {
        id: laterId,
        name: 'A',
        day_of_week: null,
        sort_order: 1,
        assignments: [
          {
            id: 102,
            workout_preset_id: null,
            preset_snapshot: snapshot(3),
            sort_order: 0,
            sets: [],
          },
        ],
      },
    ],
  };
}
function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ExerciseCard selectedDate="2026-10-12" onExercisesLogged={jest.fn()} />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  mockNavigate.mockReset();
  mockDelegate = false;
  mockEntries = [];
  const standaloneSession = {
    id: 'standalone',
    name: 'Solo',
    day_of_week: 1,
    sort_order: 0,
    assignments: [
      { id: 900, exercise_id: 'exercise', sets: [{ set_number: 1, reps: 8 }] },
    ],
  };
  mockActivePlans = [
    {
      id: '9',
      user_id: 'athlete',
      plan_name: 'Standalone',
      sessions: [standaloneSession],
      next_session: standaloneSession,
    },
  ];
  mockAllPlans = [fixture(), ...mockActivePlans];
  mockPrograms = [
    {
      phases: [
        {
          weeks: [
            {
              sessions: [
                {
                  id: 'planned-first',
                  workout_plan_id: 17,
                  workout_session_id: firstId,
                  status: 'planned',
                  effective_date: '2026-10-12',
                },
                {
                  id: 'planned-later',
                  workout_plan_id: 17,
                  workout_session_id: laterId,
                  status: 'planned',
                  effective_date: '2026-10-12',
                },
              ],
            },
          ],
        },
      ],
    } as TrainingProgram,
  ];
});

it('starts the earliest exact Program session and keeps unrelated standalone workouts available', async () => {
  const frozen = mockAllPlans[0]!.sessions[0]!.assignments[0]!.preset_snapshot!;
  frozen.workout_format = 'interval';
  frozen.time_cap_seconds = 180;
  mount();
  expect(
    screen.getAllByRole('button', { name: /^Start Workout:/ })
  ).toHaveLength(2);
  fireEvent.click(
    screen.getByRole('button', { name: /Start Workout: A \(session 1 of 2\)/ })
  );
  await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
  const state = mockNavigate.mock.calls[0]![1]
    .state as WorkoutPlaybackRouteState;
  if (!state?.draft) {
    throw new Error(
      'Exact session start must provide a workout playback draft.'
    );
  }
  expect(state.draft.workout_session_id).toBe(firstId);
  expect(state.draft.workout_format).toBe('interval');
  expect(state.draft.time_cap_seconds).toBe(180);
  expect(
    state.draft.exercises[0]!.sets.map((set) => [
      set.reps,
      set.weight,
      set.rpe,
      set.rir,
      set.rest_time,
      set.distance,
      set.notes,
    ])
  ).toEqual([
    [8, null, 7, 3, 75, 0.2, '8–10 per side'],
    [8, null, 7, 3, 75, 0.2, '8–10 per side'],
  ]);
  expect(state.draft.exercises[0]!.workout_plan_assignment_id).toBe(101);
});

it('keeps the fixed Program preview while a diary assignment is partially linked', async () => {
  const source = mockAllPlans[0]!.sessions[0]!.assignments[0]!;
  mockAllPlans[0]!.sessions[0]!.assignments.push({
    ...structuredClone(source),
    id: 103,
    sort_order: 1,
  });
  mockEntries = [
    {
      type: 'individual',
      id: 'logged',
      workout_plan_assignment_id: 101,
      duration_minutes: 0,
      calories_burned: 0,
      sets: [],
    },
  ];
  mount();
  expect(
    screen.getAllByRole('button', { name: /^Start Workout:/ })
  ).toHaveLength(2);
  fireEvent.click(
    screen.getByRole('button', { name: /Start Workout: A \(session 1 of 2\)/ })
  );
  await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
  const state = mockNavigate.mock.calls[0]![1]
    .state as WorkoutPlaybackRouteState;
  if (!state?.draft) {
    throw new Error(
      'Exact session start must provide a workout playback draft.'
    );
  }
  expect(state.draft.workout_session_id).toBe(firstId);
  expect(
    state.draft.exercises.map((exercise) => exercise.workout_plan_assignment_id)
  ).toEqual([101, 103]);
});

it('does not expose private Program workouts while acting as a family delegate', () => {
  mockDelegate = true;
  mount();
  expect(screen.queryByText('Inactive Program Plan')).not.toBeInTheDocument();
  expect(
    screen.getAllByRole('button', { name: /^Start Workout:/ })
  ).toHaveLength(1);
});
