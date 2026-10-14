import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import HomeDashboardFasting from '@/pages/CheckIn/HomeDashboardFasting';

const mockRefetch = jest.fn();
let mockFast: {
  id: string;
  start_time: string;
  target_end_time: string;
  is_eating_window?: boolean;
} | null;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, arg?: unknown) =>
      typeof arg === 'string'
        ? arg
        : ((arg as { defaultValue?: string } | undefined)?.defaultValue ?? key),
  }),
}));
jest.mock('@/hooks/Fasting/useFasting', () => ({
  useCurrentFast: () => ({
    data: mockFast,
    isLoading: false,
    refetch: mockRefetch,
  }),
  useStartFastMutation: () => ({ mutateAsync: jest.fn() }),
  useEndFastMutation: () => ({ mutate: jest.fn() }),
  useFastingStats: () => ({
    data: { total_completed_fasts: 4, average_duration_minutes: 960 },
  }),
}));
jest.mock('@/pages/Fasting/FastingZoneBar', () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock('@/pages/Fasting/EatingWindowBar', () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock('@/pages/Fasting/EndFastDialog', () => ({
  __esModule: true,
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div>End fast dialog</div> : null,
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-15T08:00:00Z'));
  mockFast = {
    id: 'fast',
    start_time: '2026-10-15T00:00:00Z',
    target_end_time: '2026-10-15T16:00:00Z',
  };
  mockRefetch.mockClear();
});
afterEach(() => jest.useRealTimers());

test('keeps elapsed seconds and target progress live in the row presentation', () => {
  render(<HomeDashboardFasting />);
  expect(screen.getByText('08:00:00')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '50'
  );
  act(() => jest.advanceTimersByTime(1000));
  expect(screen.getByText('08:00:01')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'End Fast' }));
  expect(screen.getByText('End fast dialog')).toBeInTheDocument();
});

test('caps progress at the target while elapsed time continues', () => {
  jest.setSystemTime(new Date('2026-10-15T18:00:00Z'));
  render(<HomeDashboardFasting />);
  expect(screen.getByText('18:00:00')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '100'
  );
});

test('retains the eating-window countdown and refresh at its end', () => {
  mockFast = {
    ...mockFast!,
    is_eating_window: true,
    target_end_time: '2026-10-15T08:01:00Z',
  };
  render(<HomeDashboardFasting />);
  expect(screen.getByText('0h 1m')).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(60000));
  expect(screen.getByText('0h 0m')).toBeInTheDocument();
  expect(mockRefetch).toHaveBeenCalled();
});
