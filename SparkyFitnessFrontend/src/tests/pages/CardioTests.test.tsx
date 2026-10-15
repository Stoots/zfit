import type { ReactElement } from 'react';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithClient } from '../test-utils';
import type {
  CooperRunAttempt,
  CooperRunAttemptInput,
  CardioTestAttempt,
  CardioTestAttemptInput,
  TrainingProgram,
} from '@workspace/shared';
import CooperRunTests from '@/pages/CardioTests/CooperRunTests';
import {
  createCooperRunAttempt,
  updateCooperRunAttempt,
  getProtocolAttempts,
  saveProtocolAttempt,
} from '@/api/CardioTests/cardioTests';
import { getTrainingPrograms } from '@/api/TrainingPrograms/trainingPrograms';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}));
const mockServer = { records: [] as CooperRunAttempt[] };
let mockProtocolRecords: CardioTestAttempt[] = [];
let mockActiveUserId = '00000000-0000-4000-a000-000000000001';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({
    activeUserId: mockActiveUserId,
    hasPermission: () => true,
    hasWritePermission: () => true,
  }),
}));

jest.mock('@/api/CardioTests/cardioTests', () => ({
  getProtocolAttempts: jest.fn(async (protocol: string) =>
    mockProtocolRecords.filter((attempt) => attempt.test_type === protocol)
  ),
  saveProtocolAttempt: jest.fn(async (input: CardioTestAttemptInput) => {
    const saved = {
      ...input,
      id: `00000000-0000-4000-a000-0000000000${mockProtocolRecords.length + 20}`,
      user_id: mockActiveUserId,
      created_at: '2026-10-01T12:00:00Z',
      updated_at: '2026-10-01T12:00:00Z',
    } as CardioTestAttempt;
    mockProtocolRecords = [...mockProtocolRecords, saved];
    return saved;
  }),
  getCooperRunAttempts: jest.fn(async () => mockServer.records),
  createCooperRunAttempt: jest.fn(async (input: CooperRunAttemptInput) => {
    const timestamp = '2026-10-09T12:00:00.000Z';
    const attempt: CooperRunAttempt = {
      id: '00000000-0000-4000-a000-000000000010',
      user_id: '00000000-0000-4000-a000-000000000001',
      test_type: 'cooper_run',
      planned_session_id: null,
      ...input,
      created_at: timestamp,
      updated_at: timestamp,
    };
    mockServer.records = [...mockServer.records, attempt].sort((left, right) =>
      left.attempt_date.localeCompare(right.attempt_date)
    );
    return attempt;
  }),
  updateCooperRunAttempt: jest.fn(
    async (id: string, input: CooperRunAttemptInput) => {
      const existing = mockServer.records.find((attempt) => attempt.id === id)!;
      const saved = {
        ...existing,
        ...input,
        updated_at: '2026-10-10T12:00:00.000Z',
      };
      mockServer.records = mockServer.records
        .map((attempt) => (attempt.id === id ? saved : attempt))
        .sort((left, right) =>
          left.attempt_date.localeCompare(right.attempt_date)
        );
      return saved;
    }
  ),
}));
jest.mock('@/api/TrainingPrograms/trainingPrograms', () => ({
  getTrainingPrograms: jest.fn(async () => []),
}));

// jsdom has no layout; only supply dimensions. Axes, marks and scales stay real.
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) => (
      <actual.ResponsiveContainer width={640} height={240}>
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});

