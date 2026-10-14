import { useTranslation } from 'react-i18next';
import { carryDistanceFromKm, carryDistanceUnitLabel } from '@workspace/shared';
import { Numeral } from '@/components/ui/numeral';
import { SET_TABLE_LAYOUT, toSetTableModality } from '@/constants/exercises';
import { usePreferences } from '@/contexts/PreferencesContext';
import { kgToLbs } from '@/utils/unitConversions';
import { formatSecondsClock } from '@/utils/timeFormatters';
import type { WorkoutPlaybackExerciseDraft } from '@/utils/workoutPlayback';

/** The same prescription in the manual and voice-guided player. */
export default function WorkoutPlaybackTarget({
  exercise,
  setIndex,
}: {
  exercise: WorkoutPlaybackExerciseDraft;
  setIndex: number;
}) {
  const { t } = useTranslation();
  const { weightUnit, distanceUnit } = usePreferences();
  const set = exercise.sets[setIndex];
  if (!set) return null;
  const modality =
    exercise.modality ??
    (set.duration != null && set.reps == null ? 'duration' : 'weight_reps');
  const layout = SET_TABLE_LAYOUT[toSetTableModality(modality)];
  const loadUnit = weightUnit === 'kg' ? 'kg' : 'lbs';
  const load =
    set.weight == null
      ? null
      : loadUnit === 'kg'
        ? set.weight
        : kgToLbs(set.weight);
  return (
    <div
      className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2"
      data-testid="workout-set-target"
    >
      {layout.showWeight && (
        <>
          <Numeral
            value={
              layout.signedWeight && load != null && load > 0
                ? `+${Number(load.toFixed(1))}`
                : load
            }
            unit={layout.signedWeight ? `± ${loadUnit}` : loadUnit}
            size="lg"
            unitPosition="beside"
            formatOptions={{ maximumFractionDigits: 1 }}
          />
          <span className="text-2xl text-muted-foreground" aria-hidden="true">
            ×
          </span>
        </>
      )}
      <Numeral
        value={
          layout.showReps
            ? (set.reps ?? null)
            : layout.showDistance
              ? set.distance == null
                ? null
                : carryDistanceFromKm(set.distance, distanceUnit)
              : set.duration == null
                ? null
                : formatSecondsClock(set.duration)
        }
        unit={
          layout.showReps
            ? t('common.reps', 'reps')
            : layout.showDistance
              ? carryDistanceUnitLabel(distanceUnit)
              : t('exercise.workoutPlaybackPage.elapsedTime', 'Duration')
        }
        size="lg"
        unitPosition="beside"
        formatOptions={{ maximumFractionDigits: 1 }}
      />
    </div>
  );
}
