import type React from 'react';
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Trash2,
  ChevronDown,
  Flame,
  Clock,
  Activity,
  Layers,
  MapPin,
} from 'lucide-react';
import ExerciseEntryDisplay from './ExerciseEntryDisplay';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  formatMinutesToHHMM,
  formatSecondsClock,
  formatTimeOfDayString,
} from '@/utils/timeFormatters';
import { Exercise, ExerciseEntry, PresetSessionEntry } from '@/types/exercises';
import { earliestEntryTime, setsDurationMinutes } from '@workspace/shared';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import WorkoutFeedbackPanel from './WorkoutFeedbackPanel';

interface ExercisePresetEntryDisplayProps {
  presetEntry: PresetSessionEntry;
  currentUserId: string | undefined;
  handleDelete: (presetEntryId: string) => void;
  handleDeleteExerciseEntry: (entryId: string) => void;
  handleEdit: (entry: ExerciseEntry) => void;
  handleEditExerciseDatabase: (exerciseId: string) => void;
  setExerciseToPlay: (exercise: Exercise | null) => void;
  setIsPlaybackModalOpen: (isOpen: boolean) => void;
  energyUnit: 'kcal' | 'kJ';
  convertEnergy: (
    value: number,
    fromUnit: 'kcal' | 'kJ',
    toUnit: 'kcal' | 'kJ'
  ) => number;
  getEnergyUnitString: (unit: 'kcal' | 'kJ') => string;
}

