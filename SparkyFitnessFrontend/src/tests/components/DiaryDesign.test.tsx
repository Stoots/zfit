import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import DayNavigator from '@/components/DayNavigator';
import DiaryWidgetGrid from '@/pages/Diary/DiaryWidgetGrid';
import WidgetGrid from '@/components/widgets/WidgetGrid';
import { EnergyCircle } from '@/pages/Diary/EnergyProgressCircle';
import { reconcileLayouts } from '@/utils/dashboardLayout';

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    formatDate: () => 'Oct 15, 2026',
    getDateRelationToToday: () => 'today',
    parseDateInUserTimezone: () => new Date(2026, 9, 15),
    timezone: 'UTC',
    loggingLevel: 'SILENT',
  }),
}));

jest.mock('@/utils/nutritionCalculations', () => ({
  getEnergyUnitString: (unit: string) => unit,
}));

jest.mock('@/components/widgets/WidgetGrid', () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));
jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);

it('orders the default diary around the budget, training and meals without changing saved positions', () => {
  render(<DiaryWidgetGrid widgets={[]} />);
  const props = jest.mocked(WidgetGrid).mock.calls[0]![0];
  const keys = [
    'energy',
    'nutrition',
    'water',
    'meal:breakfast',
    'exercise',
    'caffeine',
    'healthMetrics',
  ];
  const defaults = props.generateDefaultLayouts(keys);
  expect(defaults.xs.map(({ i }) => i)).toEqual([
    'energy',
    'exercise',
    'meal:breakfast',
    'water',
    'caffeine',
    'nutrition',
    'healthMetrics',
  ]);
  for (const layout of Object.values(defaults)) {
    expect(new Set(layout.map(({ i }) => i))).toEqual(new Set(keys));
    for (const tile of layout) {
      for (const other of layout.filter(({ i }) => i !== tile.i)) {
        expect(
          tile.x + tile.w <= other.x ||
            other.x + other.w <= tile.x ||
            tile.y + tile.h <= other.y ||
            other.y + other.h <= tile.y
        ).toBe(true);
      }
    }
  }
  const custom = {
    ...defaults,
    xs: defaults.xs.map((tile) => ({ ...tile, y: tile.y + 100 })),
  };
  expect(reconcileLayouts(custom, keys, defaults)).toEqual(custom);
});

it('keeps negative and zero budgets, energy units and target bands readable without a ring', () => {
  const { container, rerender } = render(
    <EnergyCircle
      remaining={-125}
      progress={110}
      unit="kJ"
      subline="of 8,000 · 8,125 eaten"
      targetBand={{ min: 7500, max: 8000, eaten: 8125 }}
    />
  );
  expect(screen.getByText('-125')).toBeInTheDocument();
  expect(screen.getByText('kJ remaining')).toBeInTheDocument();
  expect(screen.getByText('target 7500–8000')).toBeInTheDocument();
  expect(container.querySelector('svg')).toBeNull();
  rerender(
    <EnergyCircle
      remaining={0}
      progress={100}
      unit="kcal"
      targetBand={{ min: 1800, max: 2200, eaten: 2000 }}
    />
  );
  expect(screen.getByText('0')).toBeInTheDocument();
  expect(screen.getByText('target 1800–2200')).toHaveClass('text-success');
});

it('shows Today in the diary stepper while retaining previous and next day navigation', () => {
  const changeDate = jest.fn();
  render(
    <DayNavigator
      selectedDate="2026-10-15"
      onDateChange={changeDate}
      showTodayLabel
    />
  );
  expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
  expect(changeDate).toHaveBeenLastCalledWith('2026-10-14');
  fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
  expect(changeDate).toHaveBeenLastCalledWith('2026-10-16');
});
