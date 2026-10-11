import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useWatchWorkoutStart } from '../../src/hooks/useWatchWorkoutStart';
import { fetchWorkoutPlanCandidates } from '../../src/services/api/workoutPlansApi';
import { getWorkoutPresetById } from '../../src/services/api/workoutPresetsApi';
import { getActiveServerConfigId } from '../../src/services/storage';
import { useActiveWorkoutStore } from '../../src/stores/activeWorkoutStore';
import type { StartLiveWorkoutArgs } from '../../src/hooks/useStartLiveWorkout';
import type { WorkoutPlanTemplate } from '../../src/types/workoutPlans';
import type { WorkoutPreset } from '../../src/types/workoutPresets';
import type { PresetSessionResponse } from '@workspace/shared';

let handler: ((p: { presetId: string; serverId: string }) => void) | null =
  null;
jest.mock('../../modules/watch-connectivity', () => ({
  __esModule: true,
  default: {
    isSupported: jest.fn(() => true),
    addListener: jest.fn((_e: string, cb: typeof handler) => {
      handler = cb;
      return { remove: jest.fn() };
    }),
  },
}));
jest.mock('../../src/services/storage', () => ({
  getActiveServerConfigId: jest.fn(),
}));
jest.mock('../../src/services/api/workoutPlansApi', () => ({
  fetchWorkoutPlanCandidates: jest.fn(),
}));
jest.mock('../../src/services/api/workoutPresetsApi', () => ({
  getWorkoutPresetById: jest.fn(),
}));

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const sets = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    set_number: index + 1,
    set_type: 'normal',
    reps: 8,
    weight: null,
    rest_time: 90,
    notes: '8 each side; RPE 7–8',
  }));
const preset = {
  id: 42,
  name: 'A',
  description: null,
  workout_format: 'standard',
  exercises: [
    { exercise_id: 'e1', exercise_name: 'Row', sort_order: 0, sets: sets(9) },
  ],
};
function session(id: string, assignmentId: number, count: number) {
  return {
    id,
    name: 'A',
    day_of_week: 1,
    sort_order: assignmentId,
    assignments: [
      {
        id: assignmentId,
        workout_session_id: id,
        workout_preset_id: 42,
        sort_order: 0,
        sets: [],
        preset_snapshot: {
          ...preset,
          exercises: [{ ...preset.exercises[0], sets: sets(count) }],
        },
      },
    ],
  };
}
const first = session(firstId, 7, 2);
const second = session(secondId, 8, 3);
const plan = {
  id: 'p1',
  plan_name: 'Plan',
  sessions: [first, second],
  next_session: first,
  next_assignments: first.assignments,
};
// API fixtures omit audit/display fields not consumed by this hook.
const plans = [plan] as unknown as WorkoutPlanTemplate[];
const libraryPreset = preset as unknown as WorkoutPreset;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getActiveServerConfigId).mockResolvedValue('srv');
  jest.mocked(getWorkoutPresetById).mockResolvedValue(libraryPreset);
  jest.mocked(fetchWorkoutPlanCandidates).mockResolvedValue(plans);
  useActiveWorkoutStore.setState({
    sessionId: null,
    session: null,
    sourcePresetId: null,
  });
});

it('starts exact same-label sessions from frozen 2x8 and 3x8 prescriptions, never the library', async () => {
  const start = jest.fn<Promise<void>, [StartLiveWorkoutArgs]>(async () => {});
  renderHook(() => useWatchWorkoutStart(true, true, start));
  handler?.({ presetId: `session:${firstId}`, serverId: 'srv' });
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  handler?.({ presetId: `session:${secondId}`, serverId: 'srv' });
  await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  const [a, b] = start.mock.calls.map(([args]) => args);
  expect(a!.exercises[0]!.sets).toHaveLength(2);
  expect(b!.exercises[0]!.sets).toHaveLength(3);
  for (const args of [a!, b!]) {
    expect(args.exercises[0]!.sets).toEqual(
      sets(args.exercises[0]!.sets.length).map((set) =>
        expect.objectContaining({
          ...set,
          duration: null,
          distance: null,
          completed_at: null,
        })
      )
    );
  }
  expect(a!.exercises[0]!.workout_plan_assignment_id).toBe(7);
  expect(b!.exercises[0]!.workout_plan_assignment_id).toBe(8);
  expect(a!.sourcePresetId).toBeUndefined();
  expect(getWorkoutPresetById).not.toHaveBeenCalled();
});

