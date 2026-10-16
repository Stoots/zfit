import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  selectUpcomingDashboardWorkoutPlans,
  type TrainingProgram,
} from '@workspace/shared';
import { useTrainingPrograms } from '@/hooks/TrainingPrograms/useTrainingPrograms';
import * as api from '@/api/TrainingPrograms/trainingPrograms';
import { getWorkoutPlanTemplates } from '@/api/Exercises/workoutPlanTemplates';
import { trainingProgramKeys } from '@/api/keys/exercises';

jest.mock('@/api/TrainingPrograms/trainingPrograms');
jest.mock('@/api/Exercises/workoutPlanTemplates');
jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);

function program(): TrainingProgram {
  return {
    id: 'program',
    user_id: 'athlete',
    name: 'Strength',
    goal: 'Consistency',
    start_date: '2026-10-12',
    end_date: '2026-10-18',
    schedule_end_date: '2026-10-18',
    schedule_type: 'fixed',
    auto_shift: false,
    created_at: '2026-10-12T00:00:00Z',
    updated_at: '2026-10-12T00:00:00Z',
    phases: [
      {
        id: 'phase',
        name: 'Foundation',
        goal: 'Strength',
        sort_order: 0,
        weeks: [
          {
            id: 'week',
            start_date: '2026-10-12',
            end_date: '2026-10-18',
            sort_order: 0,
            sessions: Array.from({ length: 6 }, (_, index) => ({
              id: `occurrence-${index + 1}`,
              name: 'Push',
              sort_order: index,
              scheduled_date: `2026-10-${12 + index}`,
              effective_date: `2026-10-${12 + index}`,
              is_optional: false,
              status: 'planned',
              outcome_at: null,
              workout_plan_id: 7,
              workout_plan_name: 'Strength',
              workout_session_id: 'reusable-session',
              workout_session_name: 'Push',
              cardio_test_type: null,
              completed_workout: null,
              completed_test_attempt: null,
            })),
          },
        ],
      },
    ],
  };
}
const plans = [
  { id: 7, sessions: [{ id: 'reusable-session', assignments: [] }] },
];
const queue = (programs: TrainingProgram[]) =>
  selectUpcomingDashboardWorkoutPlans(plans, programs, 4).programPlans.map(
    (plan) => plan.training_program_session_id
  );

it.each(['complete', 'link', 'playback'] as const)(
  '%s replaces only the completed occurrence before list reconciliation, ignoring an older response',
  async (path) => {
    jest.clearAllMocks();
    const before = program();
    const saved = program();
    saved.phases[0]!.weeks[0]!.sessions[2]!.status = 'completed';
    const otherProgram = { ...program(), id: 'unrelated-program', phases: [] };
    const anotherUser = [{ ...program(), user_id: 'other-user' }];
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    client.setQueryData(trainingProgramKeys.list('athlete'), [
      before,
      otherProgram,
    ]);
    client.setQueryData(trainingProgramKeys.list('other-user'), anotherUser);
    let resolveOld!: (value: TrainingProgram[]) => void;
    jest
      .mocked(api.getTrainingPrograms)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          })
      )
      .mockImplementation(() => new Promise(() => {}));
    jest.mocked(api.completeTrainingProgramSession).mockResolvedValue(saved);
    jest.mocked(api.recordTrainingProgramOutcome).mockResolvedValue(saved);
    jest.mocked(getWorkoutPlanTemplates).mockResolvedValue([]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(
      () =>
        useTrainingPrograms(
          path === 'playback' ? '' : 'athlete',
          path !== 'playback'
        ),
      { wrapper }
    );
    expect(
      queue(
        client.getQueryData<TrainingProgram[]>(
          trainingProgramKeys.list('athlete')
        )!
      )
    ).toEqual(['occurrence-1', 'occurrence-2', 'occurrence-3', 'occurrence-4']);
    if (path === 'playback') {
      void client
        .fetchQuery({
          queryKey: trainingProgramKeys.list('athlete'),
          queryFn: api.getTrainingPrograms,
        })
        .catch(() => {});
    }
    await waitFor(() => expect(resolveOld).toBeDefined());
    await act(async () => {
      if (path === 'link') {
        await result.current.outcome.mutateAsync({
          programId: 'program',
          sessionId: 'occurrence-3',
          input: {
            status: 'completed',
            workout: { type: 'preset', id: 'existing-workout' },
          },
        });
      } else {
        await result.current.complete.mutateAsync({
          programId: 'program',
          sessionId: 'occurrence-3',
          input: { entry_date: '2026-10-14' },
        });
      }
    });
    expect(
      queue(
        client.getQueryData<TrainingProgram[]>(
          trainingProgramKeys.list('athlete')
        )!
      )
    ).toEqual(['occurrence-1', 'occurrence-2', 'occurrence-4', 'occurrence-5']);
    await act(async () => {
      resolveOld([before, otherProgram]);
    });
    expect(
      queue(
        client.getQueryData<TrainingProgram[]>(
          trainingProgramKeys.list('athlete')
        )!
      )
    ).toEqual(['occurrence-1', 'occurrence-2', 'occurrence-4', 'occurrence-5']);
    expect(
      client.getQueryData<TrainingProgram[]>(
        trainingProgramKeys.list('athlete')
      )![1]
    ).toEqual(otherProgram);
    expect(client.getQueryData(trainingProgramKeys.list('other-user'))).toEqual(
      anotherUser
    );
    expect(
      client.getQueryData(trainingProgramKeys.detail('athlete', 'program'))
    ).toEqual(saved);
    unmount();
    client.clear();
  }
);
