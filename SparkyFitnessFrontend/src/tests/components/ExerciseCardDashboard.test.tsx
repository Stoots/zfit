import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { TrainingProgram } from '@workspace/shared';
import ExerciseCard from '@/pages/Diary/ExerciseCard';
import type { WorkoutPlanTemplate } from '@/types/workout';

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'athlete' } }),
}));
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({
    activeUserId: 'athlete',
    isActingOnBehalf: mockState.actingOnBehalf,
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    loggingLevel: 'SILENT',
    timezone: 'Australia/Sydney',
    energyUnit: 'kcal',
    convertEnergy: (value: number) => value,
    getEnergyUnitString: () => 'kcal',
  }),
}));
jest.mock('@/hooks/Exercises/useWorkoutPlans', () => ({
  useActiveWorkoutPlans: () => ({ data: mockState.plans }),
  useWorkoutPlanTemplates: () => ({ data: mockState.plans, isPending: false }),
}));
jest.mock('@/hooks/Exercises/useWorkoutPresets', () => ({
  useWorkoutPresets: () => ({ data: { presets: [] } }),
  workoutPresetByIdOptions: jest.fn(),
}));
jest.mock('@/hooks/Exercises/useExercises', () => ({
  exerciseByIdOptions: jest.fn(),
}));
jest.mock('@/hooks/TrainingPrograms/useTrainingPrograms', () => ({
  useTrainingProgramsList: () => mockState.programs,
  useTrainingPrograms: () => ({
    outcome: { mutateAsync: mockOutcome, isPending: false },
  }),
}));
jest.mock('@/hooks/Exercises/useExerciseEntries', () => ({
  useExerciseEntries: () => ({ data: [], isLoading: false }),
  useDeleteExerciseEntryMutation: () => ({ mutateAsync: jest.fn() }),
  useDeleteExercisePresetEntryMutation: () => ({ mutateAsync: jest.fn() }),
  useCreatePresetSessionMutation: () => ({
    mutateAsync: mockCreate,
    isPending: false,
  }),
}));
jest.mock('@/utils/workoutPlanSession', () => ({
  buildWorkoutPlanSessionPreset: () =>
    Promise.resolve({
      id: 'plan-7-session-7-s1',
      user_id: 'athlete',
      name: 'Push',
      workout_session_id: '7-s1',
      exercises: [
        {
          exercise_id: 'exercise',
          exercise_name: 'Push',
          workout_plan_assignment_id: 71,
          sets: [{ set_number: 1, reps: 8 }],
        },
      ],
    }),
}));
const mockCreate = jest.fn();
const mockOutcome = jest.fn();
jest.mock('@/pages/Exercises/AddExerciseDialog', () => () => null);
jest.mock('@/pages/Diary/LogExerciseEntryDialog', () => () => null);
jest.mock('@/pages/Diary/EditExerciseEntryDialog', () => () => null);
jest.mock('@/pages/Diary/EditExerciseDatabaseDialog', () => () => null);
jest.mock('@/pages/Diary/ExercisePlaybackModal', () => () => null);

interface ProgramsResult {
  data?: TrainingProgram[];
  isError: boolean;
}
const mockState: {
  actingOnBehalf: boolean;
  plans: WorkoutPlanTemplate[];
  programs: ProgramsResult;
} = {
  actingOnBehalf: false,
  plans: [],
  programs: { data: [], isError: false },
};

const makePlan = (
  id: string,
  planName: string,
  sessionNames: string[]
): WorkoutPlanTemplate => {
  const sessions = sessionNames.map((name, index) => ({
    id: `${id}-s${index + 1}`,
    name,
    day_of_week: null,
    is_optional: false,
    sort_order: index,
    assignments: [{ id: `${id}-a${index + 1}`, sets: [] }],
  }));
  return {
    id,
    user_id: 'athlete',
    plan_name: planName,
    schedule_type: 'sequential',
    sessions,
    next_session: sessions[0],
    sequence_position: {
      current: 1,
      total: sessionNames.length,
      session_name: sessionNames[0],
    },
  };
};

const programLinkedTo = (planId: string): TrainingProgram =>
  ({
    id: 'program-1',
    name: 'Strength block',
    phases: [
      {
        name: 'Foundation',
        weeks: [
          {
            sessions: [
              {
                id: 'planned-session-1',
                workout_plan_id: Number(planId),
                workout_session_id: `${planId}-s1`,
                workout_plan_name: `Plan ${planId}`,
                workout_session_name: 'Push',
                status: 'planned',
                scheduled_date: '2026-10-12',
                effective_date: '2026-10-12',
              },
            ],
          },
        ],
      },
    ],
  }) as unknown as TrainingProgram;

const renderCard = (selectedDate = '2026-10-12') =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ExerciseCard
          selectedDate={selectedDate}
          onExercisesLogged={jest.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );

const pickerFor = (sessionName: string) =>
  screen
    .getAllByRole('button', { name: sessionName })
    .find((button) => button.getAttribute('aria-haspopup') === 'menu');