function expectTrend(dates: string[], distances: number[]) {
  const chart = screen.getByRole('figure', {
    name: 'Cooper run distance trend by date',
  });
  expect(chart.querySelectorAll('.recharts-reference-line')).toHaveLength(0);
  expect(within(chart).queryByText('First attempt')).not.toBeInTheDocument();
  const dateTicks = Array.from(
    chart.querySelectorAll(
      '.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value'
    )
  );
  expect(dateTicks.map((tick) => tick.textContent)).toEqual(dates);
  const ticks = Array.from(
    chart.querySelectorAll(
      '.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value'
    )
  );
  const first = ticks[0]!;
  const last = ticks[1]!;
  const firstValue = Number(first.textContent?.replace(/[^\d.]/g, ''));
  const lastValue = Number(last.textContent?.replace(/[^\d.]/g, ''));
  const firstY = Number(first.getAttribute('y'));
  const lastY = Number(last.getAttribute('y'));
  const dots = Array.from(chart.querySelectorAll('.recharts-line-dot'));
  expect(dots).toHaveLength(distances.length);
  dots.forEach((dot, index) => {
    if (index > 0) {
      expect(Number(dot.getAttribute('cx'))).toBeGreaterThan(
        Number(dots[index - 1]!.getAttribute('cx'))
      );
    }
    const plottedDistance =
      firstValue +
      ((Number(dot.getAttribute('cy')) - firstY) * (lastValue - firstValue)) /
        (lastY - firstY);
    expect(plottedDistance).toBeCloseTo(distances[index]!, 0);
  });
}

