import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type {
  ExerciseSessionResponse,
  TrainingProgram,
} from '@workspace/shared';
import ExerciseSummary from '../../src/components/ExerciseSummary';
import { useWorkoutPlanCandidates } from '../../src/hooks/useActiveWorkoutPlan';
import type { WorkoutPlanTemplate } from '../../src/types/workoutPlans';
import { initializeI18n } from '../../src/localization/i18n';

jest.mock('../../src/hooks/useActiveWorkoutPlan', () => ({
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
                effective_date: '2026-10-15',
              },
              {
                workout_plan_id: 2,
                workout_session_id: '2-next',
                status: 'planned',
                effective_date: '2026-10-12',
              },
            ],
          },
        ],
      },
    ],
  },
] as TrainingProgram[];

function setSchedule(data: TrainingProgram[] | undefined, isError = false) {
  jest
    .mocked(useTrainingPrograms)
    .mockReturnValue({ data, isError } as UseQueryResult<
      TrainingProgram[],
      Error
    >);
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
  fireEvent.press(view.getByRole('button', { name: 'Start: Cardio next' }));
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
  expect(view.queryByText('Strength next')).toBeNull();
  expect(view.queryByText('Cardio next')).toBeNull();
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