describe('ExerciseCard dashboard plans', () => {
  beforeEach(() => {
    localStorage.clear();
    mockCreate.mockReset().mockResolvedValue({ id: 'diary-workout-1' });
    mockOutcome.mockReset().mockResolvedValue({});
    mockState.actingOnBehalf = false;
    mockState.programs = { data: [], isError: false };
    mockState.plans = [];
  });

  it('confirms before logging prescribed sets and recording the Program outcome', async () => {
    mockState.plans = [makePlan('7', 'Program plan', ['Push'])];
    mockState.programs = { data: [programLinkedTo('7')], isError: false };
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: /mark complete/i }));
    expect(mockCreate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockCreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /mark complete/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /confirm completion/i })
    );
    await waitFor(() =>
      expect(mockOutcome).toHaveBeenCalledWith({
        programId: 'program-1',
        sessionId: 'planned-session-1',
        input: {
          status: 'completed',
          workout: { type: 'preset', id: 'diary-workout-1' },
        },
      })
    );
    expect(mockCreate.mock.calls[0]?.[0].exercises[0].sets[0].reps).toBe(8);
  });

  it('shows three Program cards in schedule order and no fourth card', () => {
    mockState.plans = ['7', '8', '9', '10'].map((id) =>
      makePlan(id, `Plan ${id}`, [`Workout ${id}`])
    );
    const linked = programLinkedTo('7');
    const week = linked.phases[0]!.weeks[0]!;
    const baseSession = week.sessions[0]!;
    week.sessions = ['10', '8', '7', '9'].map((id, index) => ({
      ...baseSession,
      id: `planned-${id}`,
      workout_plan_id: Number(id),
      workout_session_id: `${id}-s1`,
      effective_date: `2026-10-${String([18, 16, 15, 17][index])}`,
    }));
    mockState.programs = { data: [linked], isError: false };
    renderCard();

    expect(
      screen.getAllByRole('button', { name: 'Mark complete' })
    ).toHaveLength(3);
    expect(
      screen
        .getAllByTestId(/dashboard-plan-/)
        .slice(0, 3)
        .map((item) => item.getAttribute('data-workout-plan-id'))
    ).toEqual(['7', '8', '9']);
    expect(screen.queryByText('Workout 10')).not.toBeInTheDocument();
  });

  it('retries outcome linking without logging the workout twice', async () => {
    mockState.plans = [makePlan('7', 'Program plan', ['Push'])];
    mockState.programs = { data: [programLinkedTo('7')], isError: false };
    mockOutcome.mockRejectedValueOnce(new Error('Could not link workout'));
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm completion' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not link workout'
    );
    expect(screen.getByText(/already logged/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm completion' }));
    await waitFor(() => expect(mockOutcome).toHaveBeenCalledTimes(2));
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('shows the next Program workout as a preview without a session picker', () => {
    mockState.plans = [makePlan('7', 'Program plan', ['Push', 'Pull'])];
    mockState.programs = { data: [programLinkedTo('7')], isError: false };
    renderCard();

    expect(screen.getByText('Push')).toBeInTheDocument();
    expect(screen.getByText("Today's session")).toBeInTheDocument();
    expect(
      screen.getByText('Strength block · Foundation · Week 1 · 2026-10-12')
    ).toBeInTheDocument();
    expect(screen.getByText('Sequential plan: Program plan')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Push' })).toBeNull();
    expect(
      screen.getByRole('button', { name: /^Start Workout: Push/ })
    ).toBeInTheDocument();
  });

  it('labels a future Program workout as the next session', () => {
    mockState.plans = [makePlan('7', 'Program plan', ['Push', 'Pull'])];
    mockState.programs = { data: [programLinkedTo('7')], isError: false };
    renderCard('2026-10-11');
    expect(screen.getByText('Next session')).toBeInTheDocument();
    expect(screen.queryByText("Today's session")).not.toBeInTheDocument();
  });

  it('offers a session picker for a standalone multi-session plan', () => {
    mockState.plans = [makePlan('9', 'Solo plan', ['Upper', 'Lower'])];
    renderCard();

    expect(pickerFor('Upper')).toBeDefined();
    expect(screen.getByText('(1 of 2)')).toBeInTheDocument();
  });

  it('keeps a single-session standalone plan as plain text', () => {
    mockState.plans = [makePlan('9', 'Solo plan', ['Full body'])];
    renderCard();

    expect(screen.getByText('Full body')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Full body' })).toBeNull();
  });

  it('falls back to showing every plan as standalone when programs fail to load', () => {
    mockState.plans = [
      makePlan('7', 'Program plan', ['Push', 'Pull']),
      makePlan('9', 'Solo plan', ['Upper', 'Lower']),
    ];
    mockState.programs = { data: undefined, isError: true };
    renderCard();

    expect(pickerFor('Push')).toBeDefined();
    expect(pickerFor('Upper')).toBeDefined();
  });

  it('shows no plan banners while programs are still loading', () => {
    mockState.plans = [makePlan('7', 'Program plan', ['Push', 'Pull'])];
    mockState.programs = { data: undefined, isError: false };
    renderCard();

    expect(screen.queryByText('Push')).toBeNull();
  });

  it('treats every plan as standalone when acting on behalf of another user', () => {
    mockState.actingOnBehalf = true;
    mockState.plans = [makePlan('7', 'Program plan', ['Push', 'Pull'])];
    mockState.programs = { data: undefined, isError: false };
    renderCard();

    expect(pickerFor('Push')).toBeDefined();
  });
});
