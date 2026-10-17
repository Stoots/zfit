import '@testing-library/jest-dom';
import { useEffect } from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type {
  TrainingProgram,
  TrainingProgramInput,
  ExerciseSessionResponse,
} from '@workspace/shared';
import { trainingProgramSchema } from '@workspace/shared';
import ProgramSchedule from '@/pages/TrainingPrograms/ProgramSchedule';
import ProgramDetail from '@/pages/TrainingPrograms/ProgramDetail';
import { programProgress } from '@/pages/TrainingPrograms/programProgress';
import TrainingPrograms from '@/pages/TrainingPrograms/TrainingPrograms';
import WorkoutPlaybackPage from '@/pages/Diary/WorkoutPlaybackPage';
import * as api from '@/api/TrainingPrograms/trainingPrograms';
import { getWorkoutPlanTemplates } from '@/api/Exercises/workoutPlanTemplates';
import {
  fetchExerciseEntries,
  fetchLastExercisePerformance,
} from '@/api/Exercises/exerciseEntryService';
import { getExerciseById } from '@/api/Exercises/exerciseService';
import type { WorkoutPlaybackRouteState } from '@/utils/workoutPlayback';
import en from '../../../public/locales/en/translation.json';

jest.mock('@/api/TrainingPrograms/trainingPrograms');
jest.mock('@/api/Exercises/workoutPlanTemplates');
jest.mock('@/api/Exercises/exerciseEntryService');
jest.mock('@/api/Exercises/exerciseService');
jest.mock('@/hooks/Exercises/useWorkoutCoaching', () => ({
  fetchWorkoutCoachingSignals: jest.fn(async () => ({
    adaptive_suggestions: false,
    signals: [],
  })),
  useWorkoutSessionFeedback: () => ({ isLoading: true }),
}));
// The diary hook imports the app singleton; this suite supplies its own locale
// instance and must not start the singleton's HTTP translation loader.
jest.mock('@/i18n', () => ({
  __esModule: true,
  default: { t: (key: string, fallback?: string) => fallback || key },
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: 'Australia/Sydney',
    weightUnit: 'kg',
    distanceUnit: 'km',
    energyUnit: 'kcal',
    convertEnergy: (value: number) => value,
    getEnergyUnitString: () => 'kcal',
  }),
}));
const mockActor = { delegated: false };
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'athlete' } }),
}));
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({ isActingOnBehalf: mockActor.delegated }),
}));
const i18n = createInstance();
let stored: TrainingProgram | undefined;
let nextId = 1;
const workoutSessionId = '10000000-0000-4000-8000-000000000001';
const laterWorkoutSessionId = '10000000-0000-4000-8000-000000000002';
let playbackState: WorkoutPlaybackRouteState | undefined;
let renderRealPlayback = false;
function PlaybackDestination() {
  const { state } = useLocation();
  useEffect(() => {
    playbackState = state as WorkoutPlaybackRouteState;
  }, [state]);
  return renderRealPlayback ? (
    <WorkoutPlaybackPage />
  ) : (
    <h1>Workout Playback</h1>
  );
}
const uuid = () =>
  `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
function serverResponse(
  input: TrainingProgramInput,
  id?: string
): TrainingProgram {
  return {
    ...input,
    schedule_type: input.schedule_type ?? 'fixed',
    auto_shift: input.auto_shift ?? false,
    schedule_end_date: input.end_date,
    id: id ?? uuid(),
    user_id: 'athlete',
    created_at: '2026-10-08T12:00:00.000Z',
    updated_at: '2026-10-08T12:00:00.000Z',
    phases: input.phases.map((phase, p) => ({
      ...phase,
      id: phase.id ?? uuid(),
      sort_order: p,
      weeks: phase.weeks.map((week, w) => ({
        ...week,
        id: week.id ?? uuid(),
        sort_order: w,
        sessions: week.sessions.map((session, s) => ({
          ...session,
          workout_session_id: session.workout_session_id ?? null,
          is_optional: session.is_optional ?? false,
          id: session.id ?? uuid(),
          sort_order: s,
          workout_plan_id: session.cardio_test_type ? null : 17,
          workout_session_name: session.cardio_test_type ? null : 'A',
          workout_plan_name: session.cardio_test_type ? null : 'Strength A',
          cardio_test_type: session.cardio_test_type ?? null,
          effective_date: session.scheduled_date,
          status: 'planned',
          outcome_at: null,
          completed_workout: null,
          completed_test_attempt: null,
        })),
      })),
    })),
  };
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Routes>
            <Route path="*" element={<TrainingPrograms />} />
            <Route path="/workout-playback" element={<PlaybackDestination />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
function fill(
  label: string,
  value: string,
  scope: Pick<typeof screen, 'getByLabelText'> = screen
) {
  fireEvent.change(scope.getByLabelText(label), { target: { value } });
}
async function startProgram() {
  fireEvent.click(
    await screen.findByRole('button', { name: 'Create Training Program' })
  );
  await screen.findByLabelText('Program name');
  fill('Program name', 'Autumn 10K');
  fill('Program goal', 'Run 10K comfortably');
  fill('Program start date', '2026-10-25');
  fill('Program end date', '2026-11-07');
}
function addPhase(name: string, goal: string, number: number) {
  fireEvent.click(screen.getByRole('button', { name: 'Add phase' }));
  const phase = within(screen.getByRole('group', { name: `Phase ${number}` }));
  fill('Phase name', name, phase);
  fill('Phase goal', goal, phase);
  fireEvent.click(phase.getByRole('button', { name: 'Add week' }));
  fireEvent.click(phase.getByRole('button', { name: 'Add Planned Session' }));
  fill('Session name', `${name} workout`, phase);
  fill(
    'Workout Session',
    number === 1 ? workoutSessionId : laterWorkoutSessionId,
    phase
  );
  return phase;
}

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});
beforeEach(() => {
  jest.mocked(fetchLastExercisePerformance).mockResolvedValue(null);
  jest.clearAllMocks();
  mockActor.delegated = false;
  playbackState = undefined;
  renderRealPlayback = false;
  jest.mocked(getExerciseById).mockResolvedValue({
    id: 'exercise',
    name: 'Renamed library exercise',
    category: 'Strength',
    modality: 'weight_reps',
    images: null,
    primary_muscles: null,
    secondary_muscles: null,
    equipment: null,
    instructions: null,
    force: null,
    level: null,
    mechanic: null,
  });
  stored = undefined;
  nextId = 1;
  jest
    .mocked(api.getTrainingPrograms)
    .mockImplementation(async () => (stored ? [stored] : []));
  jest.mocked(api.getTrainingProgram).mockImplementation(async () => {
    if (!stored) throw new Error('Program not found');
    return stored;
  });
  jest.mocked(api.saveTrainingProgram).mockImplementation(async (input, id) => {
    stored = serverResponse(input, id);
    return stored;
  });
  jest.mocked(api.deleteTrainingProgram).mockImplementation(async () => {
    stored = undefined;
  });
  jest.mocked(getWorkoutPlanTemplates).mockResolvedValue([
    {
      id: '17',
      user_id: 'athlete',
      plan_name: 'Strength A',
      sessions: [
        {
          id: workoutSessionId,
          name: 'A',
          day_of_week: null,
          is_optional: false,
          sort_order: 0,
          assignments: [
            {
              id: 101,
              exercise_id: 'exercise',
              exercise_name: 'Lunge',
              sets: [
                { set_number: 1, reps: 8 },
                { set_number: 2, reps: 8 },
              ],
            },
          ],
        },
        {
          id: laterWorkoutSessionId,
          name: 'A',
          day_of_week: null,
          is_optional: false,
          sort_order: 1,
          assignments: [
            {
              id: 102,
              exercise_id: 'exercise',
              exercise_name: 'Lunge',
              sets: [
                { set_number: 1, reps: 8 },
                { set_number: 2, reps: 8 },
                { set_number: 3, reps: 8 },
              ],
            },
          ],
        },
      ],
    },
    { id: '18', user_id: 'family', plan_name: 'Not my plan', sessions: [] },
  ]);
});

it('authors phases, weeks and dated sessions, then views, edits and deletes a Program without changing Workout Plans', async () => {
  mount();
  await startProgram();
  const base = addPhase('Base', 'Build endurance', 1);
  fill('Session date', '2026-10-30', base);
  addPhase('Build', 'Practice race pace', 2);
  expect(
    screen.queryByRole('option', { name: 'Not my plan' })
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Save Training Program' })
  );
  await screen.findByRole('heading', { name: 'Autumn 10K' });
  expect(
    stored?.phases.map((phase) => [
      phase.name,
      phase.goal,
      phase.weeks[0]?.start_date,
      phase.weeks[0]?.sessions[0]?.scheduled_date,
      phase.weeks[0]?.sessions[0]?.workout_session_id,
    ])
  ).toEqual([
    ['Base', 'Build endurance', '2026-10-25', '2026-10-30', workoutSessionId],
    [
      'Build',
      'Practice race pace',
      '2026-11-01',
      '2026-11-01',
      laterWorkoutSessionId,
    ],
  ]);
  expect(screen.getByText('Fixed dates')).toBeInTheDocument();
  expect(screen.getByText('Base workout')).toBeInTheDocument();
  expect(screen.getByText('Build workout')).toBeInTheDocument();
  const retainedSessionId = stored!.phases[0]!.weeks[0]!.sessions[0]!.id;
  fireEvent.click(
    screen.getByRole('button', { name: 'Edit Training Program' })
  );
  await screen.findAllByLabelText('Workout Session');
  expect(
    screen
      .getAllByLabelText('Workout Session')
      .map((select) =>
        select instanceof HTMLSelectElement ? select.value : null
      )
  ).toEqual([workoutSessionId, laterWorkoutSessionId]);
  fill('Program goal', 'Finish stronger');
  const editingBase = within(screen.getByRole('group', { name: 'Phase 1' }));
  fill('Session date', '2026-10-31', editingBase);
  fireEvent.click(screen.getByRole('button', { name: 'Remove phase 2' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Save Training Program' })
  );
  await screen.findByRole('heading', { name: 'Autumn 10K' });
  expect(stored!.goal).toBe('Finish stronger');
  expect(stored!.phases.map((phase) => phase.name)).toEqual(['Base']);
  expect(stored!.phases[0]!.weeks[0]!.sessions[0]).toMatchObject({
    id: retainedSessionId,
    scheduled_date: '2026-10-31',
    workout_session_id: workoutSessionId,
  });
  expect(screen.queryByText('Build workout')).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Delete Training Program' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Base workout')).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Delete Training Program' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete Program' }));
  await screen.findByRole('heading', { name: 'Your next goal starts here' });
  expect(stored).toBeUndefined();
});

it('blocks an out-of-week date and preserves the draft after server refusal', async () => {
  mount();
  await startProgram();
  const phase = addPhase('Base', 'Endurance', 1);
  fill('Session date', '2026-11-01', phase);
  fireEvent.click(
    screen.getByRole('button', { name: 'Save Training Program' })
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Session date must be within its week'
  );
  expect(api.saveTrainingProgram).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveFocus();
  fill('Session date', '2026-10-31', phase);
  jest
    .mocked(api.saveTrainingProgram)
    .mockRejectedValueOnce(
      new Error('Workout Plan was deleted. Choose an existing plan.')
    );
  fireEvent.click(
    screen.getByRole('button', { name: 'Save Training Program' })
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose an existing plan'
    )
  );
  expect(screen.getByRole('alert')).toHaveFocus();
  expect(screen.getByLabelText('Program name')).toHaveValue('Autumn 10K');
  expect(screen.getByLabelText('Session date')).toHaveValue('2026-10-31');
});

it('supports authoring structure without Workout Plans and explicit session ordering', async () => {
  jest.mocked(getWorkoutPlanTemplates).mockResolvedValueOnce([]);
  const first = mount();
  await startProgram();
  fireEvent.click(screen.getByRole('button', { name: 'Add phase' }));
  fill('Phase name', 'Recovery');
  fill('Phase goal', 'Rebuild consistency');
  fireEvent.click(screen.getByRole('button', { name: 'Add week' }));
  expect(
    screen.getByRole('button', { name: 'Add Planned Session' })
  ).toBeEnabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Save Training Program' })
  );
  await screen.findByRole('heading', { name: 'Autumn 10K' });
  expect(stored!.phases[0]!.weeks[0]!.sessions).toEqual([]);
  first.unmount();
  stored = undefined;
  mount();
  await startProgram();
  addPhase('Base', 'Strength', 1);
  fireEvent.click(screen.getByRole('button', { name: 'Add Planned Session' }));
  const sessions = screen.getAllByLabelText('Session name');
  fireEvent.change(sessions[1]!, { target: { value: 'Second session' } });
  fireEvent.change(screen.getAllByLabelText('Workout Session')[1]!, {
    target: { value: laterWorkoutSessionId },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Move session 2 up' }));
  expect(screen.getAllByLabelText('Session name')[0]).toHaveValue(
    'Second session'
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Save Training Program' })
  );
  await screen.findByRole('heading', { name: 'Autumn 10K' });
  expect(
    stored!.phases[0]!.weeks[0]!.sessions.map((session) => session.name)
  ).toEqual(['Second session', 'Base workout']);
});

it('schedules a Cardio Test without a Workout Plan and shows its linked attempt in Program history', async () => {
  jest.mocked(getWorkoutPlanTemplates).mockResolvedValueOnce([]);
  mount();
  await startProgram();
  fireEvent.click(screen.getByRole('button', { name: 'Add phase' }));
  fill('Phase name', 'Baseline');
  fill('Phase goal', 'Measure aerobic progress');
  fireEvent.click(screen.getByRole('button', { name: 'Add week' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Planned Session' }));
  fill('Session name', 'Cooper baseline');
  fill('Session type', 'cardio');
  fireEvent.click(
    screen.getByRole('button', { name: 'Save Training Program' })
  );
  await screen.findByRole('heading', { name: 'Autumn 10K' });
  const session = stored!.phases[0]!.weeks[0]!.sessions[0]!;
  expect(session).toMatchObject({
    workout_session_id: null,
    cardio_test_type: 'cooper_run',
  });
  expect(
    screen.getByRole('link', { name: 'Record Test Attempt' })
  ).toHaveAttribute('href', `/cardio-tests?planned_session_id=${session.id}`);
  session.status = 'completed';
  session.completed_test_attempt = {
    id: uuid(),
    test_type: 'cooper_run',
    attempt_date: '2026-10-25',
    results: { distance_meters: 2520 },
  };
  i18n.addResource('en', 'translation', 'cardioTests.unit.meters', 'metres');
  try {
    fireEvent.click(
      screen.getByRole('button', { name: 'All Training Programs' })
    );
    fireEvent.click(
      await screen.findByRole('link', { name: 'View Autumn 10K' })
    );
    expect(await screen.findByText(/Linked Test Attempt:/)).toBeInTheDocument();
    expect(screen.getByText(/2520 metres/)).toBeInTheDocument();
  } finally {
    i18n.addResource('en', 'translation', 'cardioTests.unit.meters', 'm');
  }
});

it.each([
  ['sprint_6s', 'sprint_6s', '5 × 6-second sprint (54-second rests)'],
  ['power_30s', 'power_30s', '2 × 30-second power (60-second rest)'],
  ['ramp', 'ramp', 'Ramp Test'],
])(
  'links a planned %s assessment to its matching web form',
  async (protocol, routeProtocol, title) => {
    jest.mocked(getWorkoutPlanTemplates).mockResolvedValueOnce([]);
    mount();
    await startProgram();
    fireEvent.click(screen.getByRole('button', { name: 'Add phase' }));
    fill('Phase name', 'Baseline');
    fill('Phase goal', 'Measure power');
    fireEvent.click(screen.getByRole('button', { name: 'Add week' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Add Planned Session' })
    );
    fill('Session name', 'Power baseline');
    fill('Session type', 'cardio');
    expect(screen.getByRole('option', { name: title })).toBeInTheDocument();
    fill('Cardio Test protocol', protocol);
    fireEvent.click(
      screen.getByRole('button', { name: 'Save Training Program' })
    );
    await screen.findByRole('heading', { name: 'Autumn 10K' });
    expect(screen.getByText(title)).toBeInTheDocument();
    const session = stored!.phases[0]!.weeks[0]!.sessions[0]!;
    expect(session).toMatchObject({
      cardio_test_type: protocol,
      status: 'planned',
      completed_test_attempt: null,
    });
    expect(
      screen.getByRole('link', { name: 'Record Test Attempt' })
    ).toHaveAttribute(
      'href',
      `/cardio-tests?planned_session_id=${session.id}&protocol=${routeProtocol}`
    );
  }
);

it('offers every recordable Cardio Test in the editor', async () => {
  jest.mocked(getWorkoutPlanTemplates).mockResolvedValueOnce([]);
  mount();
  await startProgram();
  fireEvent.click(screen.getByRole('button', { name: 'Add phase' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add week' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Planned Session' }));
  fill('Session type', 'cardio');
  const protocol = screen.getByRole('combobox', {
    name: 'Cardio Test protocol',
  });
  expect(within(protocol).getAllByRole('option')).toHaveLength(4);
  expect(
    within(protocol).getByRole('option', { name: 'Ramp Test' })
  ).toBeInTheDocument();
});

it('does not expose owner data or authoring while acting as a family delegate', () => {
  mockActor.delegated = true;
  mount();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Switch to your own profile'
  );
  expect(
    screen.queryByRole('button', { name: 'Create Training Program' })
  ).not.toBeInTheDocument();
  expect(api.getTrainingPrograms).not.toHaveBeenCalled();
});

function scheduleFixture(autoShift = false): TrainingProgram {
  return serverResponse({
    name: 'Outcome schedule',
    goal: 'Consistent training',
    start_date: '2026-10-25',
    end_date: '2026-10-31',
    auto_shift: autoShift,
    phases: [
      {
        name: 'Base',
        goal: 'Endurance',
        weeks: [
          {
            start_date: '2026-10-25',
            end_date: '2026-10-31',
            sessions: [
              {
                name: 'First run',
                scheduled_date: '2026-10-25',
                workout_session_id: workoutSessionId,
              },
              {
                name: 'Strength',
                scheduled_date: '2026-10-30',
                workout_session_id: laterWorkoutSessionId,
              },
              {
                name: 'Last run',
                scheduled_date: '2026-10-31',
                workout_session_id: workoutSessionId,
              },
            ],
          },
        ],
      },
    ],
  });
}
const sessionRow = (name: string) => screen.getByText(name).closest('li')!;
async function openStored() {
  mount();
  fireEvent.click(
    await screen.findByRole('link', { name: 'View Outcome schedule' })
  );
  await screen.findByRole('heading', { name: 'Outcome schedule' });
}

it.each([false, true])(
  'shows the resulting schedule and permanent miss with auto-shift=%s',
  async (autoShift) => {
    stored = scheduleFixture(autoShift);
    const response = trainingProgramSchema.parse(
      JSON.parse(JSON.stringify(stored))
    );
    const rows = response.phases[0]!.weeks[0]!.sessions;
    rows[0]!.status = 'missed';
    rows[0]!.outcome_at = '2026-10-25T12:00:00.000Z';
    if (autoShift) {
      rows[1]!.effective_date = '2026-10-31';
      rows[2]!.effective_date = '2026-11-01';
      response.schedule_end_date = '2026-11-01';
    }
    jest
      .mocked(api.recordTrainingProgramOutcome)
      .mockImplementationOnce(async () => {
        stored = response;
        return response;
      });
    await openStored();
    expect(
      within(sessionRow('First run')).getByText('Planned')
    ).toBeInTheDocument();
    fireEvent.click(
      within(sessionRow('First run')).getByRole('button', {
        name: 'Mark missed',
      })
    );
    expect(screen.getByRole('dialog')).toHaveTextContent(
      autoShift ? 'one calendar day' : 'Fixed dates stay unchanged'
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm missed session' })
    );
    await waitFor(() =>
      expect(
        within(sessionRow('First run')).getByText('Missed')
      ).toBeInTheDocument()
    );
    expect(
      within(sessionRow('First run')).getByText('2026-10-25')
    ).toBeInTheDocument();
    expect(
      within(sessionRow('First run')).queryByRole('button', {
        name: 'Mark missed',
      })
    ).not.toBeInTheDocument();
    expect(
      within(sessionRow('Strength')).getByText(
        autoShift ? '2026-10-31' : '2026-10-30'
      )
    ).toBeInTheDocument();
    expect(
      within(sessionRow('Last run')).getByText(
        autoShift ? '2026-11-01' : '2026-10-31'
      )
    ).toBeInTheDocument();
    if (autoShift) {
      expect(
        within(sessionRow('Last run')).getByText(/Authored:/)
      ).toHaveTextContent('2026-10-31');
      expect(screen.getByText(/Resulting schedule ends:/)).toHaveTextContent(
        '2026-11-01'
      );
    }
  }
);

it('renders cumulative repeated misses beside unchanged completion history after reload', async () => {
  stored = scheduleFixture(true);
  const rows = stored.phases[0]!.weeks[0]!.sessions;
  rows[0]!.status = 'missed';
  rows[0]!.outcome_at = '2026-10-25T12:00:00.000Z';
  rows[1]!.status = 'missed';
  rows[1]!.effective_date = '2026-10-31';
  rows[1]!.outcome_at = '2026-10-31T12:00:00.000Z';
  rows[2]!.status = 'completed';
  rows[2]!.effective_date = '2026-11-02';
  rows[2]!.outcome_at = '2026-11-02T12:00:00.000Z';
  rows[2]!.completed_workout = {
    type: 'individual',
    id: uuid(),
    name: 'Race run',
    entry_date: '2026-11-02',
  };
  stored.schedule_end_date = '2026-11-02';
  await openStored();
  expect(
    within(sessionRow('First run')).getByText('Missed')
  ).toBeInTheDocument();
  expect(
    within(sessionRow('Strength')).getByText('Missed')
  ).toBeInTheDocument();
  expect(
    within(sessionRow('Strength')).getByText('2026-10-31')
  ).toBeInTheDocument();
  expect(
    within(sessionRow('Last run')).getByText('Completed')
  ).toBeInTheDocument();
  expect(
    within(sessionRow('Last run')).getByRole('link', {
      name: 'Race run · 2026-11-02',
    })
  ).toHaveAttribute('href', '/?date=2026-11-02');
  expect(
    screen.queryByRole('button', { name: 'Mark missed' })
  ).not.toBeInTheDocument();
});

it.each([
  { type: 'preset', omitted: false, blankSet: false },
  { type: 'individual', omitted: false, blankSet: false },
  { type: 'preset', omitted: true, blankSet: false },
  { type: 'individual', omitted: true, blankSet: false },
  { type: 'individual', omitted: false, blankSet: true },
  { type: 'individual', omitted: true, blankSet: true },
] as const)(
  'links a $type diary workout after omission=$omitted with blankSet=$blankSet without changing required dates',
  async ({ type, omitted, blankSet }) => {
    stored = scheduleFixture();
    if (omitted) {
      const session = stored.phases[0]!.weeks[0]!.sessions[0]!;
      session.is_optional = true;
      session.status = 'omitted';
      session.outcome_at = '2026-10-26T00:00:00.000Z';
    }
    const workoutId = uuid();
    const candidate: ExerciseSessionResponse =
      type === 'preset'
        ? {
            type,
            id: workoutId,
            name: 'Logged strength',
            entry_date: '2026-10-26',
            workout_preset_id: null,
            description: null,
            notes: null,
            source: 'manual',
            total_duration_minutes: 30,
            exercises: [
              {
                id: uuid(),
                exercise_id: null,
                duration_minutes: 0,
                calories_burned: 0,
                entry_date: '2026-10-26',
                notes: null,
                distance: null,
                avg_heart_rate: null,
                source: 'manual',
                exercise_snapshot: null,
                activity_details: [],
                superset_group: null,
                sets: [
                  {
                    id: 1,
                    set_number: 1,
                    set_type: null,
                    reps: 8,
                    weight: 50,
                    duration: null,
                    rest_time: null,
                    notes: null,
                    rpe: null,
                    completed_at: null,
                    is_pr: false,
                  },
                ],
              },
            ],
            activity_details: [],
          }
        : {
            type,
            id: workoutId,
            exercise_id: null,
            name: 'Logged run',
            entry_date: '2026-10-26',
            duration_minutes: 30,
            calories_burned: 200,
            notes: null,
            distance: null,
            avg_heart_rate: null,
            source: 'manual',
            sets: blankSet
              ? [
                  {
                    id: 1,
                    set_number: 1,
                    set_type: null,
                    reps: null,
                    weight: null,
                    duration: null,
                    distance: null,
                    rest_time: null,
                    notes: null,
                    rpe: null,
                    completed_at: null,
                    is_pr: false,
                  },
                ]
              : [],
            exercise_snapshot: null,
            activity_details: [],
            superset_group: null,
          };
    jest.mocked(fetchExerciseEntries).mockResolvedValue([]);
    jest.mocked(fetchExerciseEntries).mockImplementation(async (date) =>
      date === '2026-10-26'
        ? [
            candidate,
            {
              type: 'preset',
              id: uuid(),
              name: 'Empty planned group',
              entry_date: date,
              workout_preset_id: null,
              description: null,
              notes: null,
              source: 'manual',
              total_duration_minutes: 30,
              exercises: [],
              activity_details: [],
            },
            ...(candidate.type === 'preset'
              ? [
                  {
                    ...candidate,
                    id: uuid(),
                    name: 'Untouched prefill',
                    exercises: candidate.exercises.map((exercise) => ({
                      ...exercise,
                      is_weekly_prefill: true,
                    })),
                  },
                  {
                    ...candidate,
                    id: uuid(),
                    name: 'Started prescription',
                    exercises: candidate.exercises.map((exercise) => ({
                      ...exercise,
                      source: 'Workout Plan',
                      is_weekly_prefill: false,
                    })),
                  },
                ]
              : [
                  {
                    ...candidate,
                    id: uuid(),
                    name: 'Empty individual',
                    duration_minutes: 0,
                  },
                ]),
          ]
        : []
    );
    const response = trainingProgramSchema.parse(
      JSON.parse(JSON.stringify(stored))
    );
    response.phases[0]!.weeks[0]!.sessions[0] = {
      ...response.phases[0]!.weeks[0]!.sessions[0]!,
      status: 'completed',
      outcome_at: '2026-10-26T12:00:00.000Z',
      completed_workout: {
        type,
        id: workoutId,
        name: candidate.name!,
        entry_date: '2026-10-26',
      },
    };
    jest
      .mocked(api.recordTrainingProgramOutcome)
      .mockImplementationOnce(async () => {
        stored = response;
        return response;
      });
    await openStored();
    if (omitted) {
      expect(
        within(sessionRow('First run')).getByText('Omitted')
      ).toBeInTheDocument();
      expect(
        within(sessionRow('First run')).getByText('Optional')
      ).toBeInTheDocument();
      expect(
        within(sessionRow('First run')).queryByRole('button', {
          name: 'Mark missed',
        })
      ).not.toBeInTheDocument();
      expect(
        within(sessionRow('First run')).queryByRole('button', {
          name: 'Start Workout',
        })
      ).not.toBeInTheDocument();
    }
    fireEvent.click(
      within(sessionRow('First run')).getByRole('button', {
        name: 'Link completed workout',
      })
    );
    expect(
      await screen.findByText(/No diary workouts on this date/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Confirm completion' })
    ).toBeDisabled();
    fill('Diary workout date', '2026-10-26');
    await screen.findByLabelText('Completed diary workout');
    expect(
      screen.queryByRole('option', { name: /Empty planned group/ })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('option', {
        name: /Untouched prefill|Started prescription|Empty individual/,
      })
    ).not.toBeInTheDocument();
    fill('Completed diary workout', `${type}:${workoutId}`);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm completion' }));
    await waitFor(() =>
      expect(
        within(sessionRow('First run')).getByText('Completed')
      ).toBeInTheDocument()
    );
    expect(within(sessionRow('First run')).getByRole('link')).toHaveTextContent(
      `${candidate.name} · 2026-10-26`
    );
    expect(
      within(sessionRow('Strength')).getByText('2026-10-30')
    ).toBeInTheDocument();
  }
);

it('retains the schedule and allows retry after an outcome refusal', async () => {
  stored = scheduleFixture(true);
  jest
    .mocked(api.recordTrainingProgramOutcome)
    .mockRejectedValueOnce(
      new Error('This session already has a recorded outcome.')
    );
  await openStored();
  fireEvent.click(
    within(sessionRow('First run')).getByRole('button', { name: 'Mark missed' })
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Confirm missed session' })
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'already has a recorded outcome'
  );
  expect(
    screen.getByRole('button', { name: 'Confirm missed session' })
  ).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(
    within(sessionRow('First run')).getByText('Planned')
  ).toBeInTheDocument();
  expect(
    within(sessionRow('Strength')).getByText('2026-10-30')
  ).toBeInTheDocument();
});

it('defaults auto-shift off, persists an explicit opt-in and locks recorded session editing/removal', async () => {
  mount();
  await startProgram();
  expect(
    screen.getByRole('checkbox', { name: 'Auto-shift after a miss' })
  ).not.toBeChecked();
  addPhase('Base', 'Endurance', 1);
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Auto-shift after a miss' })
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Save Training Program' })
  );
  await screen.findByText('Auto-shift enabled');
  stored!.phases[0]!.weeks[0]!.sessions[0]!.status = 'missed';
  fireEvent.click(
    screen.getByRole('button', { name: 'Edit Training Program' })
  );
  expect(
    screen.getByRole('checkbox', { name: 'Auto-shift after a miss' })
  ).toBeChecked();
  expect(screen.getByLabelText('Session name')).toBeDisabled();
  expect(screen.getByLabelText('Session date')).toBeDisabled();
  expect(
    screen.getByRole('combobox', { name: 'Workout Session' })
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Remove session 1' })
  ).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Remove week 1' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Remove phase 1' })).toBeDisabled();
});

it('starts the exact later repeated-label session after reloading instead of the plan’s first session', async () => {
  stored = scheduleFixture();
  await openStored();
  fireEvent.click(
    within(sessionRow('Strength')).getByRole('button', {
      name: 'Start Workout',
    })
  );
  await screen.findByRole('heading', { name: 'Workout Playback' });
  const draft = playbackState?.draft;
  if (!draft) {
    throw new Error(
      'Exact Program session start must provide a workout playback draft.'
    );
  }
  const exercise = draft.exercises[0];
  if (!exercise) {
    throw new Error(
      'Exact Program session start must include its prescribed exercise.'
    );
  }
  expect(draft.workout_session_id).toBe(laterWorkoutSessionId);
  expect(draft.training_program).toEqual({
    program_id: stored!.id,
    session_id: stored!.phases[0]!.weeks[0]!.sessions[1]!.id,
  });
  expect(draft.entry_date).toBe('2026-10-30');
  expect(exercise.sets.map((set) => set.reps)).toEqual([8, 8, 8]);
  expect(exercise.exercise_name).toBe('Lunge');
  expect(draft.load_adjustments_applied).toBe(true);
});

it('starts and finishes a Planned Session from the Program page through atomic completion', async () => {
  renderRealPlayback = true;
  stored = scheduleFixture();
  jest
    .mocked(api.completeTrainingProgramSession)
    .mockImplementation(async (programId, sessionId, input) => {
      expect(programId).toBe(stored!.id);
      const next = structuredClone(stored!);
      const target = next.phases
        .flatMap((phase) => phase.weeks)
        .flatMap((week) => week.sessions)
        .find((session) => session.id === sessionId)!;
      target.status = 'completed';
      target.outcome_at = '2026-10-30T10:00:00.000Z';
      target.completed_workout = {
        type: 'preset',
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Strength',
        entry_date: input.entry_date,
      };
      stored = next;
      return next;
    });
  await openStored();
  const sessionId = stored!.phases[0]!.weeks[0]!.sessions[1]!.id;
  fireEvent.click(
    within(sessionRow('Strength')).getByRole('button', {
      name: 'Start Workout',
    })
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Log set' }));
  fireEvent.click(screen.getByRole('button', { name: 'Finish Workout' }));
  await waitFor(() =>
    expect(api.completeTrainingProgramSession).toHaveBeenCalledWith(
      stored!.id,
      sessionId,
      expect.objectContaining({
        entry_date: '2026-10-30',
        performed_exercises: [
          expect.objectContaining({
            sets: [expect.objectContaining({ reps: 8 })],
          }),
        ],
      })
    )
  );
  expect(fetchExerciseEntries).not.toHaveBeenCalled();
});

it('refuses a missing exact binding rather than starting the first available session', async () => {
  stored = scheduleFixture();
  stored.phases[0]!.weeks[0]!.sessions[1]!.workout_session_id =
    '10000000-0000-4000-8000-000000000099';
  await openStored();
  fireEvent.click(
    within(sessionRow('Strength')).getByRole('button', {
      name: 'Start Workout',
    })
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'selected Workout Session is unavailable'
  );
  expect(playbackState).toBeUndefined();
});

it('inherits library optionality for new sessions but preserves an edited stored override', async () => {
  const plans = await getWorkoutPlanTemplates();
  plans[0]!.sessions[0]!.is_optional = true;
  jest.mocked(getWorkoutPlanTemplates).mockResolvedValue(plans);
  mount();
  await startProgram();
  const phase = addPhase('Base', 'Endurance', 1);
  expect(phase.getByLabelText('Optional')).toBeChecked();
  fireEvent.click(phase.getByLabelText('Optional'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Save Training Program' })
  );
  await screen.findByRole('heading', { name: 'Autumn 10K' });
  expect(stored!.phases[0]!.weeks[0]!.sessions[0]!.is_optional).toBe(false);
  fireEvent.click(
    screen.getByRole('button', { name: 'Edit Training Program' })
  );
  await screen.findByLabelText('Workout Session');
  expect(screen.getByLabelText('Optional')).not.toBeChecked();
  fill('Workout Session', laterWorkoutSessionId);
  expect(screen.getByLabelText('Optional')).not.toBeChecked();
  fireEvent.click(
    screen.getByRole('button', { name: 'Save Training Program' })
  );
  await screen.findByRole('heading', { name: 'Autumn 10K' });
  expect(stored!.phases[0]!.weeks[0]!.sessions[0]!.is_optional).toBe(false);
});

it('does not offer a missed outcome for a planned optional session', async () => {
  stored = scheduleFixture();
  stored.phases[0]!.weeks[0]!.sessions[0]!.is_optional = true;
  await openStored();
  const optional = within(sessionRow('First run'));
  expect(optional.getByText('Optional')).toBeInTheDocument();
  expect(
    optional.queryByRole('button', { name: 'Mark missed' })
  ).not.toBeInTheDocument();
  expect(
    optional.getByRole('button', { name: 'Link completed workout' })
  ).toBeInTheDocument();
  expect(
    within(sessionRow('Strength')).getByRole('button', { name: 'Mark missed' })
  ).toBeInTheDocument();
});

it('counts calendar weeks through shifted schedule dates without advancing future programs', () => {
  const program = serverResponse({
    name: 'Summer',
    goal: 'Train',
    start_date: '2026-10-01',
    end_date: '2026-10-14',
    phases: [],
  });
  expect(programProgress(program, '2026-09-30')).toEqual({
    current: 0,
    total: 2,
    active: false,
  });
  expect(programProgress(program, '2026-10-08')).toEqual({
    current: 2,
    total: 2,
    active: true,
  });
  expect(programProgress(program, '2026-10-15')).toEqual({
    current: 2,
    total: 2,
    active: false,
  });
  program.schedule_end_date = '2026-10-16';
  expect(programProgress(program, '2026-10-15')).toEqual({
    current: 3,
    total: 3,
    active: true,
  });
});

it('places shifted sessions on effective calendar days and links each exact session', () => {
  const program = serverResponse({
    name: 'Summer',
    goal: 'Train',
    start_date: '2026-10-01',
    end_date: '2026-10-07',
    phases: [
      {
        name: 'Build',
        goal: 'Train',
        weeks: [
          {
            start_date: '2026-10-01',
            end_date: '2026-10-07',
            sessions: [
              {
                name: 'Run',
                scheduled_date: '2026-10-07',
                workout_session_id: workoutSessionId,
              },
              {
                name: 'Lift',
                scheduled_date: '2026-10-07',
                workout_session_id: laterWorkoutSessionId,
              },
            ],
          },
        ],
      },
    ],
  });
  program.schedule_end_date = '2026-10-08';
  const [run, lift] = program.phases[0]!.weeks[0]!.sessions;
  run!.effective_date = '2026-10-08';
  lift!.status = 'completed';
  render(
    <I18nextProvider i18n={i18n}>
      <ProgramSchedule program={program} today="2026-10-08" />
    </I18nextProvider>
  );
  const link = screen.getByText(/Run ·/).closest('a')!;
  expect(link).toHaveAttribute('href', `#program-session-${run!.id}`);
  const cell = link.closest('[aria-current="date"]')!;
  expect(cell.querySelector('time')).toHaveAttribute('dateTime', '2026-10-08');
  expect(screen.getByText('Completed')).toBeInTheDocument();
  expect(screen.getByText('Week 2')).toBeInTheDocument();
});

