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

it.each([
  ['complete', 'planned'],
  ['outcome', 'planned'],
  ['complete', 'omitted'],
] as const)(
  '%s keeps both completions when the earlier response arrives last with a %s session',
  async (path, earlierStatus) => {
    jest.clearAllMocks();
    const before = program();
    const earlier = program();
    earlier.phases[0]!.weeks[0]!.sessions[0]!.status = 'completed';
    earlier.phases[0]!.weeks[0]!.sessions[1]!.status = earlierStatus;
    const later = program();
    later.phases[0]!.weeks[0]!.sessions[0]!.status = 'completed';
    later.phases[0]!.weeks[0]!.sessions[1]!.status = 'completed';
    if (earlierStatus === 'omitted') {
      for (const snapshot of [before, earlier, later]) {
        snapshot.phases[0]!.weeks[0]!.sessions[1]!.is_optional = true;
      }
    }
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const listKey = trainingProgramKeys.list('athlete');
    const detailKey = trainingProgramKeys.detail('athlete', 'program');
    client.setQueryData(listKey, [before]);
    client.setQueryData(detailKey, before);
    let resolveEarlier!: (value: TrainingProgram) => void;
    let resolveLater!: (value: TrainingProgram) => void;
    const mutation =
      path === 'complete'
        ? jest.mocked(api.completeTrainingProgramSession)
        : jest.mocked(api.recordTrainingProgramOutcome);
    mutation
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveEarlier = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLater = resolve;
          })
      );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(
      () => useTrainingPrograms('', false),
      { wrapper }
    );
    const complete = (sessionId: string) =>
      path === 'complete'
        ? result.current.complete.mutateAsync({
            programId: 'program',
            sessionId,
            input: { entry_date: '2026-10-14' },
          })
        : result.current.outcome.mutateAsync({
            programId: 'program',
            sessionId,
            input: {
              status: 'completed',
              workout: { type: 'preset', id: sessionId },
            },
          });
    let first!: Promise<TrainingProgram>;
    let second!: Promise<TrainingProgram>;
    act(() => {
      first = complete('occurrence-1');
      second = complete('occurrence-2');
    });
    await waitFor(() => expect(resolveLater).toBeDefined());
    await act(async () => {
      resolveLater(later);
      await second;
    });
    await act(async () => {
      resolveEarlier(earlier);
      await first;
    });
    expect(queue(client.getQueryData<TrainingProgram[]>(listKey)!)).toEqual([
      'occurrence-3',
      'occurrence-4',
      'occurrence-5',
      'occurrence-6',
    ]);
    expect(client.getQueryData<TrainingProgram>(detailKey)).toEqual(later);
    unmount();
    client.clear();
  }
);

it.each(['completed', 'missed', 'omitted'] as const)(
  'preserves another %s session but accepts a reset for the response session and an edited Program',
  async (status) => {
    jest.clearAllMocks();
    const cached = program();
    cached.phases[0]!.weeks[0]!.sessions[0]!.status = status;
    cached.phases[0]!.weeks[0]!.sessions[1]!.status = status;
    const saved = program();
    const client = new QueryClient();
    const listKey = trainingProgramKeys.list('athlete');
    const detailKey = trainingProgramKeys.detail('athlete', 'program');
    client.setQueryData(listKey, [cached]);
    client.setQueryData(detailKey, cached);
    jest.mocked(api.recordTrainingProgramOutcome).mockResolvedValue(saved);
    jest.mocked(api.saveTrainingProgram).mockResolvedValue(saved);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(
      () => useTrainingPrograms('athlete', false),
      { wrapper }
    );
    await act(async () => {
      await result.current.outcome.mutateAsync({
        programId: 'program',
        sessionId: 'occurrence-1',
        input: { status: 'missed' },
      });
    });
    const expected = program();
    expected.phases[0]!.weeks[0]!.sessions[1]!.status = status;
    expect(client.getQueryData(listKey)).toEqual([expected]);
    expect(client.getQueryData(detailKey)).toEqual(expected);
    await act(async () => {
      await result.current.save.mutateAsync({ id: 'program', input: saved });
    });
    expect(client.getQueryData(detailKey)).toEqual(saved);
    unmount();
    client.clear();
  }
);
