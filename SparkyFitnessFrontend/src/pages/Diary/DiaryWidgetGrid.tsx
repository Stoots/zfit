import type { ComponentType, ReactNode } from 'react';
import WidgetGrid from '@/components/widgets/WidgetGrid';
import {
  generateDefaultLayouts,
  GRID_COLS,
  type Breakpoint,
  isMealWidgetKey,
  type DashboardLayouts,
} from '@/utils/dashboardLayout';

export interface DiaryWidget {
  key: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  render: () => ReactNode;
}

interface DiaryWidgetGridProps {
  widgets: DiaryWidget[];
  toolbarContainer?: HTMLElement | null;
}

const PAGE_KEY = 'diary';

const diaryDefaultLayouts = (widgetKeys: string[]): DashboardLayouts => {
  const meals = widgetKeys.filter(isMealWidgetKey);
  const layouts = generateDefaultLayouts(meals);
  const order = [
    'energy',
    'exercise',
    ...meals,
    'water',
    'caffeine',
    'nutrition',
    'healthMetrics',
  ];
  // Only the default changes; WidgetGrid still reconciles saved positions verbatim.
  for (const breakpoint of Object.keys(layouts) as Breakpoint[]) {
    const columns = GRID_COLS[breakpoint];
    let y = 0;
    layouts[breakpoint] = order.flatMap((key, index) => {
      const item = layouts[breakpoint].find((tile) => tile.i === key);
      if (!item) return [];
      const pairedHero =
        (breakpoint === 'lg' || breakpoint === 'md') && index < 2;
      const h =
        key === 'energy' || key === 'exercise'
          ? 7
          : isMealWidgetKey(key)
            ? 4
            : 5;
      const tile = {
        ...item,
        x: pairedHero ? index * (columns / 2) : 0,
        y,
        w: pairedHero ? columns / 2 : columns,
        h,
        minH: 2,
      };
      if (!pairedHero || index === 1) y += h;
      return [tile];
    });
  }
  return layouts;
};

const DiaryWidgetGrid = ({
  widgets,
  toolbarContainer,
}: DiaryWidgetGridProps) => (
  <WidgetGrid
    pageKey={PAGE_KEY}
    widgets={widgets}
    generateDefaultLayouts={diaryDefaultLayouts}
    toolbarContainer={toolbarContainer}
  />
);

export default DiaryWidgetGrid;