it('keeps numeric library starts unlinked even when the same preset is scheduled', async () => {
  const start = jest.fn<Promise<void>, [StartLiveWorkoutArgs]>(async () => {});
  renderHook(() => useWatchWorkoutStart(true, true, start));
  handler?.({ presetId: '42', serverId: 'srv' });
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({ sourcePresetId: 42 })
  );
  const args = start.mock.calls[0]![0];
  expect(args.workoutPlanAssignmentId).toBeUndefined();
  expect(args.exercises[0]!.workout_plan_assignment_id).toBeUndefined();
  expect(fetchWorkoutPlanCandidates).not.toHaveBeenCalled();
});

it('ignores delivery for the same exact live session but permits another using the same preset', async () => {
  // Partial live response supplies the identity fields read by the hook.
  const liveSession = {
    exercises: [{ workout_plan_assignment_id: 7 }],
  } as unknown as PresetSessionResponse;
  useActiveWorkoutStore.setState({
    sessionId: 'live',
    sourcePresetId: 42,
    session: liveSession,
  });
  const start = jest.fn<Promise<void>, [StartLiveWorkoutArgs]>(async () => {});
  renderHook(() => useWatchWorkoutStart(true, true, start));
  await act(async () => {
    handler?.({ presetId: `session:${firstId}`, serverId: 'srv' });
  });
  expect(start).not.toHaveBeenCalled();
  handler?.({ presetId: `session:${secondId}`, serverId: 'srv' });
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
});

it.each(['missing', 'snapshot'])(
  'never falls back when the exact session is %s',
  async (reason) => {
    // Deliberately invalid snapshot tests fail-closed execution.
    const invalidPlans = [
      {
        ...plan,
        sessions: [
          {
            ...first,
            assignments: [{ ...first.assignments[0], preset_snapshot: null }],
          },
        ],
      },
    ] as unknown as WorkoutPlanTemplate[];
    jest
      .mocked(fetchWorkoutPlanCandidates)
      .mockResolvedValue(reason === 'missing' ? [] : invalidPlans);
    const start = jest.fn<Promise<void>, [StartLiveWorkoutArgs]>(
      async () => {}
    );
    renderHook(() => useWatchWorkoutStart(true, true, start));
    await act(async () => {
      handler?.({ presetId: `session:${firstId}`, serverId: 'srv' });
    });
    expect(start).not.toHaveBeenCalled();
    expect(getWorkoutPresetById).not.toHaveBeenCalled();
  }
);

it('ignores a request after switching servers during the session fetch', async () => {
  jest.mocked(fetchWorkoutPlanCandidates).mockImplementation(async () => {
    jest.mocked(getActiveServerConfigId).mockResolvedValue('other');
    return plans;
  });
  const start = jest.fn<Promise<void>, [StartLiveWorkoutArgs]>(async () => {});
  renderHook(() => useWatchWorkoutStart(true, true, start));
  await act(async () => {
    handler?.({ presetId: `session:${firstId}`, serverId: 'srv' });
  });
  expect(start).not.toHaveBeenCalled();
});

it('queues an exact session token while offline and starts it on reconnect', async () => {
  const start = jest.fn<Promise<void>, [StartLiveWorkoutArgs]>(async () => {});
  const { rerender } = renderHook(
    ({ connected }) => useWatchWorkoutStart(true, connected, start),
    {
      initialProps: { connected: false },
    }
  );
  handler?.({ presetId: `session:${secondId}`, serverId: 'srv' });
  expect(start).not.toHaveBeenCalled();
  rerender({ connected: true });
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({
      exercises: [
        expect.objectContaining({
          workout_plan_assignment_id: 8,
          sets: sets(3).map((set) => expect.objectContaining(set)),
        }),
      ],
    })
  );
});

it('does not execute an exact request whose listener was disabled while loading', async () => {
  let release: (value: WorkoutPlanTemplate[]) => void = () => {};
  jest.mocked(fetchWorkoutPlanCandidates).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const start = jest.fn<Promise<void>, [StartLiveWorkoutArgs]>(async () => {});
  const { rerender } = renderHook(
    ({ enabled }) => useWatchWorkoutStart(enabled, true, start),
    {
      initialProps: { enabled: true },
    }
  );
  handler?.({ presetId: `session:${firstId}`, serverId: 'srv' });
  await waitFor(() => expect(fetchWorkoutPlanCandidates).toHaveBeenCalled());
  rerender({ enabled: false });
  rerender({ enabled: true });
  await act(async () => {
    release(plans);
  });
  expect(start).not.toHaveBeenCalled();
});
