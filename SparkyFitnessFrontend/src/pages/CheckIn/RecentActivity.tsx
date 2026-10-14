import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trash2, ClipboardList, Pencil } from 'lucide-react';

import { Timer, Activity } from 'lucide-react';
import {
  MeasurementUnit,
  usePreferences,
  WeightUnit,
} from '@/contexts/PreferencesContext';
import { useTranslation } from 'react-i18next';
import { CombinedMeasurement } from '@/types/checkin';
import { formatWeight, formatHeight } from '@/utils/numberFormatting';
import { healthMetricLabel } from '@/utils/healthMetricLabels';

interface RecentActivityProps {
  convertMeasurement: (
    value: number,
    fromUnit: MeasurementUnit,
    toUnit: MeasurementUnit
  ) => number;
  convertWeight: (
    value: number,
    fromUnit: WeightUnit,
    toUnit: WeightUnit
  ) => number;
  handleDeleteMeasurementClick: (
    measurement: CombinedMeasurement
  ) => Promise<void>;
  recentMeasurements: CombinedMeasurement[];
  shouldConvertCustomMeasurement: (unit: string) => boolean;
  handleEditFastClick?: (measurement: CombinedMeasurement) => void;
  title?: string;
  description?: string;
}

export const RecentActivity: React.FC<RecentActivityProps> = ({
  handleDeleteMeasurementClick,
  recentMeasurements,
  shouldConvertCustomMeasurement,
  handleEditFastClick,
  title,
  description,
}) => {
  const {
    weightUnit: defaultWeightUnit,
    measurementUnit: defaultMeasurementUnit,
    measurementDecimalPlaces,
    formatDateInUserTimezone,
    formatTime,
  } = usePreferences();
  const { t } = useTranslation();

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            {title || t('checkIn.recentMeasurements', 'Recent Activity')}
          </CardTitle>
          <CardDescription>
            {description ||
              t(
                'checkIn.recentMeasurementsDescription',
                'Your latest logs including measurements, completed fasts, and synced health data.'
              )}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {recentMeasurements.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {t('checkIn.noRecentActivity', 'No recent activity found.')}
              </div>
            ) : (
              recentMeasurements.map((measurement) => {
                let displayString: string;
                let measurementName = measurement.display_name;

                if (
                  measurement.type === 'custom' &&
                  measurement.custom_categories
                ) {
                  measurementName = healthMetricLabel(
                    measurement.custom_categories.name,
                    measurement.custom_categories.display_name,
                    t
                  );
                  const isConvertible = shouldConvertCustomMeasurement(
                    measurement.custom_categories.measurement_type
                  );
                  if (isConvertible) {
                    const isWeight =
                      measurement.custom_categories.measurement_type === 'kg' ||
                      measurement.custom_categories.measurement_type ===
                        'lbs' ||
                      measurement.custom_categories.measurement_type ===
                        'st_lbs';
                    displayString = isWeight
                      ? formatWeight(
                          Number(measurement.value),
                          defaultWeightUnit
                        )
                      : formatHeight(
                          Number(measurement.value),
                          defaultMeasurementUnit
                        );
                  } else {
                    const unit =
                      measurement.custom_categories.measurement_type === 'N/A'
                        ? ''
                        : measurement.custom_categories.measurement_type;
                    const num = Number(measurement.value);
                    const val =
                      measurement.value === '' || isNaN(num)
                        ? measurement.value
                        : Number(num.toFixed(measurementDecimalPlaces));
                    displayString = `${val} ${unit}`.trim();
                  }
                } else if (measurement.type === 'standard') {
                  if (measurement.display_name === 'Weight') {
                    displayString = formatWeight(
                      Number(measurement.value),
                      defaultWeightUnit
                    );
                  } else if (
                    ['Neck', 'Waist', 'Hips', 'Height'].includes(
                      measurement.display_name
                    )
                  ) {
                    displayString = formatHeight(
                      Number(measurement.value),
                      defaultMeasurementUnit
                    );
                  } else {
                    const unit =
                      measurement.display_unit === 'N/A'
                        ? ''
                        : measurement.display_unit || '';
                    const num = Number(measurement.value);
                    const val =
                      measurement.value === '' || isNaN(num)
                        ? measurement.value
                        : Number(num.toFixed(measurementDecimalPlaces));
                    displayString = `${val} ${unit}`.trim();
                  }
                } else if (measurement.type === 'stress') {
                  measurementName = t('checkIn.stressLevel', 'Stress Level');
                  displayString = `${measurement.value} ${t('checkIn.level', 'level')}`;
                } else if (measurement.type === 'exercise') {
                  measurementName =
                    measurement.exercise_name ||
                    t('checkIn.exercise', 'Exercise');
                  displayString = `${measurement.duration_minutes?.toFixed(0) || 0} min / ${measurement.calories_burned?.toFixed(0) || 0} kcal`;
                } else if (measurement.type === 'fasting') {
                  displayString = measurement.duration_minutes
                    ? `${Math.floor(measurement.duration_minutes / 60)}h ${measurement.duration_minutes % 60}m`
                    : '0h 0m';
                } else {
                  const unit =
                    measurement.display_unit === 'N/A'
                      ? ''
                      : measurement.display_unit || '';
                  const num = Number(measurement.value);
                  const val =
                    measurement.value === '' || isNaN(num)
                      ? measurement.value
                      : Math.round(num);
                  displayString = `${val} ${unit}`.trim();
                }

                return (
                  <div
                    key={measurement.id}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors sm:px-6"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="shrink-0 text-muted-foreground">
                        {measurement.type === 'fasting' ? (
                          <Timer className="w-4 h-4" />
                        ) : (
                          <ClipboardList className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium break-words">
                          {measurement.type === 'fasting'
                            ? measurement.fasting_type
                            : measurementName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatTime(measurement.entry_timestamp)} &middot;{' '}
                          {formatDateInUserTimezone(
                            measurement.entry_timestamp,
                            'MMM d'
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex max-w-44 flex-wrap items-center justify-end font-medium tabular-nums text-right break-words">
                      {measurement.type === 'fasting' ? (
                        <span className="text-foreground">{displayString}</span>
                      ) : (
                        <span>{displayString}</span>
                      )}
                      {(measurement.type === 'custom' ||
                        measurement.type === 'standard' ||
                        measurement.type === 'stress' ||
                        measurement.type === 'exercise') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('common.delete', 'Delete')}
                          className="h-11 w-11 text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            handleDeleteMeasurementClick(measurement)
                          }
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                      {measurement.type === 'fasting' && (
                        <>
                          {handleEditFastClick && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t('common.edit', 'Edit')}
                              className="h-11 w-11 text-muted-foreground hover:text-foreground"
                              onClick={() => handleEditFastClick(measurement)}
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('common.delete', 'Delete')}
                            className="h-11 w-11 text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              handleDeleteMeasurementClick(measurement)
                            }
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
};
