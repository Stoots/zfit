import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { CheckInWeightTrend } from '@/pages/CheckIn/CheckInWeightTrend';
import { weightTrend } from '@/pages/CheckIn/weightTrend';

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);

let mockRows: { entry_date: string; weight: number | null }[] = [];
let mockActiveUser: string | undefined;
let mockPending = false;
let mockError = false;
let mockUnit = 'kg';
const mockProfile = jest.fn();
const mockMeasurements = jest.fn();
const mockChart = jest.fn();
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'owner' } }),
}));
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({ activeUserId: mockActiveUser }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    weightUnit: mockUnit,
    convertWeight: (weight: number, _from: string, to: string) =>
      to === 'lbs' ? weight * 2.2046226218 : weight,
  }),
}));
jest.mock('@/hooks/CheckIn/useCheckIn', () => ({
  useRecentStandardMeasurements: (startDate: string, endDate: string) => {
    mockMeasurements(startDate, endDate);
    return { data: mockRows, isPending: mockPending, isError: mockError };
  },
}));
jest.mock('@/hooks/Settings/useProfile', () => ({
  useProfileQuery: (userId?: string) => {
    mockProfile(userId);
    return { data: userId ? { target_weight: 70 } : undefined };
  },
}));
jest.mock('@/components/ui/trend-chart', () => ({
  TrendChart: (props: unknown) => {
    mockChart(props);
    return <div data-testid="trend-chart" />;
  },
}));

beforeEach(() => {
  mockRows = [];
  mockActiveUser = undefined;
  mockPending = false;
  mockError = false;
  mockUnit = 'kg';
  jest.clearAllMocks();
});

test('averages only recorded weights in two adjacent 30-calendar-day periods', () => {
  const rows = [
    { entry_date: '2026-10-15', weight: 79 },
    { entry_date: '2026-09-16', weight: 81 },
    { entry_date: '2026-10-09', weight: null },
    { entry_date: '2026-09-15', weight: 82 },
    { entry_date: '2026-08-17', weight: 84 },
    { entry_date: '2026-08-16', weight: 200 },
    { entry_date: '2026-10-16', weight: 200 },
  ];
  expect(weightTrend(rows, '2026-10-15')).toMatchObject({
    current: 80,
    delta: -3,
  });
  expect(weightTrend(rows, '2026-10-15').points.at(-1)).toEqual({
    label: '2026-10-15',
    value: 80,
  });
  expect(
    weightTrend(rows, '2026-10-15').points.find(
      (point) => point.label === '2026-10-09'
    )?.value
  ).toBeNull();
});

test('does not invent a trend or monthly change when either period lacks data', () => {
  expect(weightTrend([], '2026-10-15')).toMatchObject({
    current: null,
    delta: null,
  });
  expect(
    weightTrend([{ entry_date: '2026-10-15', weight: 80 }], '2026-10-15')
  ).toMatchObject({ current: 80, delta: null });
  expect(
    weightTrend([{ entry_date: '2026-09-15', weight: 80 }], '2026-10-15')
  ).toMatchObject({ current: null, delta: null });
  expect(
    weightTrend([{ entry_date: '2026-10-15', weight: NaN }], '2026-10-15')
      .current
  ).toBeNull();
});

test('handles month boundaries and zero without altering the source rows', () => {
  const rows = [
    { entry_date: '2026-03-31', weight: 0 },
    { entry_date: '2026-03-02', weight: 1 },
  ];
  const original = structuredClone(rows);
  expect(weightTrend(rows, '2026-04-01')).toMatchObject({
    current: 0,
    delta: -1,
  });
  expect(rows).toEqual(original);
});

test('plots real photo events and the goal in the same display units as the numeral', () => {
  mockRows = [{ entry_date: '2026-10-15', weight: 80 }];
  mockUnit = 'st_lbs';
  render(
    <CheckInWeightTrend
      selectedDate="2026-10-15"
      photoDates={['2026-10-12', '2026-01-01']}
    />
  );
  expect(screen.getByText('176.4')).toBeInTheDocument();
  expect(screen.getByText('lbs')).toBeInTheDocument();
  expect(mockChart).toHaveBeenLastCalledWith(
    expect.objectContaining({
      target: expect.objectContaining({ value: expect.closeTo(154.3236, 3) }),
      events: [{ at: '2026-10-12', label: 'Progress photos' }],
      data: expect.arrayContaining([
        { label: '2026-10-15', value: expect.closeTo(176.3698, 3) },
      ]),
    })
  );
});

test('keys the profile by the active person, matching the server session context', () => {
  mockActiveUser = 'delegate-target';
  render(<CheckInWeightTrend selectedDate="2026-10-15" photoDates={[]} />);
  expect(mockProfile).toHaveBeenCalledWith('delegate-target');
  expect(mockChart).toHaveBeenLastCalledWith(
    expect.objectContaining({ target: { value: 70, label: 'Goal weight' } })
  );
});

test('shows an error instead of presenting a failed query as a recorded weight', () => {
  mockError = true;
  mockRows = [{ entry_date: '2026-10-15', weight: 80 }];
  render(<CheckInWeightTrend selectedDate="2026-10-15" photoDates={[]} />);
  expect(screen.getByText('—')).toBeInTheDocument();
  expect(
    screen.getByText('Failed to load recent standard measurements.')
  ).toBeInTheDocument();
});

test('requests both 30-day periods and explains the monthly comparison', () => {
  mockRows = [
    { entry_date: '2026-08-17', weight: 84 },
    { entry_date: '2026-09-16', weight: 80 },
  ];
  render(<CheckInWeightTrend selectedDate="2026-10-15" photoDates={[]} />);
  expect(mockMeasurements).toHaveBeenCalledWith('2026-08-17', '2026-10-15');
  expect(screen.getByText('-4.0 kg this month')).toBeInTheDocument();
  expect(
    screen.getByText(
      'Average of logged weights over 30 days, compared with the previous 30 days.'
    )
  ).toBeInTheDocument();
});

test('explains that both 30-day periods need logged weights when comparison is unavailable', () => {
  render(<CheckInWeightTrend selectedDate="2026-10-15" photoDates={[]} />);
  expect(
    screen.getByText('Log weight in both 30-day periods to see the change.')
  ).toBeInTheDocument();
});
