import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import DashboardWorkoutPreview from '@/pages/Diary/DashboardWorkoutPreview';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    weightUnit: 'kg',
    distanceUnit: 'km',
    convertDistance: (value: number) => value,
  }),
}));
jest.mock('@/hooks/Exercises/useWorkoutSessionPreview', () => ({
  useWorkoutSessionPreview: () => ({
    data: {
      exercises: [
        {
          exercise_name: 'Run',
          exercise: { modality: 'duration_distance' },
          sets: [{ rpe: 8 }],
        },
      ],
    },
  }),
}));

it('uses nested exercise modality for cardio effort', () => {
  render(
    <DashboardWorkoutPreview name="Session" context="Today" onStart={jest.fn()}>
      <button>Preview</button>
    </DashboardWorkoutPreview>
  );
  fireEvent.click(screen.getByText('Preview'));
  expect(screen.getByText('RPE 8')).toBeInTheDocument();
  expect(screen.queryByText('RIR 2')).not.toBeInTheDocument();
});