it('places a current program before inactive programs without mutating the query list', async () => {
  const past = serverResponse({
    name: 'Past block',
    goal: 'Train',
    start_date: '2000-01-01',
    end_date: '2000-01-14',
    phases: [],
  });
  const active = serverResponse({
    name: 'Current block',
    goal: 'Train',
    start_date: '2020-01-01',
    end_date: '2099-01-14',
    phases: [],
  });
  const programs = [past, active];
  jest.mocked(api.getTrainingPrograms).mockResolvedValue(programs);
  mount();
  await screen.findByRole('link', { name: 'View Current block' });
  expect(
    screen
      .getAllByRole('link', { name: /^View / })
      .map((link) => link.getAttribute('aria-label'))
  ).toEqual(['View Current block', 'View Past block']);
  expect(programs).toEqual([past, active]);
});

it('jumps past history to the earliest pending effective date, including overdue sessions', () => {
  const program = scheduleFixture(true);
  const [first, strength, last] = program.phases[0]!.weeks[0]!.sessions;
  first!.effective_date = '2026-11-03';
  strength!.effective_date = '2026-11-01';
  last!.status = 'completed';
  const scroll = jest.fn();
  const previousScroll = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ProgramDetail
            selected={program}
            today="2026-11-02"
            outcomePending={false}
            startingSessionId={null}
            onStartSession={jest.fn()}
            onEdit={jest.fn()}
            onDelete={jest.fn()}
            onRecordOutcome={jest.fn()}
          />
        </MemoryRouter>
      </I18nextProvider>
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Jump to next session' })
    );
    expect(sessionRow('Strength')).toHaveFocus();
    expect(scroll).toHaveBeenCalled();
    expect(sessionRow('Last run')).toHaveTextContent('Completed');
    expect(sessionRow('First run')).toBeInTheDocument();
  } finally {
    HTMLElement.prototype.scrollIntoView = previousScroll;
  }
});

