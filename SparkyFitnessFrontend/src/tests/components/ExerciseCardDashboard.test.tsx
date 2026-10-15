import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DASHBOARD_WORKOUT_CARD_ATTRIBUTES } from '@workspace/shared';
import type { TrainingProgram } from '@workspace/shared';
import type { GroupedExerciseEntry } from '@/types/exercises';
import ExerciseCard from '@/pages/Diary/ExerciseCard';
import type { WorkoutPlanTemplate } from '@/types/workout';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
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
  exerciseByIdOptions: (id: string) => ({
    queryKey: ['exercise', id],
    queryFn: async () => ({
      id,
      name: `Exercise ${id}`,
      category: null,
      modality: null,
    }),
  }),
}));
jest.mock('@/hooks/TrainingPrograms/useTrainingPrograms', () => ({
  useTrainingProgramsList: () => mockState.programs,
  useTrainingPrograms: () => ({
    outcome: { mutateAsync: mockOutcome, isPending: false },
    complete: { mutateAsync: mockComplete, isPending: false },
  }),
}));
jest.mock('@/hooks/Exercises/useExerciseEntries', () => ({
  useExerciseEntries: () => ({
    data: mockState.entries,
    isLoading: false,
    isPending: false,
    isError: false,
    refetch: () => mockFetchEntries(),
  }),
  useDeleteExerciseEntryMutation: () => ({ mutateAsync: jest.fn() }),
  useDeleteExercisePresetEntryMutation: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock('@/pages/Diary/ExercisePresetEntryDisplay', () => () => null);
jest.mock('@/pages/Diary/ExerciseEntryDisplay', () => () => null);
const mockComplete = jest.fn();
const mockOutcome = jest.fn();
const mockFetchEntries = jest.fn();
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
  entries: GroupedExerciseEntry[];
} = {
  actingOnBehalf: false,
  plans: [],
  programs: { data: [], isError: false },
  entries: [],
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
    assignments: [
      {
        id: `${id}-a${index + 1}`,
        exercise_id: `exercise-${id}`,
        exercise_name: name,
        sets: [{ set_number: 1, reps: 8, weight: 20 }],
      },
    ],
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
    mockNavigate.mockReset();
    mockComplete.mockReset().mockResolvedValue({});
    mockOutcome.mockReset().mockResolvedValue({});
    mockState.actingOnBehalf = false;
    mockState.programs = { data: [], isError: false };
    mockState.plans = [];
    mockState.entries = [];
    mockFetchEntries
      .mockReset()
      .mockImplementation(() => Promise.resolve({ data: mockState.entries }));
  });

  it('offers a date picker and explicit choice for an existing workout on another date', async () => {
    mockState.plans = [makePlan('7', 'Program plan', ['Push'])];
    mockState.programs = { data: [programLinkedTo('7')], isError: false };
    mockState.entries = [
      {
        type: 'preset',
        id: 'yesterday',
        entry_date: '2026-10-11',
        name: 'Push',
        exercises: [{ workout_plan_assignment_id: '7-a1' }],
      } as unknown as GroupedExerciseEntry,
    ];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Link an existing workout' })
    );
    expect(
      await screen.findByText('Link completed workout')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Diary workout date')).toBeInTheDocument();
    expect(screen.getByLabelText('Completed diary workout')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Diary workout date'), {
      target: { value: '2026-10-11' },
    });
    fireEvent.change(screen.getByLabelText('Completed diary workout'), {
      target: { value: 'preset:yesterday' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm completion' }));
    await waitFor(() =>
      expect(mockOutcome).toHaveBeenCalledWith({
        programId: 'program-1',
        sessionId: 'planned-session-1',
        input: {
          status: 'completed',
          workout: { type: 'preset', id: 'yesterday' },
        },
      })
    );
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('keeps partial same-day matches selectable without preselecting them or already linked workouts', async () => {
    const program = programLinkedTo('7');
    program.phases[0]!.weeks[0]!.sessions.push({
      ...program.phases[0]!.weeks[0]!.sessions[0]!,
      id: 'planned-session-2',
      completed_workout: {
        type: 'preset',
        id: 'used',
        name: 'Push',
        entry_date: '2026-10-12',
      },
      status: 'completed',
    });
    mockState.plans = [makePlan('7', 'Program plan', ['Push'])];
    mockState.programs = { data: [program], isError: false };
    mockState.entries = [
      {
        type: 'preset',
        id: 'used',
        entry_date: '2026-10-12',
        name: 'Push',
        exercises: [{ workout_plan_assignment_id: '7-a1' }],
      },
      {
        type: 'preset',
        id: 'partial',
        entry_date: '2026-10-12',
        name: 'Partial Push',
        exercises: [{ workout_plan_assignment_id: '7-a1' }],
      },
    ] as unknown as GroupedExerciseEntry[];
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Link an existing workout' })
    );
    const picker = screen.getByLabelText('Completed diary workout');
    expect(picker).toHaveValue('');
    expect(
      screen.getByRole('option', { name: /Partial Push/ })
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Push ·/ })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Confirm completion' })
    ).toBeDisabled();
  });

  it('uses only the link flow when the bound session has no prescribed sets', async () => {
    mockState.plans = [makePlan('7', 'Program plan', ['Restoration'])];
    mockState.plans[0]!.next_session!.assignments[0]!.sets = [];
    mockState.programs = { data: [programLinkedTo('7')], isError: false };
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    expect(
      await screen.findByText('Link completed workout')
    ).toBeInTheDocument();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('renders the exact workout attributes read by the deployment smoke gate', () => {
    const plan = makePlan('7', 'Program plan', ['Push']);
    mockState.plans = [plan];
    mockState.programs = { data: [programLinkedTo('7')], isError: false };
    renderCard();

    const card = screen.getByTestId('dashboard-plan-7');
    expect(card.getAttribute(DASHBOARD_WORKOUT_CARD_ATTRIBUTES.sessionId)).toBe(
      plan.next_session!.id
    );
    expect(card.getAttribute(DASHBOARD_WORKOUT_CARD_ATTRIBUTES.planId)).toBe(
      '7'
    );
    expect(
      card.getAttribute(DASHBOARD_WORKOUT_CARD_ATTRIBUTES.programSessionId)
    ).toBe('planned-session-1');
    expect(
      JSON.parse(
        card.getAttribute(DASHBOARD_WORKOUT_CARD_ATTRIBUTES.prescription)!
      )
    ).toEqual(plan.next_session!.assignments);
  });

  it('confirms before completing the later card by exact Planned Session ID', async () => {
    const first = makePlan('7', 'First plan', ['Push']);
    const later = makePlan('8', 'Later plan', ['Pull']);
    first.next_session!.assignments[0]!.sets = [
      { set_number: 1, reps: 8, weight: 20 },
    ];
    later.next_session!.assignments[0]!.sets = [
      { set_number: 1, reps: 12, weight: 40 },
    ];
    mockState.plans = [first, later];
    const program = programLinkedTo('7');
    program.phases[0]!.weeks[0]!.sessions.push({
      ...program.phases[0]!.weeks[0]!.sessions[0]!,
      id: 'planned-session-2',
      workout_plan_id: 8,
      workout_session_id: '8-s1',
      workout_session_name: 'Pull',
      scheduled_date: '2026-10-13',
      effective_date: '2026-10-13',
    });
    mockState.programs = { data: [program], isError: false };
    renderCard();
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Mark complete' })[1]!
    );
    expect(mockComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm completion' }));
    await waitFor(() =>
      expect(mockComplete).toHaveBeenCalledWith({
        programId: 'program-1',
        sessionId: 'planned-session-2',
        input: { entry_date: '2026-10-12' },
      })
    );
  });

  it('submits atomic completion once while the response is pending', async () => {
    mockState.plans = [makePlan('7', 'Program plan', ['Push'])];
    mockState.programs = { data: [programLinkedTo('7')], isError: false };
    let finish!: (value: object) => void;
    mockComplete.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    const confirm = screen.getByRole('button', { name: 'Confirm completion' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    finish({});
    await waitFor(() =>
      expect(screen.queryByText('Complete this workout?')).toBeNull()
    );
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

  it('carries the Planned Session into a real playback draft', async () => {
    mockState.plans = [makePlan('7', 'Program plan', ['Push'])];
    mockState.programs = { data: [programLinkedTo('7')], isError: false };
    renderCard();
    fireEvent.click(
      screen.getByRole('button', { name: /^Start Workout: Push/ })
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    const [, options] = mockNavigate.mock.calls[0]!;
    expect(options.state.draft.training_program).toEqual({
      program_id: 'program-1',
      session_id: 'planned-session-1',
    });
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
