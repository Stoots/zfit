import { useTranslation } from 'react-i18next';
import { displaySetRir, isWarmupSetType } from '@workspace/shared';
import { useLastExercisePerformance } from '@/hooks/Exercises/useLastExercisePerformance';
import { formatWeight } from '@/utils/unitConversions';
import type { WeightUnit } from '@/contexts/PreferencesContext';

export default function WorkoutPlaybackLastTime({
  exerciseId,
  beforeDate,
  weightUnit,
}: {
  exerciseId: string;
  beforeDate: string;
  weightUnit: WeightUnit;
}) {
  const { t } = useTranslation();
  const previous = useLastExercisePerformance(exerciseId, beforeDate);

  if (!previous) return null;

  return (
    <details className="mx-4 mb-3 text-sm text-muted-foreground">
      <summary className="min-h-11 cursor-pointer content-center rounded-md focus-visible:outline-2 focus-visible:outline-ring">
        <span className="font-medium text-foreground">
          {t('exercise.workoutPlaybackPage.lastTime', 'Last time')}
        </span>{' '}
        <time dateTime={previous.entry_date ?? undefined}>
          {previous.entry_date}
        </time>
      </summary>
      <ul className="space-y-1 pb-2 tabular-nums">
        {previous.sets.map((set) => {
          const rir = displaySetRir(set);
          return (
            <li key={set.id} className="flex flex-wrap gap-x-2">
              <span>
                {set.reps ?? '—'} × {formatWeight(set.weight, weightUnit)}
              </span>
              {rir != null && (
                <span>
                  {rir} {t('workout.rir', 'RIR')}
                </span>
              )}
              {isWarmupSetType(set.set_type) && (
                <span>
                  {t('exercise.workoutPlaybackPage.warmUp', 'Warm-up')}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
