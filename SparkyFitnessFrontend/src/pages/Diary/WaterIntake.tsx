import { Progress } from '@/components/ui/progress';
import { useState } from 'react';
import { instantHourMinute, dayToUtcRange } from '@workspace/shared';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Droplet,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Star,
  Plus,
  Minus,
  Trash2,
  Utensils,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePreferences } from '@/contexts/PreferencesContext';
import { convertMlToSelectedUnit } from '@/utils/nutritionCalculations';
import { describeContainerPress } from '@/utils/waterContainerLabels';
import { isManualSource, prettifySource } from '@/utils/sourceLabels';
import { useWaterContainer } from '@/contexts/WaterContainerContext';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import {
  useWaterGoalQuery,
  useWaterIntakeQuery,
  useManualWaterIntakeQuery,
  useFoodWaterIntakeQuery,
  useUpdateWaterIntakeMutation,
  useWaterIntakeLogQuery,
  useDeleteWaterIntakeLogMutation,
  useUpdateWaterIntakeLogTimeMutation,
} from '@/hooks/Diary/useWaterIntake';

interface WaterIntakeProps {
  selectedDate: string;
}

const WaterIntake = ({ selectedDate }: WaterIntakeProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { activeUserId } = useActiveUser(); // Get activeUserId
  const { activeContainer, standardContainers, quickAddPresets } =
    useWaterContainer();
  const { water_display_unit } = usePreferences();
  const userId = activeUserId || user?.id;
  const { data: waterGoalMl = 1920 } = useWaterGoalQuery(selectedDate, userId);
  const { data: waterMl = 0 } = useWaterIntakeQuery(selectedDate, userId);
  // Only manually logged water can be removed here; provider-synced water is
  // owned by its provider and would just reappear on the next sync.
  const { data: manualWaterMl = 0 } = useManualWaterIntakeQuery(
    selectedDate,
    userId
  );
  const { data: foodWaterMl = 0 } = useFoodWaterIntakeQuery(
    selectedDate,
    userId
  );
  const { mutate: updateWaterIntake, isPending: loading } =
    useUpdateWaterIntakeMutation();
  const { data: logEntries = [] } = useWaterIntakeLogQuery(
    selectedDate,
    userId
  );
  const { mutate: deleteLogEntry, isPending: deleting } =
    useDeleteWaterIntakeLogMutation();
  const { mutate: updateLogTime } = useUpdateWaterIntakeLogTimeMutation();

  // Local state for the selected container in the diary
  const [selectedContainerId, setSelectedContainerId] = useState<number | null>(
    () => activeContainer?.id ?? null
  );

  // Local state for log panel visibility (defaults to open so synced/manual logs are immediately visible)
  const [showLog, setShowLog] = useState(true);

  // State for editing time on a log entry
  const [editingTimeId, setEditingTimeId] = useState<string | null>(null);

  // Derived selected container from standard containers only
  const currentContainer =
    standardContainers.find((c) => c.id === selectedContainerId) ||
    activeContainer;

  const cycleContainer = (direction: 'next' | 'prev') => {
    if (standardContainers.length <= 1) return;

    const currentIndex = standardContainers.findIndex(
      (c) => c.id === currentContainer?.id
    );
    let nextIndex;

    if (direction === 'next') {
      nextIndex = (currentIndex + 1) % standardContainers.length;
    } else {
      nextIndex =
        (currentIndex - 1 + standardContainers.length) %
        standardContainers.length;
    }

    const nextContainer = standardContainers[nextIndex];
    if (nextContainer) {
      setSelectedContainerId(nextContainer.id);
    }
  };
  const saveWaterIntake = (
    changeDrinks: number,
    containerId: number | null
  ) => {
    if (!userId) {
      return;
    }
    updateWaterIntake({
      user_id: userId,
      entry_date: selectedDate,
      change_drinks: changeDrinks,
      container_id: containerId,
    });
  };

  const adjustWater = (changeDrinks: number) => {
    saveWaterIntake(changeDrinks, currentContainer?.id || null);
  };

  const getVolumeDisplay = () => {
    if (currentContainer) {
      // Mirror the server's precedence (measurementService, #2115) so the label
      // and the ring can never disagree: an explicit container volume wins,
      // otherwise a linked food supplies its own water, scaled by how much of
      // it one press logs. This used to always show volume / servings, so a
      // linked container promised "+500 ml" and credited the food's 22.
      const servings = Math.max(
        1,
        currentContainer.servings_per_container || 1
      );
      const hasVolumeOverride =
        !currentContainer.linked_food_id || currentContainer.volume > 0;
      // water_ml is stored per serving_size, so the credit for linked_quantity
      // of it is water * quantity / serving_size -- the same scaling the server
      // applies. Without the divisor a 250 ml drink read as 5500 ml.
      const linkedServingSize =
        Number(currentContainer.linked_variant_serving_size) || 0;
      const linkedWater =
        Number(currentContainer.linked_variant_water_ml ?? 0) *
        Number(currentContainer.linked_quantity ?? 1);
      const volumePerDrink = hasVolumeOverride
        ? currentContainer.volume / servings
        : linkedServingSize > 0
          ? linkedWater / linkedServingSize
          : linkedWater;
      const credited =
        volumePerDrink * Number(currentContainer.hydration_factor ?? 1);
      const displayVolume = convertMlToSelectedUnit(
        credited,
        displayUnit
      ).toFixed(displayUnit === 'ml' ? 0 : 2);

      return t('foodDiary.waterIntake.perDrink', {
        volume: displayVolume,
        unit: displayUnit,
      });
    }

    const displayVolume = convertMlToSelectedUnit(
      250,
      water_display_unit
    ).toFixed(water_display_unit === 'ml' ? 0 : 2);
    return t('foodDiary.waterIntake.defaultPerDrink', {
      volume: displayVolume,
      unit: water_display_unit,
    });
  };

  const { timezone } = usePreferences();

  const formatLogTime = (timestamp: string) => {
    try {
      const { hour, minute } = instantHourMinute(timestamp, timezone);
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    } catch {
      return '--:--';
    }
  };

  const getTimeInputValue = (timestamp: string) => {
    try {
      const { hour, minute } = instantHourMinute(timestamp, timezone);
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    } catch {
      return '12:00';
    }
  };

  const handleTimeChange = (
    entryId: string,
    entryDate: string,
    newTime: string
  ) => {
    try {
      // entryDate is a Postgres DATE column serialized as UTC midnight
      // (e.g. "2026-05-14T00:00:00.000Z"). Extract the YYYY-MM-DD substring
      // directly — do NOT use instantToDay, which would roll back to the
      // previous day for users west of UTC.
      const datePart = entryDate.substring(0, 10);
      const timeParts = newTime.split(':');
      const hours = parseInt(timeParts[0] || '0', 10);
      const minutes = parseInt(timeParts[1] || '0', 10);

      // Build a UTC instant from the user's local day + time using dayToUtcRange
      // dayToUtcRange gives midnight UTC for this day in the user's timezone
      const { start } = dayToUtcRange(datePart, timezone);
      const loggedAt = new Date(
        start.getTime() + hours * 3600000 + minutes * 60000
      ).toISOString();

      updateLogTime({ logId: entryId, loggedAt });
      setEditingTimeId(null);
    } catch (e) {
      console.error('Error formatting time:', e);
      setEditingTimeId(null);
    }
  };

  if (!user) {
    return null;
  }

  const fillPercentage = Math.min((waterMl / waterGoalMl) * 100, 100);
  // A container's unit qualifies its own volume. A linked container has none
  // -- volume is 0 and the credit comes from the food -- so whatever unit was
  // left in the form when it was created is vestigial, and letting it drive the
  // card put the day's total in oz for a container the user thinks of as ml.
  const containerUnitIsMeaningful =
    !!currentContainer &&
    (!currentContainer.linked_food_id || currentContainer.volume > 0);
  const displayUnit = containerUnitIsMeaningful
    ? currentContainer.unit
    : water_display_unit;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center text-base text-muted-foreground">
          <Droplet className="w-4 h-4 mr-2" />
          {t('foodDiary.waterIntake.title', 'Water Intake')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col px-5 pb-5">
        {/* Water count display */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-3">
          <div className="text-2xl font-numeral font-bold">
            {(() => {
              const activeUnit = currentContainer?.unit || water_display_unit;
              const val = convertMlToSelectedUnit(waterMl, activeUnit);
              const goalVal = convertMlToSelectedUnit(waterGoalMl, activeUnit);
              const decimals =
                activeUnit === 'oz' ? 1 : activeUnit === 'liter' ? 2 : 0;
              return `${parseFloat(val.toFixed(decimals))} / ${parseFloat(goalVal.toFixed(decimals))}`;
            })()}
          </div>
          <div className="text-muted-foreground text-xs">
            {currentContainer?.unit || water_display_unit}
          </div>
          {foodWaterMl > 0 && (
            <div className="text-muted-foreground text-xs mt-0.5">
              {(() => {
                const activeUnit = currentContainer?.unit || water_display_unit;
                const decimals =
                  activeUnit === 'oz' ? 1 : activeUnit === 'liter' ? 2 : 0;
                const val = convertMlToSelectedUnit(foodWaterMl, activeUnit);
                return t('foodDiary.waterIntake.fromFood', {
                  volume: parseFloat(val.toFixed(decimals)),
                  unit: activeUnit,
                });
              })()}
            </div>
          )}
        </div>

        <div className="mb-4 flex items-center gap-3">
          <Progress
            value={fillPercentage}
            className="h-1.5 flex-1 [&>div]:bg-water"
          />
          <span className="text-xs tabular-nums text-muted-foreground">
            {Math.round(fillPercentage)}%
          </span>
        </div>

        {/* Intuitive Water Controls: [ - ] VOLUME [ + ] */}
        <div className="flex items-center justify-center space-x-3">
          <Button
            variant="outline"
            onClick={() => adjustWater(-1)}
            disabled={manualWaterMl <= 0 || loading}
            size="icon"
            className="h-11 w-11 rounded-full"
            title={
              manualWaterMl <= 0 && waterMl > 0
                ? t(
                    'foodDiary.waterIntake.noManualToRemove',
                    'Only manually logged water can be removed here'
                  )
                : undefined
            }
          >
            <Minus className="h-4 w-4" />
          </Button>

          <div className="text-center min-w-[70px]">
            <div className="text-sm font-bold text-primary">
              {getVolumeDisplay()}
            </div>
          </div>

          <Button
            onClick={() => adjustWater(1)}
            disabled={loading}
            size="icon"
            className="h-11 w-11 rounded-full"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Container Toggle (Source) */}
        <div className="flex items-center justify-center mt-3 pt-2 border-t border-border space-x-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => cycleContainer('prev')}
            disabled={standardContainers.length <= 1}
            className="h-11 w-11 text-muted-foreground hover:text-muted-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className="flex items-center justify-center space-x-1 px-1">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest truncate max-w-[110px]">
              {currentContainer?.name ||
                t('foodDiary.waterIntake.defaultContainer', 'Container')}
            </div>
            {currentContainer?.linked_food_id && (
              <span
                title={t(
                  'foodDiary.waterIntake.linkedDrink',
                  'Linked to a food entry'
                )}
                className="inline-flex items-center"
              >
                <Utensils className="w-2.5 h-2.5 text-primary shrink-0" />
              </span>
            )}
            {currentContainer?.is_primary && (
              <Star className="w-2.5 h-2.5 text-warning fill-warning" />
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => cycleContainer('next')}
            disabled={standardContainers.length <= 1}
            className="h-11 w-11 text-muted-foreground hover:text-muted-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Quick-Add Drink Presets */}
        {quickAddPresets.length > 0 && (
          <div className="mt-3 pt-2 border-t border-border">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              {t('drink_presets.quickAdd', 'Quick-Add Drinks')}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {quickAddPresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => saveWaterIntake(1, preset.id)}
                  disabled={loading}
                  className="flex items-center justify-between min-h-11 p-2 rounded-lg border border-border bg-card hover:bg-muted text-left transition-colors cursor-pointer group"
                >
                  <div className="min-w-0 pr-1">
                    <div className="text-xs font-medium text-foreground truncate">
                      {preset.name}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      {/* A preset is linked to a food and carries volume 0,
                          so describe the press by what it logs. */}
                      <span>
                        {describeContainerPress(preset, { nonMlDecimals: 1 })}
                      </span>
                      {preset.hydration_factor === 0 && (
                        <span className="text-xs text-warning font-mono">
                          0% water
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 h-5 w-5 rounded-full bg-primary/10 group-hover:bg-primary/10 group-hover:text-foreground text-primary flex items-center justify-center transition-colors">
                    <Plus className="h-3 w-3" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Drink History Log */}
        {logEntries.length > 0 && (
          <div className="mt-3 pt-2 border-t border-border">
            <button
              onClick={() => setShowLog(!showLog)}
              className="flex min-h-11 items-center justify-between w-full text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>
                {t('foodDiary.waterIntake.logTitle', "Today's drinks")} (
                {logEntries.length})
              </span>
              {showLog ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>

            {showLog && (
              <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                {logEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between py-1 px-1.5 rounded text-xs bg-muted group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {editingTimeId === entry.id ? (
                        <input
                          type="time"
                          className="text-xs tabular-nums bg-card border border-primary/30 rounded px-1 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-[72px]"
                          defaultValue={getTimeInputValue(
                            entry.logged_at || entry.created_at
                          )}
                          onBlur={(e) =>
                            handleTimeChange(
                              entry.id,
                              entry.entry_date,
                              e.target.value
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleTimeChange(
                                entry.id,
                                entry.entry_date,
                                (e.target as HTMLInputElement).value
                              );
                            } else if (e.key === 'Escape') {
                              setEditingTimeId(null);
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <button
                          onClick={() => setEditingTimeId(entry.id)}
                          className="text-muted-foreground tabular-nums shrink-0 hover:text-primary hover:underline cursor-pointer transition-colors"
                          title={t(
                            'foodDiary.waterIntake.editTime',
                            'Click to change time'
                          )}
                        >
                          {formatLogTime(entry.logged_at || entry.created_at)}
                        </button>
                      )}
                      <span className="text-muted-foreground truncate">
                        {entry.container_name ||
                          t(
                            'foodDiary.waterIntake.defaultContainer',
                            'Container'
                          )}
                      </span>
                      {entry.food_entry_id && (
                        <span
                          title={t(
                            'foodDiary.waterIntake.linkedDrink',
                            'Linked to a food entry'
                          )}
                          className="inline-flex items-center"
                        >
                          <Utensils className="w-3 h-3 text-primary shrink-0" />
                        </span>
                      )}
                      {/* Synced entries are labelled so it's clear why the "-"
                          control can't remove them; manual rows stay unlabelled
                          to keep the common case uncluttered. */}
                      {!isManualSource(entry.source) && (
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                          {prettifySource(entry.source)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* A drink with a hydration factor of 0 -- an espresso,
                          a spirit -- credits no water on purpose. Printing a
                          bare "0 ml" beside it read as a failed calculation
                          rather than the intended answer. */}
                      {Number(entry.water_ml) === 0 ? (
                        <span
                          className="font-medium text-muted-foreground"
                          title={t(
                            'foodDiary.waterIntake.noWaterCreditHint',
                            'This drink is set to count as no water'
                          )}
                        >
                          {t('foodDiary.waterIntake.noWaterCredit', 'no water')}
                        </span>
                      ) : (
                        <span className="font-medium text-primary">
                          {(() => {
                            const val = convertMlToSelectedUnit(
                              Number(entry.water_ml),
                              displayUnit
                            );
                            const decimals =
                              displayUnit === 'oz'
                                ? 1
                                : displayUnit === 'liter'
                                  ? 2
                                  : 0;
                            return parseFloat(val.toFixed(decimals));
                          })()}{' '}
                          {displayUnit}
                        </span>
                      )}
                      {/* Provider-synced rows get no delete: the provider still
                          holds the record, so a deleted row just re-inserts on
                          the next sync. */}
                      {isManualSource(entry.source) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => deleteLogEntry(entry.id)}
                          disabled={deleting}
                          title={t(
                            'foodDiary.waterIntake.deleteEntry',
                            'Delete this drink'
                          )}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default WaterIntake;
