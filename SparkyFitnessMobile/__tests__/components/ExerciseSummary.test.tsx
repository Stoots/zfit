import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  QueryClient,
  QueryClientProvider,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  ExerciseSessionResponse,
  TrainingProgram,
} from '@workspace/shared';
import ExerciseSummary from '../../src/components/ExerciseSummary';
import {
  useActiveWorkoutPlans,
  useWorkoutPlanCandidates,
} from '../../src/hooks/useActiveWorkoutPlan';
import { useTrainingPrograms } from '../../src/hooks/useTrainingPrograms';
import type { WorkoutPlanTemplate } from '../../src/types/workoutPlans';
import { initializeI18n } from '../../src/localization/i18n';
import { useDailySummary } from '../../src/hooks/useDailySummary';
import { recordTrainingProgramOutcome } from '../../src/services/api/trainingProgramsApi';
import type { DailySummary } from '../../src/types/dailySummary';
import {
  dailySummaryQueryKey,
  exerciseHistoryQueryKey,
  trainingProgramsQueryKey,
  workoutPlanTemplatesQueryKey,
} from '../../src/hooks/queryKeys';
jest.mock('../../src/hooks/useDailySummary', () => ({
  useDailySummary: jest.fn(),
}));
jest.mock('../../src/services/api/trainingProgramsApi', () => ({
  recordTrainingProgramOutcome: jest.fn(),
}));
jest.mock('../../src/hooks/useTrainingPrograms', () => ({
  useTrainingPrograms: jest.fn(),
}));

jest.mock('../../src/hooks/useActiveWorkoutPlan', () => ({
  useActiveWorkoutPlans: jest.fn(),
  useWorkoutPlanCandidates: jest.fn(),
}));
jest.mock('../../src/components/Icon', () => 'Icon');
jest.mock(
  '../../src/components/SwipeableExerciseRow',
  () => 'SwipeableExerciseRow'
);
jest.mock('../../src/components/BottomSheetPicker', () => {
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({
      renderTrigger,
    }: {
      renderTrigger: (p: { onPress: () => void }) => React.ReactNode;
    }) => (
      <View testID="session-picker">
        {renderTrigger({ onPress: jest.fn() })}
      </View>
    ),
  };
});
jest.mock('uniwind', () => ({ useCSSVariable: () => '#3B82F6' }));

function plan(id: string, name: string): WorkoutPlanTemplate {
  const first = {
    id: `${id}-first`,
    name: `${name} previous`,
    day_of_week: null,
    is_optional: false,
    sort_order: 0,
    assignments: [
      {
        id: Number(id) * 10,
        workout_session_id: `${id}-first`,
        sort_order: 0,
        exercise_id: 'row',
        sets: [],
      },
    ],
  };
  const next = {
    id: `${id}-next`,
    name,
    day_of_week: null,
    is_optional: false,
    sort_order: 1,
    assignments: [
      {
        id: Number(id) * 10 + 1,
        workout_session_id: `${id}-next`,
        sort_order: 0,
        exercise_id: 'row',
        sets: [],
      },
    ],
  };
  return {
    id: Number(id),
    user_id: 'athlete',
    plan_name: `Plan ${id}`,
    start_date: '2026-10-01',
    is_active: true,
    schedule_type: 'sequential',
    sessions: [first, next],
    next_session: next,
    next_assignments: next.assignments,
    sequence_position: { current: 2, total: 2 },
  } as WorkoutPlanTemplate;
}
const strength = plan('1', 'Strength next');
const cardio = plan('2', 'Cardio next');
const programs = [
  {
    phases: [
      {
        weeks: [
          {
            sessions: [
              {
                workout_plan_id: 1,
                workout_session_id: '1-next',
                status: 'planned',
                is_optional: false,
                effective_date: '2026-10-15',
              },
              {
                workout_plan_id: 2,
                workout_session_id: '2-next',
                status: 'planned',
                is_optional: false,
                effective_date: '2026-10-12',
              },
            ],
          },
        ],
      },
    ],
  },
] as TrainingProgram[];

type ActivePlansResult = {
  plans: WorkoutPlanTemplate[];
  isLoading: boolean;
  isError: boolean;
  refetch: UseQueryResult<WorkoutPlanTemplate[], Error>['refetch'];
};

type PlanCandidatesResult = {
  plans: WorkoutPlanTemplate[];
  programs: TrainingProgram[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown[]>;
};

function setSchedule(data: TrainingProgram[] | undefined, isError = false) {
  jest.mocked(useActiveWorkoutPlans).mockReturnValue({
    plans: [strength, cardio],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  } satisfies ActivePlansResult);
  jest.mocked(useWorkoutPlanCandidates).mockReturnValue({
    plans: [strength, cardio],
    programs: data,
    isLoading: false,
    isError,
    refetch: async () => [],
  } satisfies PlanCandidatesResult);
  jest.mocked(useTrainingPrograms).mockReturnValue({
    data,
    isError,
  } as UseQueryResult<TrainingProgram[], Error>);
}

beforeAll(async () => {
  await initializeI18n('en');
});
beforeEach(() => {
  setSchedule(programs);
});

it('previews and starts the exact workout session selected by the Program', () => {
  const start = jest.fn();
  const view = render(
    <ExerciseSummary
      exerciseEntries={[]}
      entryDate="2026-10-11"
      onPressPlanSession={start}
    />
  );
  expect(view.getByText('Cardio next')).toBeTruthy();
  expect(view.queryByText('Strength next')).toBeNull();
  expect(view.queryByText('Cardio next previous')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: 'Start' }));
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({ id: cardio.id }),
    cardio.next_session
  );
});