it('explains when no sessions remain while keeping completed, missed and optional history', async () => {
  stored = scheduleFixture();
  const [first, strength, last] = stored.phases[0]!.weeks[0]!.sessions;
  first!.status = 'completed';
  strength!.status = 'missed';
  last!.status = 'omitted';
  last!.is_optional = true;
  await openStored();
  expect(screen.getByText('No remaining sessions.')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Jump to next session' })
  ).not.toBeInTheDocument();
  expect(sessionRow('First run')).toHaveTextContent('Completed');
  expect(sessionRow('Strength')).toHaveTextContent('Missed');
  expect(sessionRow('Last run')).toHaveTextContent('Omitted');
  expect(sessionRow('Last run')).toHaveTextContent('Optional');
});

it('keeps an unstarted optional assessment in the next-session queue', async () => {
  stored = scheduleFixture();
  const sessions = stored.phases[0]!.weeks[0]!.sessions;
  sessions[0]!.status = 'completed';
  sessions[1]!.status = 'missed';
  sessions[2]!.cardio_test_type = 'ramp';
  sessions[2]!.workout_session_id = null;
  sessions[2]!.is_optional = true;
  const previousScroll = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = jest.fn();
  try {
    await openStored();
    fireEvent.click(
      screen.getByRole('button', { name: 'Jump to next session' })
    );
    expect(sessionRow('Last run')).toHaveFocus();
    expect(
      within(sessionRow('Last run')).getByRole('link', {
        name: 'Record Test Attempt',
      })
    ).toBeInTheDocument();
  } finally {
    HTMLElement.prototype.scrollIntoView = previousScroll;
  }
});
