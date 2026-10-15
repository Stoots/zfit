import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  CreatePresetSessionRequest,
  PresetSessionResponse,
} from '@workspace/shared';
import { useCreatePresetSessionMutation } from '@/hooks/Exercises/useExerciseEntries';
import { createPresetSession } from '@/api/Exercises/exerciseEntryService';
import { recordTrainingProgramOutcome } from '@/api/TrainingPrograms/trainingPrograms';
import { trainingProgramKeys } from '@/api/keys/exercises';

jest.mock('@/i18n', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));

jest.mock('@/api/Exercises/exerciseEntryService', () => ({
  createPresetSession: jest.fn(),
}));
jest.mock('@/api/TrainingPrograms/trainingPrograms', () => ({
  recordTrainingProgramOutcome: jest.fn(),
}));
jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);

const saved: PresetSessionResponse = {
  type: 'preset',
  id: 'diary-workout',
  name: 'Push',
  entry_date: '2026-10-15',
  workout_preset_id: null,
  description: null,
  notes: null,
  source: 'sparky',
  total_duration_minutes: 10,
  activity_details: [],
  exercises: [],
};
const payload: CreatePresetSessionRequest = {
  source: 'sparky',
  name: 'Push',
  entry_date: '2026-10-15',
  exercises: [],
};
const trainingProgram = {
  program_id: 'program',
  session_id: 'planned-session',
};

function setup() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  client.setQueryData(trainingProgramKeys.list('athlete'), []);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(createPresetSession).mockResolvedValue(saved);
});

it('records the exact Program session before invalidating the dashboard', async () => {
  const { client, wrapper } = setup();
  const onSessionSaved = jest.fn();
  const { result } = renderHook(
    () => useCreatePresetSessionMutation({ trainingProgram, onSessionSaved }),
    { wrapper }
  );
  await act(async () => {
    await result.current.mutateAsync(payload);
  });
  expect(onSessionSaved).toHaveBeenCalledWith(saved);
  expect(recordTrainingProgramOutcome).toHaveBeenCalledWith(
    'program',
    'planned-session',
    {
      status: 'completed',
      workout: { type: 'preset', id: saved.id },
    }
  );
  expect(
    client.getQueryState(trainingProgramKeys.list('athlete'))?.isInvalidated
  ).toBe(true);
});

it('retains the diary checkpoint and retries only the outcome after a failure or reload', async () => {
  jest
    .mocked(recordTrainingProgramOutcome)
    .mockRejectedValueOnce(new Error('offline'));
  const { wrapper } = setup();
  let checkpoint: PresetSessionResponse | undefined;
  const onSessionSaved = (session: PresetSessionResponse) => {
    checkpoint = session;
  };
  const first = renderHook(
    () => useCreatePresetSessionMutation({ trainingProgram, onSessionSaved }),
    { wrapper }
  );
  await act(async () => {
    await expect(first.result.current.mutateAsync(payload)).rejects.toThrow(
      'offline'
    );
  });
  expect(checkpoint).toEqual(saved);
  first.unmount();
  const retry = renderHook(
    () =>
      useCreatePresetSessionMutation({
        trainingProgram,
        savedSession: checkpoint,
        onSessionSaved,
      }),
    { wrapper }
  );
  await act(async () => {
    await retry.result.current.mutateAsync(payload);
  });
  expect(createPresetSession).toHaveBeenCalledTimes(1);
  expect(recordTrainingProgramOutcome).toHaveBeenCalledTimes(2);
});

it('does not record an outcome for standalone workouts', async () => {
  const { wrapper } = setup();
  const { result } = renderHook(() => useCreatePresetSessionMutation(), {
    wrapper,
  });
  await act(async () => {
    await result.current.mutateAsync(payload);
  });
  expect(createPresetSession).toHaveBeenCalledWith(payload);
  expect(recordTrainingProgramOutcome).not.toHaveBeenCalled();
});

it('does not complete a Program session if saving the diary workout fails', async () => {
  jest
    .mocked(createPresetSession)
    .mockRejectedValueOnce(new Error('save failed'));
  const { wrapper } = setup();
  const onSessionSaved = jest.fn();
  const { result } = renderHook(
    () => useCreatePresetSessionMutation({ trainingProgram, onSessionSaved }),
    { wrapper }
  );
  await act(async () => {
    await expect(result.current.mutateAsync(payload)).rejects.toThrow(
      'save failed'
    );
  });
  expect(onSessionSaved).not.toHaveBeenCalled();
  expect(recordTrainingProgramOutcome).not.toHaveBeenCalled();
});