function scheduledProgram(
  protocol: 'cooper_run' | 'sprint_6s' | 'power_30s',
  sessionId: string
): TrainingProgram {
  return {
    id: '00000000-0000-4000-a000-000000000090',
    user_id: mockActiveUserId,
    name: 'Autumn base',
    goal: 'Run farther',
    start_date: '2026-09-20',
    end_date: '2026-10-10',
    schedule_end_date: '2026-10-10',
    schedule_type: 'fixed',
    auto_shift: false,
    created_at: '2026-09-20T12:00:00Z',
    updated_at: '2026-09-20T12:00:00Z',
    phases: [
      {
        id: '00000000-0000-4000-a000-000000000091',
        name: 'Baseline',
        goal: 'Assess',
        sort_order: 0,
        weeks: [
          {
            id: '00000000-0000-4000-a000-000000000092',
            start_date: '2026-09-27',
            end_date: '2026-10-03',
            sort_order: 0,
            sessions: [
              {
                id: sessionId,
                name: 'Baseline test',
                scheduled_date: '2026-09-27',
                effective_date: '2026-09-27',
                sort_order: 0,
                status: 'planned',
                is_optional: false,
                outcome_at: null,
                workout_session_id: null,
                workout_session_name: null,
                workout_plan_id: null,
                workout_plan_name: null,
                cardio_test_type: protocol,
                completed_workout: null,
                completed_test_attempt: null,
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('Cooper run Test Attempts', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    mockServer.records = [];
    mockProtocolRecords = [];
    jest.clearAllMocks();
    mockActiveUserId = '00000000-0000-4000-a000-000000000001';
    jest.mocked(getTrainingPrograms).mockResolvedValue([]);
  });

  it('records a standalone Cooper attempt when planned assessments fail to load', async () => {
    const sessionId = '00000000-0000-4000-a000-000000000099';
    window.history.replaceState(
      {},
      '',
      `/cardio-tests?planned_session_id=${sessionId}`
    );
    jest
      .mocked(getTrainingPrograms)
      .mockRejectedValueOnce(new Error('Unavailable'));
    renderWithClient(<CooperRunTests />);
    const selection = screen.getByLabelText('Planned assessment', {
      selector: '#cooper-planned-session',
    });
    await waitFor(() => expect(selection).toHaveValue(''));
    fireEvent.change(
      screen.getByLabelText('Date', { selector: '#cooper-attempt-date' }),
      {
        target: { value: '2026-10-14' },
      }
    );
    fireEvent.change(screen.getByLabelText('12-minute distance (m)'), {
      target: { value: '2512' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record Test' }));
    await waitFor(() =>
      expect(createCooperRunAttempt).toHaveBeenCalledWith({
        attempt_date: '2026-10-14',
        distance_meters: 2512,
        planned_session_id: null,
      })
    );
  });

  it('does not unlink an edited Cooper attempt when planned assessments fail to load', async () => {
    mockServer.records = [
      {
        id: '00000000-0000-4000-a000-000000000010',
        user_id: mockActiveUserId,
        test_type: 'cooper_run',
        planned_session_id: '00000000-0000-4000-a000-000000000099',
        attempt_date: '2026-10-14',
        distance_meters: 2400,
        created_at: '2026-10-14T12:00:00Z',
        updated_at: '2026-10-14T12:00:00Z',
      },
    ];
    jest
      .mocked(getTrainingPrograms)
      .mockRejectedValueOnce(new Error('Unavailable'));
    renderWithClient(<CooperRunTests />);
    fireEvent.click(
      within((await screen.findByText('2,400 m')).closest('li')!).getByRole(
        'button',
        {
          name: 'Edit',
        }
      )
    );
    const save = screen.getByRole('button', { name: 'Save' });
    await waitFor(() =>
      expect(
        within(save.closest('form')!).getByRole('alert')
      ).toHaveTextContent('Planned assessments could not be loaded.')
    );
    expect(save).toBeDisabled();
    expect(updateCooperRunAttempt).not.toHaveBeenCalled();
  });

  it('records a Test Attempt against a scheduled assessment', async () => {
    const sessionId = '00000000-0000-4000-a000-000000000099';
    window.history.replaceState(
      {},
      '',
      `/cardio-tests?planned_session_id=${sessionId}`
    );
    const program = scheduledProgram('cooper_run', sessionId);
    jest.mocked(getTrainingPrograms).mockResolvedValue([program]);
    renderWithClient(<CooperRunTests />);
    const selection = await screen.findByRole('option', {
      name: /Autumn base · Baseline · Baseline test/,
    });
    expect(selection).toBeInTheDocument();
    expect(
      screen.getByLabelText('Planned assessment', {
        selector: '#cooper-planned-session',
      })
    ).toHaveValue(sessionId);
    await waitFor(() =>
      expect(
        screen.getByLabelText('Date', {
          selector: '#cooper-attempt-date',
        })
      ).toHaveValue('2026-09-27')
    );
    fireEvent.change(screen.getByLabelText('12-minute distance (m)'), {
      target: { value: '2512' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record Test' }));
    await waitFor(() =>
      expect(createCooperRunAttempt).toHaveBeenCalledWith({
        attempt_date: '2026-09-27',
        distance_meters: 2512,
        planned_session_id: sessionId,
      })
    );
  });

  it('records a standalone sprint attempt when planned assessments fail to load', async () => {
    const sessionId = '00000000-0000-4000-a000-000000000099';
    window.history.replaceState(
      {},
      '',
      `/cardio-tests?planned_session_id=${sessionId}&protocol=sprint_6s`
    );
    jest
      .mocked(getTrainingPrograms)
      .mockRejectedValueOnce(new Error('Unavailable'));
    renderWithClient(<CooperRunTests />);
    const form = screen.getByRole('region', {
      name: '5 × 6-second sprint (54-second rests)',
    });
    const selection = within(form).getByLabelText('Planned assessment');
    await waitFor(() => expect(selection).toHaveValue(''));
    fireEvent.change(within(form).getByLabelText('Date'), {
      target: { value: '2026-10-14' },
    });
    [900, 800, 700, 600, 500].forEach((value, index) =>
      fireEvent.change(
        within(form).getByLabelText(`Effort ${index + 1} peak (W)`),
        {
          target: { value: String(value) },
        }
      )
    );
    fireEvent.click(
      within(form).getByRole('button', { name: 'Record Sprint' })
    );
    await waitFor(() =>
      expect(saveProtocolAttempt).toHaveBeenCalledWith(
        {
          test_type: 'sprint_6s',
          attempt_date: '2026-10-14',
          results: { peak_watts: [900, 800, 700, 600, 500] },
        },
        undefined
      )
    );
  });

  it('does not unlink an edited sprint attempt when planned assessments fail to load', async () => {
    mockProtocolRecords = [
      {
        id: '00000000-0000-4000-a000-000000000010',
        user_id: mockActiveUserId,
        test_type: 'sprint_6s',
        planned_session_id: '00000000-0000-4000-a000-000000000099',
        attempt_date: '2026-10-14',
        results: { peak_watts: [900, 800, 700, 600, 500] },
        created_at: '2026-10-14T12:00:00Z',
        updated_at: '2026-10-14T12:00:00Z',
      },
    ];
    jest
      .mocked(getTrainingPrograms)
      .mockRejectedValueOnce(new Error('Unavailable'));
    renderWithClient(<CooperRunTests />);
    const sprint = screen.getByRole('region', {
      name: '5 × 6-second sprint (54-second rests)',
    });
    fireEvent.click(
      await within(sprint).findByRole('button', { name: 'Edit' })
    );
    await waitFor(() =>
      expect(within(sprint).getByRole('alert')).toHaveTextContent(
        'Planned assessments could not be loaded.'
      )
    );
    expect(within(sprint).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(saveProtocolAttempt).not.toHaveBeenCalled();
  });

  it.each([
    {
      protocol: 'sprint_6s' as const,
      title: '5 × 6-second sprint (54-second rests)',
      button: 'Record Sprint',
      labels: [
        'Effort 1 peak (W)',
        'Effort 2 peak (W)',
        'Effort 3 peak (W)',
        'Effort 4 peak (W)',
        'Effort 5 peak (W)',
      ],
      values: [900, 800, 700, 600, 500],
      results: { peak_watts: [900, 800, 700, 600, 500] },
    },
    {
      protocol: 'power_30s' as const,
      title: '2 × 30-second power (60-second rest)',
      button: 'Record 30-second Power',
      labels: [
        'Effort 1 peak (W)',
        'Effort 1 average (W)',
        'Effort 2 peak (W)',
        'Effort 2 average (W)',
      ],
      values: [700, 450, 650, 425],
      results: {
        efforts: [
          { peak_watts: 700, average_watts: 450 },
          { peak_watts: 650, average_watts: 425 },
        ],
      },
    },
  ])(
    'records a scheduled $protocol attempt from its Program link',
    async (test) => {
      const sessionId = '00000000-0000-4000-a000-000000000099';
      window.history.replaceState(
        {},
        '',
        `/cardio-tests?planned_session_id=${sessionId}&protocol=${test.protocol}`
      );
      jest
        .mocked(getTrainingPrograms)
        .mockResolvedValue([scheduledProgram(test.protocol, sessionId)]);
      renderWithClient(<CooperRunTests />);
      const form = screen.getByRole('region', { name: test.title });
      expect(
        screen.queryByRole('heading', { name: 'Cooper Run Test' })
      ).toBeNull();
      await within(form).findByRole('option', {
        name: /Autumn base · Baseline · Baseline test/,
      });
      expect(within(form).getByLabelText('Planned assessment')).toHaveValue(
        sessionId
      );
      await waitFor(() =>
        expect(within(form).getByLabelText('Date')).toHaveValue('2026-09-27')
      );
      test.labels.forEach((label, index) =>
        fireEvent.change(within(form).getByLabelText(label), {
          target: { value: String(test.values[index]) },
        })
      );
      fireEvent.click(within(form).getByRole('button', { name: test.button }));
      await waitFor(() =>
        expect(saveProtocolAttempt).toHaveBeenCalledWith(
          {
            test_type: test.protocol,
            attempt_date: '2026-09-27',
            results: test.results,
            planned_session_id: sessionId,
          },
          undefined
        )
      );
    }
  );

  it('records both power protocols and shows their dated graph and results', async () => {
    renderWithClient(<CooperRunTests />);
    const sprint = screen.getByRole('region', {
      name: '5 × 6-second sprint (54-second rests)',
    });
    expect(within(sprint).getByLabelText('Effort 1 peak (W)')).toHaveAttribute(
      'inputmode',
      'decimal'
    );
    fireEvent.change(within(sprint).getByLabelText('Date'), {
      target: { value: '2026-10-01' },
    });
    [900, 800, 700, 600, 500].forEach((value, index) =>
      fireEvent.change(
        within(sprint).getByLabelText(`Effort ${index + 1} peak (W)`),
        { target: { value: String(value) } }
      )
    );
    fireEvent.click(
      within(sprint).getByRole('button', { name: 'Record Sprint' })
    );
    await waitFor(() =>
      expect(saveProtocolAttempt).toHaveBeenCalledWith(
        {
          test_type: 'sprint_6s',
          attempt_date: '2026-10-01',
          results: { peak_watts: [900, 800, 700, 600, 500] },
        },
        undefined
      )
    );
    expect(
      await within(sprint).findByText(/Drop-off: 400 W \(44\.4%\)/)
    ).toBeInTheDocument();
    expect(
      within(sprint).getByRole('img', { name: /sprint.*trend by date/ })
    ).toBeInTheDocument();

    const thirty = screen.getByRole('region', {
      name: '2 × 30-second power (60-second rest)',
    });
    fireEvent.change(within(thirty).getByLabelText('Date'), {
      target: { value: '2026-10-02' },
    });
    [
      'Effort 1 peak (W)',
      'Effort 1 average (W)',
      'Effort 2 peak (W)',
      'Effort 2 average (W)',
    ].forEach((label, index) =>
      fireEvent.change(within(thirty).getByLabelText(label), {
        target: { value: String([700, 450, 650, 425][index]) },
      })
    );
    fireEvent.click(
      within(thirty).getByRole('button', { name: 'Record 30-second Power' })
    );
    await waitFor(() =>
      expect(saveProtocolAttempt).toHaveBeenCalledWith(
        {
          test_type: 'power_30s',
          attempt_date: '2026-10-02',
          results: {
            efforts: [
              { peak_watts: 700, average_watts: 450 },
              { peak_watts: 650, average_watts: 425 },
            ],
          },
        },
        undefined
      )
    );
    expect(
      await within(thirty).findByText('700/450 W · 650/425 W')
    ).toBeInTheDocument();
    expect(
      within(thirty).getByRole('img', { name: /power.*trend by date/ })
    ).toBeInTheDocument();
    expect(getProtocolAttempts).toHaveBeenCalledWith('sprint_6s');
    expect(getProtocolAttempts).toHaveBeenCalledWith('power_30s');
  });

  it('accepts decimal commas on the web power forms used on iPhone', async () => {
    renderWithClient(<CooperRunTests />);
    const sprint = screen.getByRole('region', {
      name: '5 × 6-second sprint (54-second rests)',
    });
    fireEvent.change(within(sprint).getByLabelText('Date'), {
      target: { value: '2026-10-01' },
    });
    ['900,5', '800', '700', '600', '500'].forEach((value, index) =>
      fireEvent.change(
        within(sprint).getByLabelText(`Effort ${index + 1} peak (W)`),
        { target: { value } }
      )
    );
    fireEvent.click(
      within(sprint).getByRole('button', { name: 'Record Sprint' })
    );
    await waitFor(() =>
      expect(saveProtocolAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          test_type: 'sprint_6s',
          results: { peak_watts: [900.5, 800, 700, 600, 500] },
        }),
        undefined
      )
    );

    const thirty = screen.getByRole('region', {
      name: '2 × 30-second power (60-second rest)',
    });
    fireEvent.change(within(thirty).getByLabelText('Date'), {
      target: { value: '2026-10-02' },
    });
    [
      ['Effort 1 peak (W)', '700,5'],
      ['Effort 1 average (W)', '450,5'],
      ['Effort 2 peak (W)', '650'],
      ['Effort 2 average (W)', '425,5'],
    ].forEach(([label, value]) =>
      fireEvent.change(within(thirty).getByLabelText(label!), {
        target: { value },
      })
    );
    fireEvent.click(
      within(thirty).getByRole('button', { name: 'Record 30-second Power' })
    );
    await waitFor(() =>
      expect(saveProtocolAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          test_type: 'power_30s',
          results: {
            efforts: [
              { peak_watts: 700.5, average_watts: 450.5 },
              { peak_watts: 650, average_watts: 425.5 },
            ],
          },
        }),
        undefined
      )
    );
  });

  it('records a dated distance, shows the trend and history, and edits an attempt', async () => {
    mockServer.records = [
      {
        id: 'earlier',
        user_id: mockActiveUserId,
        test_type: 'cooper_run',
        planned_session_id: null,
        attempt_date: '2026-09-20',
        distance_meters: 2400,
        created_at: '2026-09-20T12:00:00Z',
        updated_at: '2026-09-20T12:00:00Z',
      },
    ];
    renderWithClient(<CooperRunTests />);
    fireEvent.change(screen.getAllByLabelText('Date')[0]!, {
      target: { value: '2026-09-22' },
    });
    fireEvent.change(screen.getByLabelText('12-minute distance (m)'), {
      target: { value: '2512' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record Test' }));
      await waitFor(() =>
        expect(createCooperRunAttempt).toHaveBeenCalledWith({
          attempt_date: '2026-09-22',
          distance_meters: 2512,
          planned_session_id: null,
        })
      );
    });

    expect(await screen.findByText('2,512 m')).toBeInTheDocument();
    await waitFor(() =>
      expectTrend(['2026-09-20', '2026-09-22'], [2400, 2512])
    );

    fireEvent.click(
      within(screen.getByText('2,512 m').closest('li')!).getByRole('button', {
        name: 'Edit',
      })
    );
    fireEvent.change(screen.getAllByLabelText('Date')[0]!, {
      target: { value: '2026-09-23' },
    });
    fireEvent.change(screen.getByLabelText('12-minute distance (m)'), {
      target: { value: '2600' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateCooperRunAttempt).toHaveBeenCalledWith(
        '00000000-0000-4000-a000-000000000010',
        {
          attempt_date: '2026-09-23',
          distance_meters: 2600,
          planned_session_id: null,
        }
      )
    );
    expect(
      await within(
        screen.getByRole('list', { name: 'Test Attempt History' })
      ).findByText('2,600 m')
    ).toBeInTheDocument();
    await waitFor(() =>
      expectTrend(['2026-09-20', '2026-09-23'], [2400, 2600])
    );
  });

  it.each(['create', 'update'] as const)(
    'starts a clean form on profile switch and preserves the new draft after an old %s completes',
    async (mode) => {
      const existing: CooperRunAttempt = {
        id: 'old-attempt',
        user_id: mockActiveUserId,
        test_type: 'cooper_run',
        planned_session_id: null,
        attempt_date: '2026-09-22',
        distance_meters: 2512,
        created_at: '2026-09-22T12:00:00Z',
        updated_at: '2026-09-22T12:00:00Z',
      };
      mockServer.records = [existing];
      const { promise, resolve: finishSave } = deferred<CooperRunAttempt>();
      const mutation =
        mode === 'create' ? createCooperRunAttempt : updateCooperRunAttempt;
      jest.mocked(mutation).mockImplementationOnce(() => promise);
      const view = renderWithClient(<CooperRunTests />);
      if (mode === 'update')
        fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
      fireEvent.change(screen.getAllByLabelText('Date')[0]!, {
        target: { value: '2026-09-22' },
      });
      fireEvent.change(screen.getByLabelText('12-minute distance (m)'), {
        target: { value: '2512' },
      });
      fireEvent.click(
        screen.getByRole('button', {
          name: mode === 'update' ? 'Save' : 'Record Test',
        })
      );
      await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));

      mockActiveUserId = '00000000-0000-4000-a000-000000000002';
      view.rerender(<CooperRunTests />);
      expect(screen.getAllByLabelText('Date')[0]!).toHaveValue('');
      expect(screen.getByLabelText('12-minute distance (m)')).toHaveValue(null);
      fireEvent.change(screen.getAllByLabelText('Date')[0]!, {
        target: { value: '2026-10-01' },
      });
      fireEvent.change(screen.getByLabelText('12-minute distance (m)'), {
        target: { value: '2800' },
      });
      await act(async () => {
        finishSave({
          id: 'old-attempt',
          user_id: 'old-user',
          test_type: 'cooper_run',
          planned_session_id: null,
          attempt_date: '2026-09-22',
          distance_meters: 2512,
          created_at: '2026-09-22T12:00:00Z',
          updated_at: '2026-09-22T12:00:00Z',
        });
      });
      expect(screen.getAllByLabelText('Date')[0]!).toHaveValue('2026-10-01');
      expect(screen.getByLabelText('12-minute distance (m)')).toHaveValue(2800);
      expect(screen.getByRole('button', { name: 'Record Test' })).toBeEnabled();
    }
  );

  it.each(['create', 'update'] as const)(
    'locks the draft and prevents overlapping %s saves',
    async (mode) => {
      const existing: CooperRunAttempt = {
        id: 'existing',
        user_id: mockActiveUserId,
        test_type: 'cooper_run',
        planned_session_id: null,
        attempt_date: '2026-09-20',
        distance_meters: 2400,
        created_at: '2026-09-20T12:00:00Z',
        updated_at: '2026-09-20T12:00:00Z',
      };
      mockServer.records = [existing];
      const { promise, resolve } = deferred<CooperRunAttempt>();
      if (mode === 'create')
        jest
          .mocked(createCooperRunAttempt)
          .mockImplementationOnce(() => promise);
      else
        jest
          .mocked(updateCooperRunAttempt)
          .mockImplementationOnce(() => promise);
      renderWithClient(<CooperRunTests />);
      const edit = await screen.findByRole('button', { name: 'Edit' });
      if (mode === 'update') fireEvent.click(edit);
      else {
        fireEvent.change(screen.getAllByLabelText('Date')[0]!, {
          target: { value: '2026-09-22' },
        });
        fireEvent.change(screen.getByLabelText('12-minute distance (m)'), {
          target: { value: '2512' },
        });
      }
      fireEvent.click(
        screen.getByRole('button', {
          name: mode === 'update' ? 'Save' : 'Record Test',
        })
      );
      await screen.findByRole('button', { name: 'Saving…' });
      expect(screen.getAllByLabelText('Date')[0]!).toBeDisabled();
      expect(screen.getByLabelText('12-minute distance (m)')).toBeDisabled();
      expect(edit).toBeDisabled();
      if (mode === 'update') {
        const cancel = screen.getByRole('button', { name: 'Cancel' });
        expect(cancel).toBeDisabled();
        fireEvent.click(cancel);
      }
      fireEvent.click(edit);
      fireEvent.submit(screen.getAllByLabelText('Date')[0]!.closest('form')!);
      expect(createCooperRunAttempt).toHaveBeenCalledTimes(
        mode === 'create' ? 1 : 0
      );
      expect(updateCooperRunAttempt).toHaveBeenCalledTimes(
        mode === 'update' ? 1 : 0
      );
      await act(async () => {
        resolve(existing);
      });
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Record Test' })
        ).toBeEnabled()
      );
      fireEvent.change(screen.getByLabelText('12-minute distance (m)'), {
        target: { value: '2900' },
      });
      expect(screen.getByLabelText('12-minute distance (m)')).toHaveValue(2900);
    }
  );
});
