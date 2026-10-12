import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type {
  ExerciseSessionResponse,
  TrainingProgram,
} from '@workspace/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import ExerciseSummary from '../../src/components/ExerciseSummary';
import { useActiveWorkoutPlans } from '../../src/hooks/useActiveWorkoutPlan';
import { useTrainingPrograms } from '../../src/hooks/useTrainingPrograms';
import type { WorkoutPlanTemplate } from '../../src/types/workoutPlans';
import { initializeI18n } from '../../src/localization/i18n';

jest.mock('../../src/hooks/useActiveWorkoutPlan', () => ({
  useActiveWorkoutPlans: jest.fn(),
}));
jest.mock('../../src/hooks/useTrainingPrograms', () => ({
  useTrainingPrograms: jest.fn(),
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
    template_id: id,
    day_of_week: null,
    session_index: 1,
    session_name: `${name} previous`,
    sort_order: 0,
    sets: [],
  };
  const next = {
    ...first,
    id: `${id}-next`,
    session_index: 2,
    session_name: name,
  };
  return {
    id,
    user_id: 'athlete',
    plan_name: `Plan ${id}`,
    start_date: '2026-10-01',
    is_active: true,
    schedule_type: 'sequential',
    assignments: [first, next],
    next_assignment: next,
    sequence_position: { current: 2, total: 2 },
  };
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
                status: 'planned',
                effective_date: '2026-10-15',
              },
              {
                workout_plan_id: 2,
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
  jest.mocked(useActiveWorkoutPlans).mockReturnValue({
    plans: [strength, cardio],
    plan: strength,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  setSchedule(programs);
});

it('previews only the scheduled program workout and starts its resolved next session', () => {
  const start = jest.fn();
  const view = render(
    <ExerciseSummary
      exerciseEntries={[]}
      entryDate="2026-10-11"
      onPressPlanAssignment={start}
    />
  );
  expect(view.getByText('Cardio next')).toBeTruthy();
  expect(view.queryByText('Strength next')).toBeNull();
  expect(view.queryByText('Cardio next previous')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: 'Start' }));
  expect(start).toHaveBeenCalledWith(cardio, cardio.next_assignment);
});

it('moves the preview past a plan logged today without offering a different session in that plan', () => {
  const entries = [
    { id: 'logged', workout_plan_assignment_id: '2-next' },
  ] as unknown as ExerciseSessionResponse[];
  const view = render(
    <ExerciseSummary exerciseEntries={entries} entryDate="2026-10-11" />
  );
  expect(view.getByText('Strength next')).toBeTruthy();
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
