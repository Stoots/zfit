import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MealCard from '@/pages/Diary/MealCard';
import type { FoodEntry } from '@/types/food';

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);
jest.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    loggingLevel: 'SILENT',
    timeFormat: '24h',
    getDateRelationToToday: () => 'today',
    nutrientDisplayPreferences: [
      {
        view_group: 'quick_info',
        platform: 'mobile',
        visible_nutrients: [
          'calories',
          'protein',
          'carbs',
          'fat',
          'dietary_fiber',
          'sugars',
          'caffeine_mg',
          'alcohol_g',
        ],
      },
    ],
  }),
}));
jest.mock('@/hooks/Diary/useFoodEntries', () => ({
  useCopyFoodEntriesFromYesterdayMutation: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/components/FoodSearch/FoodSearch', () => () => null);
jest.mock('@/components/AllergenBadges', () => () => null);
jest.mock('@/components/ImageLightbox', () => () => null);

it('keeps all configured totals and keyboard entry actions available in compact rows', async () => {
  const entry: FoodEntry = {
    id: 'oats',
    food_name: 'Rolled oats',
    meal_type: 'breakfast',
    quantity: 67,
    unit: 'g',
    entry_date: '2026-10-15',
    entry_time: '07:30',
  };
  const totals = {
    calories: 261,
    protein: 9,
    carbs: 44,
    fat: 5,
    dietary_fiber: 7,
    sugars: 2,
    caffeine_mg: 0,
    alcohol_g: 0,
  };
  const edit = jest.fn();
  const remove = jest.fn().mockResolvedValue(undefined);
  const { container } = render(
    <MemoryRouter>
      <MealCard
        meal={{
          name: 'Breakfast',
          type: 'breakfast',
          entries: [entry],
          selectedDate: entry.entry_date,
        }}
        totals={totals}
        selectedDate={entry.entry_date}
        onFoodSelect={jest.fn()}
        onEditEntry={edit}
        onRemoveEntry={remove}
        getEntryNutrition={() => totals}
        onCopyClick={jest.fn()}
        onCopyFamilyClick={jest.fn()}
        onConvertToMealClick={jest.fn()}
        energyUnit="kcal"
        convertEnergy={(value) => value}
      />
    </MemoryRouter>
  );
  const totalList = container.querySelector('dl')!;
  expect(totalList.querySelectorAll('dt')).toHaveLength(8);
  for (const label of ['Carbohydrates', 'Dietary Fiber', 'Caffeine']) {
    expect(within(totalList).getByText(label)).toBeInTheDocument();
  }
  const actions = screen.getByRole('button', {
    name: 'Actions for Rolled oats',
  });
  actions.focus();
  fireEvent.keyDown(actions, { key: 'Enter' });
  let menu = await screen.findByRole('menu');
  expect(within(menu).getByText('Caffeine')).toBeInTheDocument();
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }));
  expect(edit).toHaveBeenCalledWith(entry);
  fireEvent.keyDown(actions, { key: 'Enter' });
  menu = await screen.findByRole('menu');
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
  expect(remove).toHaveBeenCalledWith('oats', 'foodEntry');
});
