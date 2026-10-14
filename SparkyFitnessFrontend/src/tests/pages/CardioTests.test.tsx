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
} from '@workspace/shared';
import CooperRunTests from '@/pages/CardioTests/CooperRunTests';
import {
  createCooperRunAttempt,
  updateCooperRunAttempt,
} from '@/api/CardioTests/cardioTests';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}));
const mockServer = { records: [] as CooperRunAttempt[] };
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
  getCooperRunAttempts: jest.fn(async () => mockServer.records),
  createCooperRunAttempt: jest.fn(async (input: CooperRunAttemptInput) => {
    const timestamp = '2026-10-09T12:00:00.000Z';
    const attempt: CooperRunAttempt = {
      id: '00000000-0000-4000-a000-000000000010',
      user_id: '00000000-0000-4000-a000-000000000001',
      test_type: 'cooper_run',
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

describe('Cooper run Test Attempts', () => {
  beforeEach(() => {
    mockServer.records = [];
    jest.clearAllMocks();
    mockActiveUserId = '00000000-0000-4000-a000-000000000001';
  });

  it('records a dated distance, shows the trend and history, and edits an attempt', async () => {
    mockServer.records = [
      {
        id: 'earlier',
        user_id: mockActiveUserId,
        test_type: 'cooper_run',
        attempt_date: '2026-09-20',
        distance_meters: 2400,
        created_at: '2026-09-20T12:00:00Z',
        updated_at: '2026-09-20T12:00:00Z',
      },
    ];
    renderWithClient(<CooperRunTests />);
    fireEvent.change(screen.getByLabelText('Date'), {
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
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2026-09-23' },
    });
    fireEvent.change(screen.getByLabelText('12-minute distance (m)'), {
      target: { value: '2600' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateCooperRunAttempt).toHaveBeenCalledWith(
        '00000000-0000-4000-a000-000000000010',
        { attempt_date: '2026-09-23', distance_meters: 2600 }
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
      fireEvent.change(screen.getByLabelText('Date'), {
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
      expect(screen.getByLabelText('Date')).toHaveValue('');
      expect(screen.getByLabelText('12-minute distance (m)')).toHaveValue(null);
      fireEvent.change(screen.getByLabelText('Date'), {
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
          attempt_date: '2026-09-22',
          distance_meters: 2512,
          created_at: '2026-09-22T12:00:00Z',
          updated_at: '2026-09-22T12:00:00Z',
        });
      });
      expect(screen.getByLabelText('Date')).toHaveValue('2026-10-01');
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
        fireEvent.change(screen.getByLabelText('Date'), {
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
      expect(screen.getByLabelText('Date')).toBeDisabled();
      expect(screen.getByLabelText('12-minute distance (m)')).toBeDisabled();
      expect(edit).toBeDisabled();
      if (mode === 'update') {
        const cancel = screen.getByRole('button', { name: 'Cancel' });
        expect(cancel).toBeDisabled();
        fireEvent.click(cancel);
      }
      fireEvent.click(edit);
      fireEvent.submit(screen.getByLabelText('Date').closest('form')!);
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