it('suppresses a logged earliest Program session without promoting a later date', () => {
  const entries = [
    { id: 'logged', workout_plan_assignment_id: 21 },
  ] as unknown as ExerciseSessionResponse[];
  const view = render(
    <ExerciseSummary exerciseEntries={entries} entryDate="2026-10-11" />
  );
  expect(view.queryByRole('button', { name: 'Start' })).toBeNull();
});

it('does not flash the whole program before its schedule loads, and leaves adding exercise usable', () => {
  setSchedule(undefined);
  const add = jest.fn();
  const view = render(
    <ExerciseSummary
      exerciseEntries={[]}
      entryDate="2026-10-11"
      onAddExercise={add}
    />
  );
  expect(view.queryByText('Cardio next')).toBeNull();
  expect(view.queryByText('Strength next')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: 'Add exercise' }));
  expect(add).toHaveBeenCalledTimes(1);
  setSchedule(programs);
  view.rerender(
    <ExerciseSummary
      exerciseEntries={[]}
      entryDate="2026-10-11"
      onAddExercise={add}
    />
  );
  expect(view.getByText('Cardio next')).toBeTruthy();
  expect(view.queryByText('Strength next')).toBeNull();
});

it('shows the program preview without a session picker', () => {
  const view = render(
    <ExerciseSummary exerciseEntries={[]} entryDate="2026-10-11" />
  );
  expect(view.getByText('Cardio next')).toBeTruthy();
  expect(view.queryByTestId('session-picker')).toBeNull();
});

it('offers a session picker on a standalone multi-session plan', () => {
  setSchedule([]);
  const view = render(
    <ExerciseSummary exerciseEntries={[]} entryDate="2026-10-11" />
  );
  expect(view.getByText('Strength next')).toBeTruthy();
  expect(view.getByText('Cardio next')).toBeTruthy();
  expect(view.getAllByTestId('session-picker')).toHaveLength(2);
});

it('falls back to showing every eligible plan when the programs query fails', () => {
  setSchedule(undefined, true);
  const view = render(
    <ExerciseSummary exerciseEntries={[]} entryDate="2026-10-11" />
  );
  expect(view.getByText('Strength next')).toBeTruthy();
  expect(view.getByText('Cardio next')).toBeTruthy();
  expect(view.getAllByTestId('session-picker')).toHaveLength(2);
});

it('skips omitted optional work, retains its history and allows an explicit later diary completion', async () => {
  const data = JSON.parse(JSON.stringify(programs)) as TrainingProgram[];
  const rows = data[0]!.phases[0]!.weeks[0]!.sessions;
  rows[0] = {
    ...rows[0]!,
    id: 'omitted',
    name: 'Accessory',
    workout_session_name: 'Strength next',
    workout_plan_name: 'Plan 1',
    is_optional: true,
    status: 'omitted',
    effective_date: '2026-10-11',
  };
  rows[1]!.is_optional = false;
  data[0]!.id = 'program';
  setSchedule(data);
  const candidate = {
    type: 'preset',
    id: 'logged-late',
    name: 'Performed accessory',
    entry_date: '2026-10-13',
  } as ExerciseSessionResponse;
  jest.mocked(useDailySummary).mockImplementation(({ date }) => ({
    summary: {
      exerciseEntries: date === '2026-10-13' ? [candidate] : [],
    } as DailySummary,
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  }));
  jest.mocked(recordTrainingProgramOutcome).mockResolvedValue(data[0]!);
  const start = jest.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const affectedKeys = [
    trainingProgramsQueryKey,
    workoutPlanTemplatesQueryKey,
    exerciseHistoryQueryKey,
    dailySummaryQueryKey('2026-10-13'),
  ];
  for (const queryKey of affectedKeys) {
    client.setQueryData(queryKey, { stale: true });
  }
  const view = render(
    <QueryClientProvider client={client}>
      <ExerciseSummary
        exerciseEntries={[]}
        entryDate="2026-10-11"
        onPressPlanSession={start}
      />
    </QueryClientProvider>
  );
  expect(view.getByText('Omitted · Optional')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Start' }));
  expect(start.mock.calls[0][1]).toMatchObject({
    id: '2-next',
    is_optional: false,
  });
  fireEvent.press(view.getByRole('button', { name: 'Link completed workout' }));
  expect(
    view.getByRole('button', { name: 'Confirm completion' }).props
      .accessibilityState.disabled
  ).toBe(true);
  fireEvent.changeText(view.getByLabelText('Diary workout date'), '2026-10-13');
  fireEvent.press(view.getByRole('button', { name: 'Performed accessory' }));
  fireEvent.press(view.getByRole('button', { name: 'Confirm completion' }));
  await waitFor(() =>
    expect(recordTrainingProgramOutcome).toHaveBeenCalledWith(
      'program',
      'omitted',
      { status: 'completed', workout: { type: 'preset', id: 'logged-late' } }
    )
  );
  await waitFor(() =>
    expect(view.queryByLabelText('Diary workout date')).toBeNull()
  );
  await waitFor(() =>
    expect(
      affectedKeys.map(
        (queryKey) => client.getQueryState(queryKey)?.isInvalidated
      )
    ).toEqual([true, true, true, true])
  );
});
