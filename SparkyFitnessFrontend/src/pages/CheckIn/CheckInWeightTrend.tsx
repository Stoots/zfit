import { useTranslation } from 'react-i18next';
import { addDays } from '@workspace/shared';
import { useAuth } from '@/hooks/useAuth';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useRecentStandardMeasurements } from '@/hooks/CheckIn/useCheckIn';
import { useProfileQuery } from '@/hooks/Settings/useProfile';
import { Card } from '@/components/ui/card';
import { Numeral } from '@/components/ui/numeral';
import { TrendChart } from '@/components/ui/trend-chart';
import { Skeleton } from '@/components/ui/skeleton';
import { weightTrend } from './weightTrend';

export function CheckInWeightTrend({
  selectedDate,
  photoDates,
}: {
  selectedDate: string;
  photoDates: string[];
}) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { activeUserId } = useActiveUser();
  const { weightUnit, convertWeight } = usePreferences();
  const {
    data = [],
    isPending,
    isError,
  } = useRecentStandardMeasurements(addDays(selectedDate, -59), selectedDate);
  const { data: profile } = useProfileQuery(activeUserId || user?.id);
  const unit = weightUnit === 'st_lbs' ? 'lbs' : weightUnit;
  const convert = (value: number) => convertWeight(value, 'kg', unit);
  const format = (value: number, signed = false) =>
    new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      signDisplay: signed ? 'exceptZero' : 'auto',
    }).format(value);
  const trend = weightTrend(data, selectedDate);
  const goal = Number(profile?.target_weight);
  const points = trend.points.map((point) => ({
    ...point,
    value: point.value === null ? null : convert(point.value),
  }));
  const days = new Set(points.map((point) => point.label));

  return (
    <Card className="rounded-3xl p-4 sm:p-6">
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-center">
        <div className="min-w-0 space-y-3">
          <h2 className="text-xl font-semibold">
            {t('checkIn.trendWeight.title', 'Trend weight')}
          </h2>
          {isPending ? (
            <Skeleton className="h-24 w-48" />
          ) : (
            <Numeral
              value={
                isError || trend.current === null
                  ? null
                  : convert(trend.current)
              }
              unit={unit}
              unitPosition="beside"
              formatOptions={{
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }}
              subline={
                isError
                  ? t(
                      'checkIn.failedToLoadRecentStandard',
                      'Failed to load recent standard measurements.'
                    )
                  : trend.delta !== null
                    ? t('checkIn.trendWeight.monthlyDelta', {
                        delta: format(convert(trend.delta), true),
                        unit,
                        defaultValue: '{{delta}} {{unit}} this month',
                      })
                    : t(
                        'checkIn.trendWeight.noComparison',
                        'Log weight in both 30-day periods to see the change.'
                      )
              }
            />
          )}
          <p className="text-sm text-muted-foreground">
            {t(
              'checkIn.trendWeight.method',
              'Average of logged weights over 30 days, compared with the previous 30 days.'
            )}
          </p>
        </div>
        <div className="min-w-0">
          <TrendChart
            data={isError ? [] : points}
            label={t('checkIn.trendWeight.chart', 'Weight trend · 30 days')}
            valueLabel={t('checkIn.trendWeight.title', 'Trend weight')}
            target={
              Number.isFinite(goal) && goal > 0
                ? {
                    value: convert(goal),
                    label: t('checkIn.trendWeight.goal', 'Goal weight'),
                  }
                : undefined
            }
            events={photoDates
              .filter((day) => days.has(day))
              .map((day) => ({
                at: day,
                label: t('checkIn.photos.calendarLegend', 'Progress photos'),
              }))}
            formatValue={(value) => `${format(value)} ${unit}`}
          />
        </div>
      </div>
    </Card>
  );
}
