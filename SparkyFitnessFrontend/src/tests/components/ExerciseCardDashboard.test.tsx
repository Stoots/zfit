import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { TrainingProgram } from '@workspace/shared';
import ExerciseCard from '@/pages/Diary/ExerciseCard';
import type { WorkoutPlanTemplate } from '@/types/workout';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));
jest.mock('@/utils/workoutPlanSession', () => ({
  buildWorkoutPlanSessionPreset: jest.fn(async () => ({
    id: 'session-preset',
    user_id: 'athlete',
    name: 'Push',
    exercises: [],
  })),
}));

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
    energyUnit: 'kcal',
    convertEnergy: (value: number) => value,
    getEnergyUnitString: () => 'kcal',
  }),
}));
jest.mock('@/hooks/Exercises/useExerciseEntries', () => ({
  useExerciseEntries: () => ({ data: [], isLoading: false }),
  useDeleteExerciseEntryMutation: () => ({ mutateAsync: jest.fn() }),
  useDeleteExercisePresetEntryMutation: () => ({ mutateAsync: jest.fn() }),
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
}));
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
    mockNavigate.mockReset();
    mockState.actingOnBehalf = false;
    mockState.programs = { data: [], isError: false };
    mockState.plans = [];
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

  it('carries the exact Program identity into the persisted playback draft', async () => {
    mockState.plans = [makePlan('7', 'Program plan', ['Push', 'Pull'])];
    mockState.programs = { data: [programLinkedTo('7')], isError: false };
    renderCard();
    fireEvent.click(
      screen.getByRole('button', { name: /^Start Workout: Push/ })
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        '/workout-playback?date=2026-10-12',
        expect.objectContaining({
          state: expect.objectContaining({
            draft: expect.objectContaining({
              training_program: {
                program_id: 'program-1',
                session_id: 'planned-session-1',
              },
            }),
          }),
        })
      )
    );
  });

  it('advances to the next pending session when the completed outcome refreshes', () => {
    mockState.plans = [makePlan('7', 'Program plan', ['Push', 'Pull'])];
    const program = programLinkedTo('7');
    const sessions = program.phases[0]!.weeks[0]!.sessions;
    sessions.push({
      ...sessions[0]!,
      id: 'planned-session-2',
      workout_session_id: '7-s2',
      effective_date: '2026-10-13',
    });
    mockState.programs = { data: [program], isError: false };
    const view = renderCard();
    expect(screen.getByText('Push')).toBeInTheDocument();
    sessions[0]!.status = 'completed';
    mockState.programs = { data: structuredClone([program]), isError: false };
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ExerciseCard
            selectedDate="2026-10-12"
            onExercisesLogged={jest.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(screen.getByText('Pull')).toBeInTheDocument();
    expect(screen.queryByText('Push')).not.toBeInTheDocument();
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
