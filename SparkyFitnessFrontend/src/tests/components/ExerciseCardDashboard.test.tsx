import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DASHBOARD_WORKOUT_CARD_ATTRIBUTES } from '@workspace/shared';
import type { TrainingProgram, WorkoutFormat } from '@workspace/shared';
import type { GroupedExerciseEntry } from '@/types/exercises';
import ExerciseCard from '@/pages/Diary/ExerciseCard';
import type { WorkoutPlanTemplate } from '@/types/workout';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));
jest.mock('react-i18next', () => {
  const { createInstance } =
    jest.requireActual<typeof import('i18next')>('i18next');
  const en = jest.requireActual<
    typeof import('../../../public/locales/en/translation.json')
  >('../../../public/locales/en/translation.json');
  const i18n = createInstance();
  void i18n.init({
    lng: 'en',
    initAsync: false,
    resources: {
      en: {
        translation: { dashboardWorkoutPreview: en.dashboardWorkoutPreview },
      },
    },
  });
  return { useTranslation: () => ({ t: i18n.t.bind(i18n), i18n }) };
});
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
    weightUnit: 'kg',
    distanceUnit: mockState.distanceUnit,
    convertWeight: (value: number) => value,
    convertDistance: (value: number) =>
      mockState.distanceUnit === 'miles' ? value / 1.609344 : value,
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
    queryFn: () => mockExerciseFetch(id),
    retry: false,
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
const mockExerciseFetch = jest.fn();
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
  distanceUnit: 'km' | 'miles';
  actingOnBehalf: boolean;
  plans: WorkoutPlanTemplate[];
  programs: ProgramsResult;
  entries: GroupedExerciseEntry[];
} = {
  distanceUnit: 'km',
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

const renderCard = (selectedDate = '2026-10-12', client = new QueryClient()) =>
  render(
    <QueryClientProvider client={client}>
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
    mockState.distanceUnit = 'km';
    mockExerciseFetch.mockReset().mockImplementation(async (id: string) => ({
      id,
      name: `Exercise ${id}`,
      category: null,
      modality: null,
    }));
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

  it.each([
    { unit: 'km' as const, carry: '4 m', run: '0.004 km' },
    { unit: 'miles' as const, carry: '4.37445 yd', run: '0.00248548 miles' },
  ])(
    'previews short carry and run targets in $unit without rounding to zero',
    async ({ unit, carry, run }) => {
      mockState.distanceUnit = unit;
      const plan = makePlan('7', 'Program plan', ['Conditioning']);
      plan.sessions[0]!.assignments = [
        {
          id: 'frozen',
          sets: [],
          preset_snapshot: {
            id: 42,
            user_id: 'athlete',
            name: 'Conditioning',
            exercises: [
              {
                exercise_id: 'carry',
                exercise_name: 'Carry',
                modality: 'weight_distance',
                sets: [{ set_number: 1, distance: 0.004, weight: 20 }],
              },
              {
                exercise_id: 'run',
                exercise_name: 'Run',
                modality: 'duration_distance',
                sets: [{ set_number: 1, distance: 0.004, duration: 10 }],
              },
            ],
          },
        },
      ];
      mockState.plans = [plan];
      mockState.programs = { data: [programLinkedTo('7')], isError: false };
      renderCard();
      fireEvent.click(screen.getByRole('button', { name: /Preview workout:/ }));
      const dialog = screen.getByRole('dialog');
      expect(await within(dialog).findByText(`20 kg · ${carry}`)).toBeVisible();
      expect(within(dialog).getByText(`10s · ${run}`)).toBeVisible();
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Start Workout' })
      );
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
      expect(
        mockNavigate.mock.calls[0]![1].state.draft.exercises.map(
          (exercise: { sets: { distance: number }[] }) =>
            exercise.sets[0]!.distance
        )
      ).toEqual([0.004, 0.004]);
    }
  );

  it.each<{
    name: string;
    presets: { format: WorkoutFormat; cap: number }[];
    format: WorkoutFormat;
    label: string;
    cap: number | null;
  }>([
    {
      name: 'single frozen EMOM',
      presets: [{ format: 'emom', cap: 600 }],
      format: 'emom',
      label: 'EMOM',
      cap: 600,
    },
    {
      name: 'matching frozen presets',
      presets: [
        { format: 'emom', cap: 600 },
        { format: 'emom', cap: 600 },
      ],
      format: 'emom',
      label: 'EMOM',
      cap: 600,
    },
    {
      name: 'mixed frozen formats',
      presets: [
        { format: 'emom', cap: 600 },
        { format: 'tabata', cap: 600 },
      ],
      format: 'standard',
      label: 'Standard',
      cap: null,
    },
    {
      name: 'mixed frozen caps',
      presets: [
        { format: 'emom', cap: 600 },
        { format: 'emom', cap: 90 },
      ],
      format: 'emom',
      label: 'EMOM',
      cap: null,
    },
  ])(
    'previews the resolved format and cap for $name exactly as Start Workout loads',
    async ({ presets, format, label, cap }) => {
      const plan = makePlan('7', 'Program plan', ['Conditioning']);
      plan.sessions[0]!.assignments = presets.map((preset, index) => ({
        id: `frozen-${index}`,
        sort_order: index,
        sets: [],
        preset_snapshot: {
          id: index,
          user_id: 'athlete',
          name: 'Frozen',
          workout_format: preset.format,
          time_cap_seconds: preset.cap,
          exercises: [
            {
              exercise_id: `carry-${index}`,
              exercise_name: `Carry ${index + 1}`,
              modality: 'weight_distance',
              sets: [{ set_number: 1, distance: 0.004, weight: 20 }],
            },
          ],
        },
      }));
      mockState.plans = [plan];
      mockState.programs = { data: [programLinkedTo('7')], isError: false };
      renderCard();
      fireEvent.click(screen.getByRole('button', { name: /Preview workout:/ }));
      const dialog = screen.getByRole('dialog');
      await within(dialog).findByRole('heading', { name: '1. Carry 1' });
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockComplete).not.toHaveBeenCalled();
      expect(mockOutcome).not.toHaveBeenCalled();
      expect(within(dialog).getByText(label)).toBeVisible();
      if (cap === 600)
        expect(within(dialog).getByText('Cap: 10:00')).toBeVisible();
      else expect(within(dialog).queryByText(/^Cap:/)).not.toBeInTheDocument();
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Start Workout' })
      );
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
      expect(mockNavigate.mock.calls[0]![1].state.draft).toMatchObject({
        workout_format: format,
        time_cap_seconds: cap,
      });
    }
  );

  it('does not show a cached prescription after the plan changes and the preview reopens', async () => {
    const plan = makePlan('7', 'Program plan', ['Push']);
    plan.description = 'Old instructions';
    plan.updated_at = '2026-10-16T00:00:00Z';
    mockState.plans = [plan];
    mockState.programs = { data: [programLinkedTo('7')], isError: false };
    const client = new QueryClient();
    const view = renderCard(undefined, client);
    fireEvent.click(screen.getByRole('button', { name: /Preview workout:/ }));
    expect(await screen.findByText('Old instructions')).toBeVisible();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' })
    );
    mockState.plans = [
      {
        ...plan,
        description: 'New instructions',
        updated_at: '2026-10-17T00:00:00Z',
      },
    ];
    view.rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ExerciseCard
            selectedDate="2026-10-12"
            onExercisesLogged={jest.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
    let finishLoad!: () => void;
    mockExerciseFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLoad = () => resolve({ id: 'exercise-7', name: 'Push' });
        })
    );
    fireEvent.click(screen.getByRole('button', { name: /Preview workout:/ }));
    expect(screen.queryByText('Old instructions')).not.toBeInTheDocument();
    await act(async () => finishLoad());
    expect(await screen.findByText('New instructions')).toBeVisible();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Start Workout',
      })
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    expect(mockNavigate.mock.calls[0]![1].state.draft.description).toBe(
      'New instructions'
    );
  });

  it('uses singular and plural rep labels in the preview', async () => {
    const plan = makePlan('7', 'Program plan', ['Push']);
    plan.sessions[0]!.assignments[0]!.sets = [
      { set_number: 1, reps: 1 },
      { set_number: 2, reps: 2 },
    ];
    mockState.plans = [plan];
    mockState.programs = { data: [programLinkedTo('7')], isError: false };
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Preview workout:/ }));
    expect(await screen.findByText('1 rep')).toBeVisible();
    expect(screen.getByText('2 reps')).toBeVisible();
    expect(screen.queryByText('1 reps')).not.toBeInTheDocument();
  });

  it('previews the exact strength occurrence without starting or completing it', async () => {
    const plan = makePlan('7', 'Program plan', ['Push', 'Pull']);
    plan.sessions[1]!.assignments[0]!.sets = [
      { set_number: 1, reps: 12, weight: 40, rest_time: 90 },
    ];
    const program = programLinkedTo('7');
    const first = program.phases[0]!.weeks[0]!.sessions[0]!;
    program.phases[0]!.weeks[0]!.sessions.push({
      ...first,
      id: 'planned-repeat',
      effective_date: '2026-10-14',
      workout_session_id: '7-s2',
      workout_session_name: 'Pull',
    });
    mockState.plans = [plan];
    mockState.programs = { data: [program], isError: false };
    renderCard();
    const triggers = screen.getAllByRole('button', {
      name: /Preview workout:/,
    });
    fireEvent.click(triggers[1]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Pull' })).toBeVisible();
    expect(within(dialog).getByText(/2026-10-14/)).toBeVisible();
    expect(await within(dialog).findByText(/12 reps/)).toHaveTextContent(
      '40 kg'
    );
    expect(within(dialog).getByText(/90s rest/)).toBeVisible();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Start Workout' })
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    const draft = mockNavigate.mock.calls[0]![1].state.draft;
    expect(draft.workout_session_id).toBe('7-s2');
    expect(draft.training_program.session_id).toBe('planned-repeat');
  });

  it('includes a Cardio Test occurrence in the four-card queue and previews its protocol', async () => {
    const program = programLinkedTo('7');
    program.phases[0]!.weeks[0]!.sessions.unshift({
      ...program.phases[0]!.weeks[0]!.sessions[0]!,
      id: 'ramp-occurrence',
      workout_plan_id: null,
      workout_session_id: null,
      cardio_test_type: 'ramp',
      name: 'Ramp assessment',
      effective_date: '2026-10-11',
    });
    mockState.plans = [makePlan('7', 'Program plan', ['Push'])];
    mockState.programs = { data: [program], isError: false };
    renderCard();
    fireEvent.click(
      screen.getByRole('button', { name: /Preview workout: Ramp Test/ })
    );
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Ramp Test' })
    ).toBeVisible();
    expect(
      within(dialog).getByText(/100 W initially, increasing by 20 W per minute/)
    ).toBeVisible();
    expect(mockNavigate).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Start Workout' })
    );
    expect(mockNavigate).toHaveBeenCalledWith(
      '/cardio-tests?planned_session_id=ramp-occurrence&protocol=ramp'
    );
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('shows loading and retry states, then restores focus to the labelled card on close', async () => {
    mockState.plans = [makePlan('7', 'Program plan', ['Push'])];
    mockState.programs = { data: [programLinkedTo('7')], isError: false };
    let rejectLoad!: (reason: Error) => void;
    mockExerciseFetch.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject;
        })
    );
    renderCard();
    const trigger = screen.getByRole('button', {
      name: /Preview workout: Push/,
    });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('status')).toHaveTextContent('Loading workout');
    expect(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Start Workout',
      })
    ).toBeDisabled();
    rejectLoad(new Error('Offline'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load this workout. Try again.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/8 reps/)).toBeVisible();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' })
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('explains an empty session without starting it', async () => {
    const plan = makePlan('7', 'Program plan', ['Restoration']);
    plan.sessions[0]!.assignments = [];
    mockState.plans = [plan];
    mockState.programs = { data: [programLinkedTo('7')], isError: false };
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Preview workout:/ }));
    expect(
      await screen.findByText(
        'No exercises are prescribed in this Workout Session.'
      )
    ).toBeVisible();
    expect(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Start Workout',
      })
    ).toBeDisabled();
    expect(mockExerciseFetch).not.toHaveBeenCalled();
  });

  it('preserves each repeated occurrence and frozen exercise order and targets', async () => {
    const plan = makePlan('7', 'Program plan', ['Strength']);
    plan.sessions[0]!.assignments = [
      {
        id: 'frozen',
        sets: [],
        preset_snapshot: {
          id: 42,
          user_id: 'athlete',
          name: 'Frozen',
          exercises: [
            {
              exercise_id: 'hold',
              exercise_name: 'Loaded hold',
              sets: [
                {
                  set_number: 1,
                  duration: 30,
                  weight: 12,
                  rest_time: 0,
                  notes: 'Stay tall',
                },
              ],
            },
            {
              exercise_id: 'run',
              exercise_name: 'Run',
              sets: [
                { set_number: 1, distance: 0.4, duration: 120, rest_time: 60 },
              ],
            },
          ],
        },
      },
    ];
    const program = programLinkedTo('7');
    program.phases[0]!.weeks[0]!.sessions.push({
      ...program.phases[0]!.weeks[0]!.sessions[0]!,
      id: 'repeat',
      effective_date: '2026-10-15',
    });
    mockState.plans = [plan];
    mockState.programs = { data: [program], isError: false };
    renderCard();
    fireEvent.click(
      screen.getAllByRole('button', { name: /Preview workout:/ })[1]!
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/2026-10-15/)).toBeVisible();
    expect(
      await within(dialog).findByText(/12 kg · 30s · 0s rest · Stay tall/)
    ).toBeVisible();
    expect(within(dialog).getByText(/120s · 0.4 km · 60s rest/)).toBeVisible();
    expect(
      within(dialog)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent)
    ).toEqual(['1. Loaded hold', '2. Run']);
    expect(mockExerciseFetch).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Start Workout' })
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    expect(
      mockNavigate.mock.calls[0]![1].state.draft.training_program.session_id
    ).toBe('repeat');
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

  it('shows four Program cards in schedule order and no fifth card', () => {
    mockState.plans = ['7', '8', '9', '10', '11'].map((id) =>
      makePlan(id, `Plan ${id}`, [`Workout ${id}`])
    );
    const linked = programLinkedTo('7');
    const week = linked.phases[0]!.weeks[0]!;
    const baseSession = week.sessions[0]!;
    week.sessions = ['10', '8', '7', '9', '11'].map((id, index) => ({
      ...baseSession,
      id: `planned-${id}`,
      workout_plan_id: Number(id),
      workout_session_id: `${id}-s1`,
      effective_date: `2026-10-${String([18, 16, 15, 17, 19][index])}`,
    }));
    mockState.programs = { data: [linked], isError: false };
    renderCard();

    expect(
      screen.getAllByRole('button', { name: 'Mark complete' })
    ).toHaveLength(4);
    expect(
      screen
        .getAllByTestId(/dashboard-plan-/)
        .slice(0, 4)
        .map((item) => item.getAttribute('data-workout-plan-id'))
    ).toEqual(['7', '8', '9', '10']);
    expect(screen.queryByText('Workout 11')).not.toBeInTheDocument();
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
