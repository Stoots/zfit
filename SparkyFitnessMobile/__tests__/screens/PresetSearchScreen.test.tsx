import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import PresetSearchScreen from '../../src/screens/PresetSearchScreen';
import {
  useWorkoutPresets,
  useWorkoutPresetSearch,
  useProfile,
} from '../../src/hooks';
import {
  useAppPreferencesStore,
  __resetAppPreferencesStoreForTests,
} from '../../src/stores/appPreferencesStore';
import { useNavigationActionGuard } from '../../src/hooks/useNavigationActionGuard';
import { useScreenHeader } from '../../src/hooks/useScreenHeader';
import { useStartLiveWorkout } from '../../src/hooks/useStartLiveWorkout';
import { useWorkoutPlanCandidates } from '../../src/hooks/useActiveWorkoutPlan';
import type { WorkoutPlanTemplate } from '../../src/types/workoutPlans';
import type { TrainingProgram } from '@workspace/shared';
import {
  buildPresetLiveExerciseConfigs,
  buildPresetStartExercisesPayload,
  buildSingleExerciseStartPayload,
} from '../../src/utils/workoutSession';
import type { Exercise } from '../../src/types/exercise';
import type { WorkoutPreset } from '../../src/types/workoutPresets';

jest.mock('../../src/hooks', () => ({
  useWorkoutPresets: jest.fn(),
  useWorkoutPresetSearch: jest.fn(),
  useDailySummary: jest.fn(() => ({
    summary: { exerciseEntries: [] },
    isLoading: false,
  })),
  useRefetchOnFocus: jest.fn(),
  useProfile: jest.fn(() => ({ profile: undefined, isLoading: false })),
}));

jest.mock('../../src/hooks/useNavigationActionGuard', () => ({
  useNavigationActionGuard: jest.fn(),
}));

jest.mock('../../src/hooks/useExerciseImageSource', () => ({
  useExerciseImageSource: jest.fn(() => ({
    getImageSource: jest.fn((path: string) => ({ uri: path, headers: {} })),
  })),
}));

jest.mock('../../src/hooks/useScreenHeader', () => ({
  useScreenHeader: jest.fn(() => null),
}));

jest.mock('../../src/hooks/useStartLiveWorkout', () => ({
  useStartLiveWorkout: jest.fn(),
}));

jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  useActiveWorkoutBarPadding: jest.fn(() => 0),
}));

jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSHeadersActive: jest.fn(() => false),
}));

jest.mock('../../src/hooks/useActiveWorkoutPlan', () => ({
  useWorkoutPlanCandidates: jest.fn(() => ({
    plans: [],
    programs: [],
    isLoading: false,
  })),
}));

const mockUseWorkoutPresets = useWorkoutPresets as jest.MockedFunction<
  typeof useWorkoutPresets
>;
const mockUseProfile = useProfile as jest.MockedFunction<typeof useProfile>;
const mockUseNavigationActionGuard =
  useNavigationActionGuard as jest.MockedFunction<
    typeof useNavigationActionGuard
  >;
const mockUseWorkoutPresetSearch =
  useWorkoutPresetSearch as jest.MockedFunction<typeof useWorkoutPresetSearch>;
const mockUseScreenHeader = useScreenHeader as jest.MockedFunction<
  typeof useScreenHeader
>;
const mockUseStartLiveWorkout = useStartLiveWorkout as jest.MockedFunction<
  typeof useStartLiveWorkout
>;

const insets = { top: 0, bottom: 0, left: 0, right: 0 };
const frame = { x: 0, y: 0, width: 390, height: 844 };

function buildPreset(overrides: Partial<WorkoutPreset> = {}): WorkoutPreset {
  return {
    id: 7,
    user_id: 'user-1',
    name: 'Push Day',
    description: null,
    is_public: false,
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-01T00:00:00.000Z',
    exercises: [
      {
        id: 'pe-1',
        exercise_id: 'ex-1',
        exercise_name: 'Bench Press',
        image_url: null,
        sets: [],
      },
    ],
    ...overrides,
  };
}

function buildExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex-9',
    name: 'Squat',
    category: 'Strength',
    images: [],
    ...overrides,
  } as Exercise;
}

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  replace: jest.fn(),
  isFocused: jest.fn(() => true),
  setOptions: jest.fn(),
} as any;

type RouteParams =
  { selectedExercise?: Exercise; selectionNonce?: number } | undefined;

function makeRoute(params?: RouteParams) {
  return { key: 'PresetSearch-key', name: 'PresetSearch' as const, params };
}

function renderScreen(params?: RouteParams) {
  return render(
    <SafeAreaProvider initialMetrics={{ insets, frame }}>
      <PresetSearchScreen navigation={navigation} route={makeRoute(params)} />
    </SafeAreaProvider>
  );
}

