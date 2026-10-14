import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ExerciseModality } from '@workspace/shared';
import WorkoutPlaybackTarget from '@/pages/Diary/WorkoutPlaybackTarget';
import type { WorkoutPlaybackExerciseDraft } from '@/utils/workoutPlayback';

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);
let mockWeightUnit = 'kg';
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ weightUnit: mockWeightUnit, distanceUnit: 'km' }),
}));

function exercise(modality: ExerciseModality): WorkoutPlaybackExerciseDraft {
  return {
    exercise_id: 'exercise',
    exercise_name: 'Exercise',
    notes: null,
    modality,
    sets: [
      {
        set_number: 1,
        weight: 100,
        reps: 5,
        duration: 30,
        distance: 0.02,
        completed: false,
        completed_at: null,
      },
    ],
  };
}

beforeEach(() => {
  mockWeightUnit = 'kg';
});

it('shows the actual prescribed load and reps in the selected unit', () => {
  mockWeightUnit = 'lbs';
  render(
    <WorkoutPlaybackTarget exercise={exercise('weight_reps')} setIndex={0} />
  );
  expect(screen.getByText('220.5')).toBeInTheDocument();
  expect(screen.getByText('lbs')).toBeInTheDocument();
  expect(screen.getByText('5')).toBeInTheDocument();
});

it.each([
  ['weight_distance', '20', 'm'],
  ['weight_duration', '0:30', 'Duration'],
  ['reps_only', '5', 'reps'],
] as const)(
  'uses the %s prescription without unrelated fields',
  (modality, value, unit) => {
    render(
      <WorkoutPlaybackTarget exercise={exercise(modality)} setIndex={0} />
    );
    expect(screen.getByText(value)).toBeInTheDocument();
    expect(screen.getByText(unit)).toBeInTheDocument();
    if (modality !== 'reps_only')
      expect(screen.queryByText('reps')).not.toBeInTheDocument();
    else expect(screen.queryByText('kg')).not.toBeInTheDocument();
  }
);

it('retains assisting bodyweight loads and does not invent a value for missing prescriptions', () => {
  const item = exercise('bodyweight_reps');
  item.sets[0]!.weight = -20;
  item.sets[0]!.reps = null;
  render(<WorkoutPlaybackTarget exercise={item} setIndex={0} />);
  expect(screen.getByText('-20')).toBeInTheDocument();
  expect(screen.getByText('± kg')).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument();
});
