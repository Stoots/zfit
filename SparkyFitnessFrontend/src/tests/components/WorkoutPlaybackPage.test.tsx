import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorkoutPlaybackPage from '@/pages/Diary/WorkoutPlaybackPage';
import { HttpApiError } from '@/api/api';
import type { WorkoutPreset } from '@/types/workout';
import {
  buildPresetSessionCreateRequestFromDraft,
  createWorkoutPlaybackDraftFromPreset,
  createWorkoutPlaybackRouteState,
  loadWorkoutPlaybackDraftFromStorage as loadStoredDraft,
  saveWorkoutPlaybackDraftToStorage as saveStoredDraft,
} from '@/utils/workoutPlayback';

let mockUser = { id: 'user-1', activeUserId: 'user-1' };
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mockUser }) }));

const storageIdentity = { userId: 'user-1', activeUserId: 'user-1' };
const loadWorkoutPlaybackDraftFromStorage = (date: string) =>
  loadStoredDraft(date, storageIdentity);
const saveWorkoutPlaybackDraftToStorage = (
  draft: Parameters<typeof saveStoredDraft>[0]
) => saveStoredDraft(draft, storageIdentity);

const mockNavigate = jest.fn();
const mockCreatePresetSession = jest.fn();
const mockCompleteProgramSession = jest.fn();
const mockGetGroupedWorkoutSession = jest.fn();
const mockSearchParams = new URLSearchParams('date=2026-04-27');
let mockDistanceUnit: 'km' | 'miles' = 'km';
let mockLocationState: { returnTo?: string; draft?: unknown } | null = null;

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({
    state: mockLocationState
      ? {
          identity: { userId: 'user-1', activeUserId: 'user-1' },
          ...mockLocationState,
        }
      : null,
  }),
  useSearchParams: () => [mockSearchParams],
}));

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    weightUnit: 'kg',
    distanceUnit: mockDistanceUnit,
    timezone: 'UTC',
    energyUnit: 'kcal',
    convertEnergy: (value: number) => value,
    getEnergyUnitString: () => 'kcal',
  }),
}));

jest.mock('@/hooks/Exercises/useExerciseEntries', () => ({
  getGroupedWorkoutSession: (...args: unknown[]) =>
    mockGetGroupedWorkoutSession(...args),
  useCreatePresetSessionMutation: () => ({
    mutateAsync: (...args: unknown[]) => mockCreatePresetSession(...args),
    isPending: false,
  }),
  useWorkoutLocations: () => ({ data: ['Home Gym', 'Downtown'] }),
  fetchExerciseProgressionStats: jest.fn(async () => null),
}));

jest.mock('@/hooks/TrainingPrograms/useTrainingPrograms', () => ({
  useTrainingPrograms: () => ({
    complete: {
      mutateAsync: (...args: unknown[]) => mockCompleteProgramSession(...args),
      isPending: false,
    },
  }),
}));

jest.mock('@/hooks/Exercises/useWorkoutCoaching', () => ({
  useWorkoutSessionFeedback: () => ({ isLoading: true }),
  fetchWorkoutCoachingSignals: jest.fn(async () => ({
    adaptive_suggestions: false,
    signals: [],
  })),
}));

const presetFixture: WorkoutPreset = {
  id: 'preset-1',
  user_id: 'user-1',
  name: 'Upper Body',
  description: 'Push + Pull',
  exercises: [
    {
      exercise_id: 'exercise-1',
      exercise_name: 'Bench Press',
      sets: [{ set_number: 1, reps: 8, weight: 80, rest_time: 90 }],
    },
    {
      exercise_id: 'exercise-2',
      exercise_name: 'Barbell Row',
      sets: [{ set_number: 1, reps: 10, weight: 60, rest_time: 90 }],
    },
  ],
} as unknown as WorkoutPreset;