const ExercisePresetEntryDisplay: React.FC<ExercisePresetEntryDisplayProps> = ({
  presetEntry,
  currentUserId,
  handleDelete,
  handleDeleteExerciseEntry,
  handleEdit,
  handleEditExerciseDatabase,
  setExerciseToPlay,
  setIsPlaybackModalOpen,
  energyUnit,
  convertEnergy,
  getEnergyUnitString,
}) => {
  const { t } = useTranslation();
  const { timeFormat } = usePreferences();
  const [isExpanded, setIsExpanded] = useState(false);
  // The feedback panel autosaves, so only people who can write the diary
  // get it (#1560); report-only viewers can't save and don't see it here.
  const { hasWritePermission } = useActiveUser();
  const canGiveFeedback = hasWritePermission('diary');

  const toggleExpansion = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const totalSets =
    presetEntry.exercises?.reduce(
      (sum, ex) => sum + (ex.sets?.length || 0),
      0
    ) ?? 0;

  const totalMinutes =
    presetEntry.exercises?.reduce((sum, ex) => {
      const setsDuration = setsDurationMinutes(ex.sets);
      // Fall back to the entry-level duration when the sets carry no per-set
      // timers (e.g. rep-based sets synced from Hevy).
      return sum + (setsDuration > 0 ? setsDuration : ex.duration_minutes || 0);
    }, 0) ?? 0;

  const avgHR = (() => {
    const withHR =
      presetEntry.exercises?.filter((ex) => ex.avg_heart_rate) ?? [];
    return withHR.length > 0
      ? Math.round(
          withHR.reduce((sum, ex) => sum + (ex.avg_heart_rate || 0), 0) /
            withHR.length
        )
      : 0;
  })();

  const earliestTime = earliestEntryTime(presetEntry.exercises ?? []);

  const totalCalories = Math.round(
    convertEnergy(
      presetEntry.exercises?.reduce(
        (sum, ex) => sum + (ex.calories_burned || 0),
        0
      ) ?? 0,
      'kcal',
      energyUnit
    )
  );

  const hasExercises =
    presetEntry.exercises && presetEntry.exercises.length > 0;
  const exerciseCount = presetEntry.exercises?.length ?? 0;

  return (
    <Card className="overflow-hidden border-0 border-t rounded-none shadow-none bg-transparent">
      <div className="flex">
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
            {/* Left: toggle + name */}
            <button
              onClick={toggleExpansion}
              className="flex min-h-11 items-center gap-3 min-w-0 flex-1 text-left group"
              aria-expanded={isExpanded}
            >
              <span
                className={`flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full border-2 transition-all duration-200
                  ${
                    isExpanded
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground group-hover:border-primary/30 group-hover:text-primary'
                  }`}
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                />
              </span>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-foreground text-base leading-tight truncate">
                    {presetEntry.name ||
                      t('exerciseCard.workoutPreset', 'Workout Preset')}
                  </span>
                  {earliestTime && (
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                      {formatTimeOfDayString(earliestTime, timeFormat)}
                    </span>
                  )}
                  {exerciseCount > 0 && (
                    <span className="flex-shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                      {exerciseCount}{' '}
                      {exerciseCount === 1 ? 'exercise' : 'exercises'}
                    </span>
                  )}
                  {(() => {
                    const wodDetail = presetEntry.activity_details?.find(
                      (d) => d.detail_type === 'wod_score'
                    );
                    if (!wodDetail?.detail_data) return null;
                    let data = wodDetail.detail_data;
                    while (typeof data === 'string') {
                      try {
                        data = JSON.parse(data);
                      } catch {
                        return null;
                      }
                    }
                    if (!data || typeof data !== 'object') return null;
                    const wod = data as {
                      workout_format?: string;
                      format?: string;
                      rounds_completed?: number;
                      rounds?: number;
                      reps_completed?: number;
                      extra_reps?: number;
                      reps?: number;
                      elapsed_seconds?: number;
                      time_seconds?: number;
                      is_rx?: boolean;
                      status?: string;
                      scaling_status?: string;
                    };
                    const format = (wod.workout_format || wod.format || 'WOD')
                      .toUpperCase()
                      .replace('_', ' ');
                    const rounds = wod.rounds_completed ?? wod.rounds ?? 0;
                    const reps =
                      wod.reps_completed ?? wod.extra_reps ?? wod.reps ?? 0;
                    const isRx =
                      wod.is_rx === true ||
                      wod.status === 'rx' ||
                      wod.scaling_status === 'rx';

                    let scoreStr = '';
                    if (
                      wod.workout_format === 'amrap' ||
                      wod.format === 'amrap'
                    ) {
                      scoreStr = `${rounds} rds${reps > 0 ? ` + ${reps} reps` : ''}`;
                    } else if (
                      wod.workout_format === 'for_time' ||
                      wod.format === 'for_time'
                    ) {
                      const secs = wod.time_seconds ?? wod.elapsed_seconds;
                      scoreStr =
                        typeof secs === 'number'
                          ? formatSecondsClock(secs)
                          : 'Done';
                    } else if (rounds > 0) {
                      scoreStr = `${rounds} rds`;
                    }

                    return (
                      <span className="flex-shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/30">
                        {format}
                        {scoreStr ? ` • ${scoreStr}` : ''}
                        {` (${isRx ? 'Rx' : 'Scaled'})`}
                      </span>
                    );
                  })()}
                </div>
                {presetEntry.exercise_snapshot?.category && (
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mt-0.5">
                    {presetEntry.exercise_snapshot.category}
                  </p>
                )}
              </div>
            </button>

            {/* Right: delete */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(presetEntry.id)}
                    className="flex-shrink-0 h-11 w-11 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {t('exerciseCard.deletePresetEntry', 'Delete Preset Entry')}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* Description / notes / gym */}
          {(presetEntry.description ||
            presetEntry.notes ||
            presetEntry.location) && (
            <div className="px-4 pb-2 space-y-0.5">
              {presetEntry.location && (
                <p
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                  title={t('exerciseCard.workoutLocation', 'Gym / Location')}
                >
                  <MapPin className="w-3 h-3" />
                  {presetEntry.location}
                </p>
              )}
              {presetEntry.description && (
                <p className="text-xs text-muted-foreground">
                  {presetEntry.description}
                </p>
              )}
              {presetEntry.notes && (
                <p className="text-xs text-muted-foreground italic">
                  {presetEntry.notes}
                </p>
              )}
            </div>
          )}

          {/* Stats strip */}
          {hasExercises && (
            <div className="mx-4 mb-4 mt-1 grid grid-cols-4 divide-x divide-border bg-muted rounded-lg overflow-hidden">
              <StatCell
                icon={<Layers className="w-3 h-3" />}
                value={String(totalSets)}
                label={t('common.totalSets', 'Sets')}
                color="text-primary"
              />
              <StatCell
                icon={<Clock className="w-3 h-3" />}
                value={formatMinutesToHHMM(totalMinutes)}
                label={t('common.minutesUnit', 'Time')}
                color="text-primary"
              />
              <StatCell
                icon={<Activity className="w-3 h-3" />}
                value={avgHR > 0 ? String(avgHR) : '—'}
                label={t('common.avgHrUnit', 'Avg HR')}
                color="text-destructive text-destructive"
              />
              <StatCell
                icon={<Flame className="w-3 h-3" />}
                value={String(totalCalories)}
                label={getEnergyUnitString(energyUnit)}
                color="text-warning text-warning"
              />
            </div>
          )}
        </div>
      </div>

      {/* Expanded exercise list */}
      {isExpanded && (
        <CardContent className="px-4 pb-4 pt-0 space-y-2 border-t border-border">
          <div className="pt-3 space-y-2">
            {hasExercises ? (
              presetEntry.exercises!.map((exerciseEntry) => (
                <ExerciseEntryDisplay
                  key={exerciseEntry.id}
                  exerciseEntry={exerciseEntry}
                  currentUserId={currentUserId}
                  handleEdit={handleEdit}
                  handleDelete={handleDeleteExerciseEntry}
                  handleEditExerciseDatabase={handleEditExerciseDatabase}
                  setExerciseToPlay={setExerciseToPlay}
                  setIsPlaybackModalOpen={setIsPlaybackModalOpen}
                  energyUnit={energyUnit}
                  convertEnergy={convertEnergy}
                  getEnergyUnitString={getEnergyUnitString}
                />
              ))
            ) : (
              <p className="text-sm text-center text-muted-foreground py-4">
                {t(
                  'exerciseCard.noExercisesInPreset',
                  'No exercises in this preset.'
                )}
              </p>
            )}
            {hasExercises && canGiveFeedback && (
              <WorkoutFeedbackPanel
                presetEntryId={presetEntry.id}
                exercises={presetEntry.exercises!.map((exerciseEntry) => ({
                  id: exerciseEntry.id,
                  name: exerciseEntry.exercise_snapshot?.name ?? '',
                }))}
              />
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
};

// Small reusable stat cell
const StatCell: React.FC<{
  icon: React.ReactNode;
  value: string;
  label: string;
  color: string;
}> = ({ icon, value, label, color }) => (
  <div className="flex flex-col items-center justify-center py-2.5 px-1 gap-0.5">
    <span className={`${color} flex items-center gap-1`}>
      {icon}
      <span className="font-bold text-sm text-foreground">{value}</span>
    </span>
    <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
      {label}
    </span>
  </div>
);

export default ExercisePresetEntryDisplay;
