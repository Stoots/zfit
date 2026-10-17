import '@testing-library/jest-dom';
import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import WorkoutPlanBulkDialog from '@/pages/Exercises/WorkoutPlanBulkDialog';
import type { WorkoutPlanTemplate } from '@/types/workout';

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);
jest.mock('@/hooks/TrainingPrograms/useTrainingPrograms', () => ({
  useTrainingProgramsList: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
}));
jest.mock('@/hooks/Exercises/useWorkoutPlanBulk', () => ({
  useWorkoutPlanBulk: () => ({
    candidates: { data: [] },
    preview: { isPending: false },
    apply: { isPending: false },
  }),
}));
// Keep source selection semantic without testing Radix pointer/portal plumbing.
jest.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">Choose</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

it.each([
  { modalities: ['duration_distance'], rpe: true, rir: false, name: 'cardio' },
  {
    modalities: ['weight_reps', 'duration_distance'],
    rpe: true,
    rir: true,
    name: 'mixed',
  },
  { modalities: ['weight_reps'], rpe: false, rir: true, name: 'strength' },
])(
  'offers the matching effort fields for a $name preset source',
  ({ modalities, rpe, rir }) => {
    const assignment = {
      id: 1,
      workout_preset_id: 7,
      sets: [],
      preset_snapshot: {
        id: 7,
        user_id: 'owner',
        name: 'Saved prescription',
        workout_format: 'standard' as const,
        exercises: modalities.map((modality, index) => ({
          exercise_id: `exercise-${index}`,
          exercise_name: `Exercise ${index}`,
          modality,
          sets: [{ set_number: 1 }],
        })),
      },
    };
    const plan = {
      id: '1',
      user_id: 'owner',
      plan_name: 'Plan',
      sessions: [
        {
          id: 'session-1',
          name: 'Session A',
          day_of_week: null,
          is_optional: false,
          sort_order: 0,
          assignments: [assignment],
        },
      ],
    } as unknown as WorkoutPlanTemplate;
    render(
      <WorkoutPlanBulkDialog
        plan={plan}
        draftSessions={plan.sessions}
        onClose={jest.fn()}
        onApplied={jest.fn()}
      />
    );
    fireEvent.change(screen.getAllByRole('combobox')[0]!, {
      target: { value: 'session-1:1' },
    });
    if (rpe)
      expect(screen.getByRole('checkbox', { name: 'RPE' })).toBeInTheDocument();
    else
      expect(
        screen.queryByRole('checkbox', { name: 'RPE' })
      ).not.toBeInTheDocument();
    if (rir)
      expect(
        screen.getByRole('checkbox', { name: 'Repetitions in reserve (RIR)' })
      ).toBeInTheDocument();
    else
      expect(
        screen.queryByRole('checkbox', { name: 'Repetitions in reserve (RIR)' })
      ).not.toBeInTheDocument();
  }
);