/**
 * useScreenHeader is mocked out, so drive the ownership filter through the
 * menu descriptor the screen passed to it (Show section → option onPress).
 */
function pressHeaderFilterOption(label: string) {
  const config = mockUseScreenHeader.mock.calls.at(-1)?.[0] as {
    right?: { items?: { items?: { label: string; onPress: () => void }[] }[] };
  };
  const option = config?.right?.items?.[0]?.items?.find(
    (item) => item.label === label
  );
  if (!option) {
    throw new Error(
      `pressHeaderFilterOption: no filter option labelled "${label}"`
    );
  }
  act(() => {
    option.onPress();
  });
}

describe('PresetSearchScreen', () => {
  const startLiveWorkout = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useWorkoutPlanCandidates).mockReturnValue({
      plans: [],
      programs: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    __resetAppPreferencesStoreForTests();
    mockUseProfile.mockReturnValue({
      profile: { id: 'user-1' },
      isLoading: false,
    } as any);
    mockUseWorkoutPresets.mockReturnValue({
      presets: [buildPreset()],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as any);
    mockUseWorkoutPresetSearch.mockReturnValue({
      searchResults: [],
      isSearching: false,
      isSearchActive: false,
      isSearchError: false,
    } as any);
    mockUseStartLiveWorkout.mockReturnValue({
      startLiveWorkout,
      isStarting: false,
    });
    mockUseNavigationActionGuard.mockReturnValue({
      isNavigationLocked: false,
      runNavigationAction: (action: () => void) => action(),
    } as any);
  });

  it('titles the header "Start Workout" and renders the pinned empty-workout row', () => {
    const screen = renderScreen();

    expect(mockUseScreenHeader).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Start Workout' })
    );
    expect(screen.getByText('Empty workout')).toBeTruthy();
    expect(screen.getByText('Pick your first exercise')).toBeTruthy();
  });

  it('persists an ownership filter chosen from the header menu and filters the list', () => {
    mockUseWorkoutPresets.mockReturnValue({
      presets: [
        buildPreset(),
        buildPreset({
          id: 8,
          name: 'Community Pull',
          user_id: 'user-2',
          is_public: true,
        }),
      ],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as any);

    const screen = renderScreen();
    expect(screen.getByText('Community Pull')).toBeTruthy();

    pressHeaderFilterOption('Mine');

    expect(useAppPreferencesStore.getState().presetSearchOwnershipFilter).toBe(
      'mine'
    );
    expect(screen.getByText('Push Day')).toBeTruthy();
    expect(screen.queryByText('Community Pull')).toBeNull();
  });

  it('names the filter and offers Show All when it empties the list', () => {
    useAppPreferencesStore.setState({ presetSearchOwnershipFilter: 'public' });

    const screen = renderScreen();

    expect(screen.getByText('No presets in Public')).toBeTruthy();

    fireEvent.press(screen.getByText('Show All'));

    expect(useAppPreferencesStore.getState().presetSearchOwnershipFilter).toBe(
      'all'
    );
    expect(screen.getByText('Push Day')).toBeTruthy();
  });

  it('starts a live workout from a tapped preset with the preset-built payload and source link', () => {
    const preset = buildPreset();
    const screen = renderScreen();

    fireEvent.press(screen.getByText('Push Day'));

    expect(startLiveWorkout).toHaveBeenCalledWith({
      name: 'Push Day',
      exercises: buildPresetStartExercisesPayload(preset),
      exerciseConfigs: buildPresetLiveExerciseConfigs(preset),
      sourcePresetId: 7,
      workoutFormat: 'standard',
      timeCapSeconds: null,
    });
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('starts only the fixed earliest Program session from its snapshot', () => {
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    const sessions = ids.map((id, index) => ({
      id,
      name: 'A',
      day_of_week: 1,
      sort_order: index,
      assignments: [
        {
          id: index + 11,
          workout_session_id: id,
          workout_preset_id: 7,
          sort_order: 0,
          sets: [],
          preset_snapshot: {
            ...buildPreset(),
            exercises: [
              {
                ...buildPreset().exercises[0],
                sets: Array.from({ length: index + 2 }, (_, setIndex) => ({
                  set_number: setIndex + 1,
                  set_type: 'normal',
                  reps: 8,
                  weight: null,
                  rest_time: 90,
                  notes: '8 each side; RPE 7–8',
                })),
              },
            ],
          },
        },
      ],
    }));
    // Partial API fixture excludes audit fields not read by this screen.
    const plan = {
      id: 1,
      plan_name: 'Training',
      is_active: false,
      schedule_type: 'weekly',
      sessions,
      next_session: sessions[0],
      next_assignments: sessions.flatMap((session) => session.assignments),
    } as unknown as WorkoutPlanTemplate;
    const programs = [
      {
        phases: [
          {
            weeks: [
              {
                sessions: ids.map((workout_session_id, index) => ({
                  workout_plan_id: 1,
                  workout_session_id,
                  effective_date: '2026-10-12',
                  status: 'planned',
                  sort_order: index,
                })),
              },
            ],
          },
        ],
      },
    ] as unknown as TrainingProgram[];
    jest.mocked(useWorkoutPlanCandidates).mockReturnValue({
      plans: [plan],
      programs,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId(`scheduled-session-${ids[0]}`));
    expect(startLiveWorkout).toHaveBeenCalledTimes(1);
    const call = startLiveWorkout.mock.calls[0]![0];
    expect(call.exercises[0].sets).toHaveLength(2);
    expect(call.exercises[0].workout_plan_assignment_id).toBe(11);
    expect(call.exercises[0].sets[0]).toEqual(
      expect.objectContaining({
        reps: 8,
        weight: null,
        rest_time: 90,
        notes: '8 each side; RPE 7–8',
      })
    );
    expect(call.sourcePresetId).toBeUndefined();
    expect(screen.queryByText('Suggested')).toBeNull();
    expect(screen.queryByTestId(`scheduled-session-${ids[1]}`)).toBeNull();
    fireEvent.press(screen.getByText('Push Day'));
    expect(startLiveWorkout).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourcePresetId: 7 })
    );
    expect(
      startLiveWorkout.mock.calls[1]![0].workoutPlanAssignmentId
    ).toBeUndefined();
  });

  it('opens the preset preview from the thumbnail without starting', () => {
    const screen = renderScreen();

    fireEvent.press(screen.getByTestId('preset-thumbnail'));

    expect(navigation.navigate).toHaveBeenCalledWith('WorkoutPresetDetail', {
      preset: expect.objectContaining({ id: 7 }),
    });
    expect(startLiveWorkout).not.toHaveBeenCalled();
  });

  it('opens the preset preview from the info button without starting', () => {
    const screen = renderScreen();

    fireEvent.press(screen.getByLabelText('View preset details'));

    expect(navigation.navigate).toHaveBeenCalledWith('WorkoutPresetDetail', {
      preset: expect.objectContaining({ id: 7 }),
    });
    expect(startLiveWorkout).not.toHaveBeenCalled();
  });

  it('does not open the preview while navigation is locked', () => {
    mockUseNavigationActionGuard.mockReturnValue({
      isNavigationLocked: true,
      runNavigationAction: jest.fn(),
    } as any);
    const screen = renderScreen();

    fireEvent.press(screen.getByTestId('preset-thumbnail'));
    fireEvent.press(screen.getByLabelText('View preset details'));

    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('routes the empty-workout row to ExerciseSearch with this screen as return target', () => {
    const screen = renderScreen();

    fireEvent.press(screen.getByText('Empty workout'));

    expect(navigation.navigate).toHaveBeenCalledWith('ExerciseSearch', {
      returnKey: 'PresetSearch-key',
    });
    expect(startLiveWorkout).not.toHaveBeenCalled();
  });

  it('starts a single-exercise workout when ExerciseSearch returns a pick', () => {
    const exercise = buildExercise();
    const screen = renderScreen();

    screen.rerender(
      <SafeAreaProvider initialMetrics={{ insets, frame }}>
        <PresetSearchScreen
          navigation={navigation}
          route={makeRoute({ selectedExercise: exercise, selectionNonce: 1 })}
        />
      </SafeAreaProvider>
    );

    expect(startLiveWorkout).toHaveBeenCalledTimes(1);
    expect(startLiveWorkout).toHaveBeenCalledWith({
      exercises: buildSingleExerciseStartPayload(exercise),
    });
  });

  it('does not re-fire the start for the same selection nonce', () => {
    const exercise = buildExercise();
    const screen = renderScreen({
      selectedExercise: exercise,
      selectionNonce: 1,
    });

    expect(startLiveWorkout).toHaveBeenCalledTimes(1);

    screen.rerender(
      <SafeAreaProvider initialMetrics={{ insets, frame }}>
        <PresetSearchScreen
          navigation={navigation}
          route={makeRoute({ selectedExercise: exercise, selectionNonce: 1 })}
        />
      </SafeAreaProvider>
    );

    expect(startLiveWorkout).toHaveBeenCalledTimes(1);
  });

  it('disables preset rows and the empty row while a start is in flight', () => {
    mockUseStartLiveWorkout.mockReturnValue({
      startLiveWorkout,
      isStarting: true,
    });
    const screen = renderScreen();

    fireEvent.press(screen.getByText('Push Day'));
    fireEvent.press(screen.getByText('Empty workout'));

    expect(startLiveWorkout).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});
