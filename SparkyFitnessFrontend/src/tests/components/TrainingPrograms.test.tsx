import '@testing-library/jest-dom';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type {
  TrainingProgram,
  TrainingProgramInput,
  ExerciseSessionResponse,
} from '@workspace/shared';
import { trainingProgramSchema } from '@workspace/shared';
import TrainingPrograms from '@/pages/TrainingPrograms/TrainingPrograms';
import * as api from '@/api/TrainingPrograms/trainingPrograms';
import { getWorkoutPlanTemplates } from '@/api/Exercises/workoutPlanTemplates';
import { fetchExerciseEntries } from '@/api/Exercises/exerciseEntryService';
import en from '../../../public/locales/en/translation.json';

jest.mock('@/api/TrainingPrograms/trainingPrograms');
jest.mock('@/api/Exercises/workoutPlanTemplates');
jest.mock('@/api/Exercises/exerciseEntryService');
// The diary hook imports the app singleton; this suite supplies its own locale
// instance and must not start the singleton's HTTP translation loader.
jest.mock('@/i18n', () => ({
  __esModule: true,
  default: { t: (key: string, fallback?: string) => fallback || key },
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
          id: session.id ?? uuid(),
          sort_order: s,
          workout_plan_name: 'Strength A',
          effective_date: session.scheduled_date,
          status: 'planned',
          outcome_at: null,
          completed_workout: null,
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
          <TrainingPrograms />
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
  fill('Workout Plan', '17', phase);
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
  jest.clearAllMocks();
  mockActor.delegated = false;
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
    { id: '17', user_id: 'athlete', plan_name: 'Strength A', assignments: [] },
    { id: '18', user_id: 'family', plan_name: 'Not my plan', assignments: [] },
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
      phase.weeks[0]?.sessions[0]?.workout_plan_id,
    ])
  ).toEqual([
    ['Base', 'Build endurance', '2026-10-25', '2026-10-30', 17],
    ['Build', 'Practice race pace', '2026-11-01', '2026-11-01', 17],
  ]);
  expect(screen.getByText('Fixed dates')).toBeInTheDocument();
  expect(screen.getByText('Base workout')).toBeInTheDocument();
  expect(screen.getByText('Build workout')).toBeInTheDocument();
  const retainedSessionId = stored!.phases[0]!.weeks[0]!.sessions[0]!.id;
  fireEvent.click(
    screen.getByRole('button', { name: 'Edit Training Program' })
  );
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
    workout_plan_id: 17,
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
  ).toBeDisabled();
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
  fireEvent.change(screen.getAllByLabelText('Workout Plan')[1]!, {
    target: { value: '17' },
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
                workout_plan_id: 17,
              },
              {
                name: 'Strength',
                scheduled_date: '2026-10-30',
                workout_plan_id: 17,
              },
              {
                name: 'Last run',
                scheduled_date: '2026-10-31',
                workout_plan_id: 17,
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

it.each(['preset', 'individual'] as const)(
  'lets the athlete choose and confirm a %s diary workout and shows completion',
  async (type) => {
    stored = scheduleFixture();
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
            exercises: [],
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
            sets: [],
            exercise_snapshot: null,
            activity_details: [],
            superset_group: null,
          };
    jest.mocked(fetchExerciseEntries).mockResolvedValue([]);
    jest
      .mocked(fetchExerciseEntries)
      .mockImplementation(async (date) =>
        date === '2026-10-26' ? [candidate] : []
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
  expect(screen.getByLabelText('Workout Plan')).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Remove session 1' })
  ).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Remove week 1' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Remove phase 1' })).toBeDisabled();
});