describe('WorkoutPlaybackPage', () => {
  beforeEach(() => {
    mockUser = { id: 'user-1', activeUserId: 'user-1' };
    mockDistanceUnit = 'km';
    mockNavigate.mockReset();
    mockCreatePresetSession.mockReset();
    mockCompleteProgramSession.mockReset();
    mockGetGroupedWorkoutSession
      .mockReset()
      .mockResolvedValue({ id: 'diary-1', exercises: [] });
    window.localStorage.clear();
    mockLocationState = { returnTo: '/?date=2026-04-27' };
  });

  it.each([
    { id: 'user-2', activeUserId: 'user-2' },
    { id: 'user-1', activeUserId: 'family-1' },
  ])('resets the player when identity changes to %j', (nextUser) => {
    mockLocationState = createWorkoutPlaybackRouteState(
      presetFixture,
      '2026-04-27',
      { userId: 'user-1', activeUserId: 'user-1' }
    );
    const view = render(<WorkoutPlaybackPage />);
    fireEvent.change(document.getElementById('set-weight-0-0')!, {
      target: { value: '92.5' },
    });
    fireEvent.blur(document.getElementById('set-weight-0-0')!);
    mockUser = nextUser;
    view.rerender(<WorkoutPlaybackPage />);
    expect(document.getElementById('set-weight-0-0')).not.toBeInTheDocument();
    expect(mockCreatePresetSession).not.toHaveBeenCalled();
    expect(mockCompleteProgramSession).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'user-2', activeUserId: 'user-2' },
    { id: 'user-1', activeUserId: 'family-1' },
  ])(
    'restores only the current identity draft after switching to %j',
    (nextUser) => {
      const own = createWorkoutPlaybackDraftFromPreset(
        presetFixture,
        '2026-04-27'
      );
      own.load_adjustments_applied = true;
      own.exercises[0]!.sets[0]!.weight = 92.5;
      saveWorkoutPlaybackDraftToStorage(own);
      saveStoredDraft(
        { ...own, name: 'Other workout' },
        { userId: nextUser.id, activeUserId: nextUser.activeUserId }
      );
      mockLocationState = null;
      const view = render(<WorkoutPlaybackPage />);
      expect(screen.getByText('Upper Body')).toBeInTheDocument();
      mockUser = nextUser;
      view.rerender(<WorkoutPlaybackPage />);
      expect(screen.getByText('Other workout')).toBeInTheDocument();
      expect(screen.queryByText('Upper Body')).not.toBeInTheDocument();
      mockUser = { id: 'user-1', activeUserId: 'user-1' };
      view.rerender(<WorkoutPlaybackPage />);
      expect(screen.getByText('Upper Body')).toBeInTheDocument();
      expect(document.getElementById('set-weight-0-0')).toHaveValue(92.5);
      expect(loadWorkoutPlaybackDraftFromStorage('2026-04-27')?.name).toBe(
        'Upper Body'
      );
    }
  );

  it('rejects another identity’s route draft even on a fresh mount', () => {
    mockLocationState = createWorkoutPlaybackRouteState(
      presetFixture,
      '2026-04-27',
      storageIdentity
    );
    mockUser = { id: 'user-2', activeUserId: 'user-2' };
    render(<WorkoutPlaybackPage />);
    expect(document.getElementById('set-weight-0-0')).not.toBeInTheDocument();
    expect(screen.queryByText('Upper Body')).not.toBeInTheDocument();
    expect(
      loadStoredDraft('2026-04-27', {
        userId: 'user-2',
        activeUserId: 'user-2',
      })
    ).toBeNull();
  });

  it('keeps the originating return path after removing the draft from history', () => {
    mockLocationState = createWorkoutPlaybackRouteState(
      presetFixture,
      '2026-04-27',
      storageIdentity,
      '/training-programs?program=one'
    );
    const view = render(<WorkoutPlaybackPage />);
    const scrub = mockNavigate.mock.calls.find((call) => call[1]?.replace);
    expect(scrub?.[1].state).toEqual({
      returnTo: '/training-programs?program=one',
      identity: storageIdentity,
    });
    mockLocationState = scrub![1].state;
    view.rerender(<WorkoutPlaybackPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(mockNavigate).toHaveBeenLastCalledWith(
      '/training-programs?program=one'
    );
  });

  it('starts the new exact Workout Session after a planned occurrence is rebound', () => {
    const stored = createWorkoutPlaybackDraftFromPreset(
      {
        ...presetFixture,
        workout_session_id: 'old-workout-session',
        training_program: { program_id: 'program-1', session_id: 'planned-1' },
      },
      '2026-04-27'
    );
    stored.exercises[0]!.sets[0]!.weight = 92.5;
    stored.load_adjustments_applied = true;
    saveWorkoutPlaybackDraftToStorage(stored);
    mockLocationState = createWorkoutPlaybackRouteState(
      {
        ...presetFixture,
        workout_session_id: 'new-workout-session',
        training_program: { program_id: 'program-1', session_id: 'planned-1' },
      },
      '2026-04-27',
      { userId: 'user-1', activeUserId: 'user-1' }
    );
    render(<WorkoutPlaybackPage />);
    expect(document.getElementById('set-weight-0-0')).toHaveValue(80);
  });

  it('blocks active edits and set logging across remount while recovery is pending', () => {
    const stored = createWorkoutPlaybackDraftFromPreset(
      { ...presetFixture, workout_session_id: 'old-workout-session' },
      '2026-04-27'
    );
    stored.exercises[0]!.sets[0]!.weight = 92.5;
    stored.exercises[0]!.sets[0]!.completed = true;
    saveWorkoutPlaybackDraftToStorage(stored);
    mockLocationState = createWorkoutPlaybackRouteState(
      { ...presetFixture, workout_session_id: 'new-workout-session' },
      '2026-04-27',
      { userId: 'user-1', activeUserId: 'user-1' }
    );
    const view = render(<WorkoutPlaybackPage />);
    const weight = document.getElementById('set-weight-0-0')!;
    fireEvent.change(screen.getByLabelText('Gym / Location'), {
      target: { value: 'Unsaved location' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
    expect(screen.getByRole('button', { name: 'Log set' })).toBeDisabled();
    expect(weight).toBeDisabled();
    expect(weight).toHaveValue(80);
    expect(screen.getByLabelText('Gym / Location')).toBeDisabled();
    expect(screen.getByLabelText('Gym / Location')).toHaveValue('');
    expect(screen.getByText('0/2')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toBeDisabled();
    expect(screen.getByLabelText('Start Time')).toBeDisabled();
    expect(loadWorkoutPlaybackDraftFromStorage('2026-04-27')).toEqual(stored);
    view.unmount();
    render(<WorkoutPlaybackPage />);
    expect(screen.getByRole('button', { name: 'Log set' })).toBeDisabled();
    expect(document.getElementById('set-weight-0-0')).toHaveValue(80);
    expect(
      screen.getByText(/resolve the saved workout first/i)
    ).toBeInTheDocument();
    expect(loadWorkoutPlaybackDraftFromStorage('2026-04-27')).toEqual(stored);
    expect(mockCreatePresetSession).not.toHaveBeenCalled();
    expect(mockCompleteProgramSession).not.toHaveBeenCalled();
  });

  it.each(['save', 'discard'])(
    'preserves an incompatible draft until explicit %s recovery',
    async (action) => {
      const stored = createWorkoutPlaybackDraftFromPreset(
        {
          ...presetFixture,
          workout_session_id: 'old-workout-session',
          training_program: {
            program_id: 'program-1',
            session_id: 'planned-1',
          },
        },
        '2026-04-27'
      );
      stored.exercises[0]!.sets[0]!.weight = 92.5;
      stored.exercises[0]!.sets[0]!.completed = true;
      stored.exercises[0]!.workout_plan_assignment_id = 17;
      saveWorkoutPlaybackDraftToStorage(stored);
      mockLocationState = createWorkoutPlaybackRouteState(
        {
          ...presetFixture,
          workout_session_id: 'new-workout-session',
          training_program: {
            program_id: 'program-1',
            session_id: 'planned-1',
          },
        },
        '2026-04-27',
        { userId: 'user-1', activeUserId: 'user-1' }
      );
      mockCreatePresetSession.mockResolvedValue({
        id: 'separate-1',
        exercises: [],
      });
      render(<WorkoutPlaybackPage />);
      expect(
        screen.getByText(/Another workout draft is saved/)
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Finish Workout' })
      ).toBeDisabled();
      expect(loadWorkoutPlaybackDraftFromStorage('2026-04-27')).toEqual(stored);
      if (action === 'save') {
        fireEvent.click(
          screen.getByRole('button', { name: 'Save as a separate workout' })
        );
        await waitFor(() =>
          expect(mockCreatePresetSession).toHaveBeenCalledWith(
            expect.objectContaining({
              workoutPlanAssignmentId: null,
              exercises: [
                expect.objectContaining({
                  workout_plan_assignment_id: null,
                  sets: [expect.objectContaining({ weight: 92.5 })],
                }),
              ],
            })
          )
        );
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
        fireEvent.click(
          screen.getAllByRole('button', { name: 'Discard' }).at(-1)!
        );
        expect(mockCreatePresetSession).not.toHaveBeenCalled();
      }
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Finish Workout' })
        ).toBeEnabled()
      );
      expect(
        loadWorkoutPlaybackDraftFromStorage('2026-04-27')?.workout_session_id
      ).toBe('new-workout-session');
      expect(document.getElementById('set-weight-0-0')).toHaveValue(80);
      expect(mockCompleteProgramSession).not.toHaveBeenCalled();
      expect(document.getElementById('set-weight-0-0')).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
      expect(
        loadWorkoutPlaybackDraftFromStorage('2026-04-27')?.exercises[0]?.sets[0]
      ).toMatchObject({ completed: true, weight: 80 });
    }
  );

  it('resumes logged Program sets when Start Workout is used again from the Dashboard', async () => {
    const preset = {
      ...presetFixture,
      workout_session_id: 'workout-session-1',
      training_program: { program_id: 'program-1', session_id: 'planned-1' },
    };
    mockLocationState = createWorkoutPlaybackRouteState(preset, '2026-04-27', {
      userId: 'user-1',
      activeUserId: 'user-1',
    });
    const view = render(<WorkoutPlaybackPage />);
    fireEvent.change(document.getElementById('set-weight-0-0')!, {
      target: { value: '92.5' },
    });
    fireEvent.blur(document.getElementById('set-weight-0-0')!);
    fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
    await waitFor(() => {
      expect(
        loadWorkoutPlaybackDraftFromStorage('2026-04-27')?.exercises[0]?.sets[0]
      ).toMatchObject({ completed: true, weight: 92.5 });
    });
    expect(mockCompleteProgramSession).not.toHaveBeenCalled();
    expect(mockCreatePresetSession).not.toHaveBeenCalled();
    view.unmount();
    mockLocationState = createWorkoutPlaybackRouteState(preset, '2026-04-27', {
      userId: 'user-1',
      activeUserId: 'user-1',
    });
    render(<WorkoutPlaybackPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Finish Workout' }));
    await waitFor(() =>
      expect(mockCompleteProgramSession).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            performed_exercises: [
              expect.objectContaining({
                exercise_id: 'exercise-1',
                sets: [expect.objectContaining({ weight: 92.5 })],
              }),
            ],
          }),
        })
      )
    );
  });

  it('keeps a just-logged weighted set when the player closes before the save delay', () => {
    mockLocationState = createWorkoutPlaybackRouteState(
      {
        ...presetFixture,
        training_program: { program_id: 'program-1', session_id: 'planned-1' },
      },
      '2026-04-27',
      { userId: 'user-1', activeUserId: 'user-1' }
    );
    const view = render(<WorkoutPlaybackPage />);
    const weight = document.getElementById('set-weight-0-0')!;
    fireEvent.change(weight, { target: { value: '92.5' } });
    fireEvent.blur(weight);
    fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
    view.unmount();
    expect(
      loadWorkoutPlaybackDraftFromStorage('2026-04-27')?.exercises[0]?.sets[0]
    ).toMatchObject({ completed: true, weight: 92.5 });
    expect(mockCompleteProgramSession).not.toHaveBeenCalled();
  });

  it('shows a warning when local draft persistence fails', () => {
    mockLocationState = createWorkoutPlaybackRouteState(
      presetFixture,
      '2026-04-27',
      { userId: 'user-1', activeUserId: 'user-1' }
    );
    const storage = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('Storage full', 'QuotaExceededError');
      });
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<WorkoutPlaybackPage />);
      expect(
        screen.getByText(/Could not save your local workout progress/)
      ).toBeInTheDocument();
    } finally {
      storage.mockRestore();
      log.mockRestore();
    }
  });

  it.each([
    { program_id: 'program-1', session_id: 'planned-2' },
    { program_id: 'program-2', session_id: 'planned-1' },
    undefined,
  ])(
    'does not restore a different Program occurrence into %j',
    (training_program) => {
      const stored = createWorkoutPlaybackDraftFromPreset(
        presetFixture,
        '2026-04-27'
      );
      stored.training_program = {
        program_id: 'program-1',
        session_id: 'planned-1',
      };
      stored.exercises[0]!.sets[0]!.weight = 92.5;
      saveWorkoutPlaybackDraftToStorage(stored);
      mockLocationState = createWorkoutPlaybackRouteState(
        { ...presetFixture, training_program },
        '2026-04-27',
        { userId: 'user-1', activeUserId: 'user-1' }
      );
      render(<WorkoutPlaybackPage />);
      expect(document.getElementById('set-weight-0-0')).toHaveValue(80);
    }
  );

  it('finishes a Program draft through one atomic completion request', async () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    draft.training_program = {
      program_id: 'program-1',
      session_id: 'planned-1',
    };
    draft.exercises[0]!.workout_plan_assignment_id = 17;
    draft.exercises[0]!.sets[0]!.completed = true;
    draft.exercises[0]!.sets[0]!.completed_at = '2026-04-27T10:00:00.000Z';
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };
    mockCompleteProgramSession.mockResolvedValue({
      phases: [
        {
          weeks: [
            {
              sessions: [
                { id: 'planned-1', completed_workout: { id: 'diary-1' } },
              ],
            },
          ],
        },
      ],
    });
    render(<WorkoutPlaybackPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Finish Workout' }));
    await waitFor(() =>
      expect(mockCompleteProgramSession).toHaveBeenCalledWith({
        programId: 'program-1',
        sessionId: 'planned-1',
        input: {
          entry_date: '2026-04-27',
          performed_exercises: [
            expect.objectContaining({
              exercise_id: 'exercise-1',
              workout_plan_assignment_id: 17,
              sets: [
                expect.objectContaining({
                  reps: 8,
                  completed_at: '2026-04-27T10:00:00.000Z',
                }),
              ],
            }),
          ],
        },
      })
    );
    expect(mockCreatePresetSession).not.toHaveBeenCalled();
  });

  it('hides exercise replacement for Program drafts but keeps it for standalone workouts', () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    draft.training_program = {
      program_id: 'program-1',
      session_id: 'planned-1',
    };
    mockLocationState = { draft };
    const view = render(<WorkoutPlaybackPage />);
    expect(
      screen.queryByRole('button', { name: 'Replace Bench Press' })
    ).not.toBeInTheDocument();

    view.unmount();
    delete draft.training_program;
    mockLocationState = { draft };
    render(<WorkoutPlaybackPage />);
    expect(
      screen.getByRole('button', { name: 'Replace Bench Press' })
    ).toBeInTheDocument();
  });

  it('lets an old substituted Program draft save separately after rejection', async () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    draft.training_program = {
      program_id: 'program-1',
      session_id: 'planned-1',
    };
    draft.exercises[0]!.exercise_id = 'replacement-exercise';
    draft.exercises[0]!.workout_plan_assignment_id = 17;
    draft.exercises[0]!.sets[0]!.completed = true;
    saveWorkoutPlaybackDraftToStorage(draft);
    mockLocationState = null;
    mockCompleteProgramSession.mockRejectedValue(
      new HttpApiError(
        'Performed exercises must belong to the bound Workout Session.',
        400
      )
    );
    mockCreatePresetSession.mockResolvedValue({
      id: 'separate-1',
      exercises: [],
    });

    render(<WorkoutPlaybackPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Finish Workout' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save as a separate workout' })
      ).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Save as a separate workout' })
    );
    await waitFor(() =>
      expect(mockCreatePresetSession).toHaveBeenCalledTimes(1)
    );
    expect(mockCreatePresetSession.mock.calls[0]![0]).toMatchObject({
      workoutPlanAssignmentId: null,
      exercises: [
        {
          exercise_id: 'replacement-exercise',
          workout_plan_assignment_id: null,
        },
      ],
    });
  });

  it('reports a rejected separate save as a save failure, not a Program rejection', async () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    draft.training_program = {
      program_id: 'program-1',
      session_id: 'planned-1',
    };
    draft.exercises[0]!.exercise_id = 'replacement-exercise';
    draft.exercises[0]!.workout_plan_assignment_id = 17;
    draft.exercises[0]!.sets[0]!.completed = true;
    saveWorkoutPlaybackDraftToStorage(draft);
    mockLocationState = null;
    mockCompleteProgramSession.mockRejectedValue(
      new HttpApiError(
        'Performed exercises must belong to the bound Workout Session.',
        400
      )
    );
    mockCreatePresetSession.mockRejectedValue(
      new HttpApiError('Invalid workout.', 400)
    );

    render(<WorkoutPlaybackPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Finish Workout' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Save as a separate workout' })
    );
    expect(
      await screen.findByText(/Failed to save workout/)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/cannot complete the Planned Session/)
    ).not.toBeInTheDocument();
  });

  it.each([
    new Error('uncertain response'),
    new HttpApiError(
      'Workout changed while it was being saved. Reload the diary and retry.',
      409
    ),
  ])(
    'keeps a failed Program draft for an idempotent retry and blocks double submission (%s)',
    async (failure) => {
      const draft = createWorkoutPlaybackDraftFromPreset(
        presetFixture,
        '2026-04-27'
      );
      draft.training_program = {
        program_id: 'program-1',
        session_id: 'planned-1',
      };
      draft.exercises[0]!.workout_plan_assignment_id = 17;
      mockLocationState = { returnTo: '/?date=2026-04-27', draft };
      let rejectFirst!: (reason: Error) => void;
      mockCompleteProgramSession.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirst = reject;
          })
      );
      mockCompleteProgramSession.mockResolvedValueOnce({
        phases: [
          {
            weeks: [
              {
                sessions: [
                  { id: 'planned-1', completed_workout: { id: 'diary-1' } },
                ],
              },
            ],
          },
        ],
      });
      render(<WorkoutPlaybackPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
      await waitFor(() =>
        expect(loadWorkoutPlaybackDraftFromStorage('2026-04-27')).not.toBeNull()
      );
      fireEvent.click(screen.getByRole('button', { name: 'Finish Workout' }));
      fireEvent.click(screen.getByRole('button', { name: 'Finish Workout' }));
      expect(mockCompleteProgramSession).toHaveBeenCalledTimes(1);
      rejectFirst(failure);
      await waitFor(() =>
        expect(screen.getByText(/Failed to save workout/)).toBeInTheDocument()
      );
      expect(loadWorkoutPlaybackDraftFromStorage('2026-04-27')).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Finish Workout' }));
      await waitFor(() =>
        expect(mockCompleteProgramSession).toHaveBeenCalledTimes(2)
      );
      expect(mockCreatePresetSession).not.toHaveBeenCalled();
    }
  );

  it('keeps a conflicting Program draft and offers a separate unlinked save or discard', async () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    draft.training_program = {
      program_id: 'program-1',
      session_id: 'planned-1',
    };
    draft.exercises[0]!.workout_plan_assignment_id = 17;
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };
    mockCompleteProgramSession.mockRejectedValue(
      new HttpApiError(
        'Already completed with a different workout',
        409,
        'PROGRAM_COMPLETION_CONFLICT'
      )
    );
    mockCreatePresetSession.mockResolvedValue({
      id: 'separate-1',
      exercises: [],
    });
    render(<WorkoutPlaybackPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
    await waitFor(() =>
      expect(loadWorkoutPlaybackDraftFromStorage('2026-04-27')).not.toBeNull()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Finish Workout' }));
    await waitFor(() =>
      expect(
        screen.getByText(/already completed with a different workout/i)
      ).toBeInTheDocument()
    );
    expect(
      screen.getByRole('button', { name: 'Save as a separate workout' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    expect(loadWorkoutPlaybackDraftFromStorage('2026-04-27')).not.toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Save as a separate workout' })
    );
    await waitFor(() =>
      expect(mockCreatePresetSession).toHaveBeenCalledTimes(1)
    );
    expect(mockCompleteProgramSession).toHaveBeenCalledTimes(1);
    expect(mockCreatePresetSession.mock.calls[0]![0]).not.toHaveProperty(
      'training_program'
    );
    expect(mockCreatePresetSession.mock.calls[0]![0]).toMatchObject({
      workoutPlanAssignmentId: null,
      exercises: [{ workout_plan_assignment_id: null }],
    });
  });

  it('keeps the standalone playback save path', async () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    draft.exercises[0]!.sets[0]!.completed = true;
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };
    mockCreatePresetSession.mockResolvedValue({
      id: 'standalone-1',
      exercises: [],
    });
    render(<WorkoutPlaybackPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Finish Workout' }));
    await waitFor(() =>
      expect(mockCreatePresetSession).toHaveBeenCalledTimes(1)
    );
    expect(mockCompleteProgramSession).not.toHaveBeenCalled();
  });

  it.each([
    {
      unit: 'km' as const,
      label: 'm',
      prescribed: 50,
      edited: '75.5',
      saved: 0.0755,
    },
    {
      unit: 'miles' as const,
      label: 'yd',
      prescribed: 54.7,
      edited: '100',
      saved: 0.09144,
    },
  ])(
    'persists edited carry distance in $label through completion and the save payload',
    async ({ unit, label, prescribed, edited, saved }) => {
      mockDistanceUnit = unit;
      const preset: WorkoutPreset = {
        ...presetFixture,
        exercises: [
          {
            exercise_id: 'carry',
            exercise_name: 'Farmer Carry',
            modality: 'weight_distance',
            sets: [{ set_number: 1, weight: 20, distance: 0.05 }],
          },
        ],
      };
      mockLocationState = {
        draft: createWorkoutPlaybackDraftFromPreset(preset, '2026-04-27'),
      };
      const view = render(<WorkoutPlaybackPage />);
      const input = screen.getByRole('spinbutton', {
        name: `Distance set 1 (${label})`,
      });
      expect(input).toHaveValue(prescribed);
      expect(screen.queryByLabelText('Reps set 1')).not.toBeInTheDocument();
      fireEvent.change(input, { target: { value: '' } });
      expect(input).toHaveValue(null);
      fireEvent.change(input, { target: { value: '0' } });
      expect(input).toHaveValue(0);
      fireEvent.change(input, { target: { value: edited } });
      fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
      await waitFor(() => {
        const draft = loadWorkoutPlaybackDraftFromStorage('2026-04-27');
        expect(draft?.exercises[0]?.sets[0]?.distance).toBeCloseTo(saved, 8);
        expect(draft?.exercises[0]?.sets[0]?.completed).toBe(true);
      });
      view.unmount();
      mockLocationState = null;
      render(<WorkoutPlaybackPage />);
      fireEvent.click(screen.getByLabelText('Expand Farmer Carry'));
      expect(
        screen.getByRole('spinbutton', { name: `Distance set 1 (${label})` })
      ).toHaveValue(Number(edited));
      const draft = loadWorkoutPlaybackDraftFromStorage('2026-04-27')!;
      const payload = buildPresetSessionCreateRequestFromDraft(draft, 'UTC');
      expect(payload.exercises?.[0]?.sets?.[0]?.distance).toBeCloseTo(saved, 8);
    }
  );

  it('shows elapsed timer and collapses completed exercises', () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    if (draft.exercises[0]?.sets[0]) {
      draft.exercises[0].sets[0].completed = true;
    }
    draft.active_exercise_index = 1;
    draft.active_set_index = 0;
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    expect(screen.getAllByText('Duration').length).toBeGreaterThan(0);
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThanOrEqual(1);
  });

  it('logs the active set from the hero and advances the persisted draft', async () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };
    render(<WorkoutPlaybackPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
    await waitFor(() => {
      const saved = loadWorkoutPlaybackDraftFromStorage('2026-04-27');
      expect(saved?.exercises[0]?.sets[0]?.completed).toBe(true);
      expect(saved?.active_exercise_index).toBe(1);
    });
    expect(
      screen.getByRole('heading', { level: 2, name: 'Barbell Row' })
    ).toBeInTheDocument();
  });

  it('renders duration instead of reps and weight for a timed set', () => {
    const timedPreset = {
      ...presetFixture,
      exercises: [
        {
          exercise_id: 'exercise-treadmill',
          exercise_name: 'Treadmill Warm Up',
          category: 'cardio',
          sets: [
            {
              set_number: 1,
              set_type: 'Warm-up',
              duration: 600,
              reps: null,
              weight: null,
              rest_time: 60,
            },
          ],
        },
      ],
    } as unknown as WorkoutPreset;
    const draft = createWorkoutPlaybackDraftFromPreset(
      timedPreset,
      '2026-04-27'
    );
    expect(draft.exercises[0]?.modality).toBe('duration_distance');
    // Pre-modality local drafts must retain their time-based rendering.
    delete (draft.exercises[0] as { modality?: unknown }).modality;
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    expect(screen.getByText('Duration (s)')).toBeInTheDocument();
    const durationInput = screen.getByLabelText(
      'Duration set 1'
    ) as HTMLInputElement;
    expect(durationInput).toHaveValue(600);
    fireEvent.change(durationInput, { target: { value: '300' } });
    expect(durationInput).toHaveValue(300);
    expect(screen.queryByLabelText('Reps set 1')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Weight set 1')).not.toBeInTheDocument();
  });

  it('keeps blank rows duration-based in legacy timed drafts', () => {
    const timedPreset = {
      ...presetFixture,
      exercises: [
        {
          exercise_id: 'exercise-treadmill',
          exercise_name: 'Treadmill Warm Up',
          category: 'cardio',
          sets: [
            {
              set_number: 1,
              duration: 600,
              reps: null,
              weight: 0,
              rest_time: 60,
            },
          ],
        },
      ],
    } as unknown as WorkoutPreset;
    const draft = createWorkoutPlaybackDraftFromPreset(
      timedPreset,
      '2026-04-27'
    );
    delete (draft.exercises[0] as { modality?: unknown }).modality;
    draft.exercises[0]?.sets.push({
      set_number: 2,
      duration: null,
      reps: null,
      weight: null,
      rest_time: 60,
      completed: false,
      completed_at: null,
    });
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    expect(screen.getByText('Duration (s)')).toBeInTheDocument();
    expect(screen.getByLabelText('Duration set 1')).toHaveValue(600);
    expect(screen.getByLabelText('Duration set 2')).toHaveValue(null);
    expect(screen.queryByLabelText('Reps set 2')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Weight set 2')).not.toBeInTheDocument();
  });

  it('trusts exercise modality over stale set data', () => {
    const mixedPreset = {
      ...presetFixture,
      exercises: [
        {
          exercise_id: 'exercise-plank',
          exercise_name: 'Plank',
          category: 'isometric',
          sets: [
            {
              set_number: 1,
              duration: null,
              reps: null,
              weight: null,
              rest_time: 60,
            },
          ],
        },
        {
          exercise_id: 'exercise-bench',
          exercise_name: 'Bench Press',
          sets: [
            {
              set_number: 1,
              duration: 600,
              reps: null,
              weight: 80,
              rest_time: 90,
            },
          ],
        },
      ],
    } as unknown as WorkoutPreset;
    const draft = createWorkoutPlaybackDraftFromPreset(
      mixedPreset,
      '2026-04-27'
    );
    expect(draft.exercises[0]?.modality).toBe('duration');
    expect(draft.exercises[1]?.modality).toBe('weight_reps');
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    // Plank is timed by modality even with no duration values yet.
    expect(screen.getByLabelText('Duration set 1')).toHaveValue(null);
    // Bench keeps reps/weight despite a stale duration on its set.
    expect(screen.getByLabelText('Reps set 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Weight set 1')).toBeInTheDocument();
  });

  it('restores a draft from localStorage on reload', async () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    window.localStorage.setItem(
      'sparky.workoutPlaybackDraft.v2:user-1:user-1:2026-04-27',
      JSON.stringify(draft)
    );
    mockLocationState = { returnTo: '/?date=2026-04-27' };

    render(<WorkoutPlaybackPage />);

    await waitFor(() => {
      expect(screen.getByText('Upper Body')).toBeInTheDocument();
    });
    expect(screen.getAllByLabelText('Reps set 1')[0]).toBeInTheDocument();
  });

  it('starts rest countdown when current set is completed', () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    fireEvent.click(screen.getAllByLabelText('Complete set 1')[0]!);

    expect(
      screen.getAllByRole('button', { name: 'Pause' }).length
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
    expect(screen.getByText('640')).toBeInTheDocument();
  });

  it('allows editing set values and adding/removing sets', () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    const repsInput = screen.getAllByLabelText(
      'Reps set 1'
    )[0] as HTMLInputElement;
    fireEvent.change(repsInput, { target: { value: '12' } });
    expect(repsInput.value).toBe('12');

    fireEvent.click(screen.getByLabelText('Add set for Bench Press'));
    expect(screen.getAllByLabelText('Reps set 2').length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getAllByLabelText('Remove set 2 for Bench Press')[0]!
    );
    expect(screen.queryByLabelText('Reps set 2')).not.toBeInTheDocument();

    const sessionNotes = screen.getAllByPlaceholderText(
      'Any notes about this session...'
    )[0] as HTMLTextAreaElement;
    fireEvent.change(sessionNotes, { target: { value: 'Felt strong today' } });
    expect(sessionNotes.value).toBe('Felt strong today');

    expect(screen.queryByLabelText('Set notes 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText('Toggle notes for set 1')[0]!);
    expect(screen.getByLabelText('Set notes 1')).toBeInTheDocument();
  });

  it('shows prescribed notes and retains edited effort and notes after resuming', async () => {
    const preset = {
      ...presetFixture,
      exercises: [
        {
          ...presetFixture.exercises[0],
          notes: 'Keep the shoulders down.',
          sets: [
            {
              set_number: 1,
              reps: 8,
              weight: 80,
              rest_time: 90,
              notes: 'Pause at the bottom.',
            },
          ],
        },
      ],
    } as unknown as WorkoutPreset;
    mockLocationState = {
      draft: createWorkoutPlaybackDraftFromPreset(preset, '2026-04-27'),
    };
    const view = render(<WorkoutPlaybackPage />);

    expect(screen.getByLabelText('Exercise notes for Bench Press')).toHaveValue(
      'Keep the shoulders down.'
    );
    expect(screen.getByLabelText('Set notes 1')).toHaveValue(
      'Pause at the bottom.'
    );
    fireEvent.click(screen.getByLabelText('Toggle notes for set 1'));
    expect(screen.queryByLabelText('Set notes 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Toggle notes for set 1'));
    fireEvent.change(screen.getByLabelText('RPE set 1'), {
      target: { value: '8.5' },
    });
    fireEvent.change(screen.getByLabelText('Exercise notes for Bench Press'), {
      target: { value: 'Use a narrower grip next time.' },
    });
    fireEvent.change(screen.getByLabelText('Set notes 1'), {
      target: { value: 'Controlled pause.' },
    });
    fireEvent.click(screen.getByLabelText('Complete set 1'));

    await waitFor(() => {
      const saved = loadWorkoutPlaybackDraftFromStorage('2026-04-27');
      expect(saved?.exercises[0]?.sets[0]?.rpe).toBe(8.5);
    });
    view.unmount();
    mockLocationState = null;
    render(<WorkoutPlaybackPage />);
    fireEvent.click(screen.getByLabelText('Expand Bench Press'));
    expect(screen.getByLabelText('RPE set 1')).toHaveValue(8.5);
    expect(screen.getByLabelText('Exercise notes for Bench Press')).toHaveValue(
      'Use a narrower grip next time.'
    );
    expect(screen.getByLabelText('Set notes 1')).toHaveValue(
      'Controlled pause.'
    );
    const saved = loadWorkoutPlaybackDraftFromStorage('2026-04-27')!;
    const payload = buildPresetSessionCreateRequestFromDraft(saved, 'UTC');
    expect(payload.exercises?.[0]).toMatchObject({
      notes: 'Use a narrower grip next time.',
      sets: [{ rpe: 8.5, notes: 'Controlled pause.' }],
    });
  });

  it('allows entering and clearing RPE for a timed exercise', async () => {
    const preset = {
      ...presetFixture,
      exercises: [
        {
          exercise_id: 'bike',
          exercise_name: 'Stationary bike',
          modality: 'duration_distance',
          sets: [{ set_number: 1, duration: 600, rpe: 6 }],
        },
      ],
    } as unknown as WorkoutPreset;
    mockLocationState = {
      draft: createWorkoutPlaybackDraftFromPreset(preset, '2026-04-27'),
    };
    render(<WorkoutPlaybackPage />);
    const rpe = screen.getByLabelText('RPE set 1');
    expect(rpe).toHaveValue(6);
    fireEvent.change(rpe, { target: { value: '7.5' } });
    expect(rpe).toHaveValue(7.5);
    fireEvent.change(rpe, { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Complete set 1'));
    await waitFor(() => {
      const draft = loadWorkoutPlaybackDraftFromStorage('2026-04-27')!;
      const payload = buildPresetSessionCreateRequestFromDraft(draft, 'UTC');
      expect(payload.exercises?.[0]?.sets[0]?.rpe).toBeNull();
    });
  });

  it('clears the start time when the clear button is clicked', () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    draft.started_at = '2026-04-27T14:30:00.000Z';
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    const startTimeInput = screen.getByLabelText(
      'Start Time'
    ) as HTMLInputElement;
    expect(startTimeInput.value).toBe('14:30');

    fireEvent.click(screen.getByText('Clear'));
    expect(startTimeInput.value).toBe('');
  });

  it('allows extending a finished exercise after expanding it', () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    if (draft.exercises[0]?.sets[0]) {
      draft.exercises[0].sets[0].completed = true;
    }
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    fireEvent.click(screen.getByLabelText('Expand Bench Press'));
    fireEvent.click(screen.getByLabelText('Add set for Bench Press'));

    expect(screen.getAllByLabelText('Reps set 2').length).toBeGreaterThan(0);
  });

  it('edits rest via rest chip presets', () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    fireEvent.click(screen.getAllByLabelText('Edit rest for set 1')[0]!);
    fireEvent.click(screen.getByRole('button', { name: '2:00' }));

    fireEvent.click(screen.getAllByLabelText('Edit rest for set 1')[0]!);
    expect(screen.getByLabelText('Custom (seconds)')).toHaveValue(120);
  });

  it('keeps rest indicator anchored to next set even when selecting others', () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    if (draft.exercises[0]?.sets[0]) {
      draft.exercises[0].sets.push({
        ...draft.exercises[0].sets[0],
        set_number: 2,
      });
    }
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    fireEvent.click(screen.getAllByLabelText('Complete set 1')[0]!);
    expect(screen.getByLabelText('Pause')).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByLabelText('Select set 2 for Bench Press')[0]!
    );

    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
  });
  it('keeps a frozen session’s authored loads and full prescription through playback and completion', async () => {
    const preset = {
      ...presetFixture,
      workout_session_id: '10000000-0000-4000-8000-000000000001',
      exercises: [
        {
          exercise_id: 'exercise-1',
          exercise_name: 'Bench Press',
          ramp_increment: 20,
          workout_plan_assignment_id: 101,
          sets: [1, 2].map((set_number) => ({
            set_number,
            reps: 8,
            weight: 60,
            duration: null,
            distance: 0.2,
            rest_time: null,
            rpe: 7,
            rir: 3,
            notes: '8–10 per side',
          })),
        },
      ],
    } as WorkoutPreset;
    mockLocationState = {
      draft: createWorkoutPlaybackDraftFromPreset(preset, '2026-04-27'),
    };
    render(<WorkoutPlaybackPage />);
    await waitFor(() =>
      expect(
        loadWorkoutPlaybackDraftFromStorage(
          '2026-04-27'
        )?.exercises[0]?.sets.map((set) => set.weight)
      ).toEqual([60, 60])
    );
    fireEvent.click(screen.getByLabelText('Complete set 1'));
    fireEvent.click(screen.getByLabelText('Complete set 2'));
    await waitFor(() => {
      const saved = loadWorkoutPlaybackDraftFromStorage('2026-04-27')!;
      const payload = buildPresetSessionCreateRequestFromDraft(saved, 'UTC');
      expect(payload.exercises?.[0]?.workout_plan_assignment_id).toBe(101);
      expect(payload.exercises?.[0]?.sets).toMatchObject([
        {
          reps: 8,
          weight: 60,
          distance: 0.2,
          rest_time: null,
          rpe: 7,
          rir: 3,
          notes: '8–10 per side',
        },
        {
          reps: 8,
          weight: 60,
          distance: 0.2,
          rest_time: null,
          rpe: 7,
          rir: 3,
          notes: '8–10 per side',
        },
      ]);
    });
  });
});
