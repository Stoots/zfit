import { displaySetRir } from '@workspace/shared';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatWeight } from '@/utils/numberFormatting';
import { formatSecondsClock } from '@/utils/timeFormatters';
import {
  carryDistanceFromKm,
  carryDistanceUnitLabel,
  resolveExerciseModality,
} from '@workspace/shared';
import type { WorkoutPresetExercise } from '@/types/workout';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  useWorkoutSessionPreview,
  type WorkoutSessionPreviewTarget,
} from '@/hooks/Exercises/useWorkoutSessionPreview';

interface Props {
  children: ReactElement;
  name: string;
  context: string;
  workout?: WorkoutSessionPreviewTarget;
  protocolDescription?: string;
  onStart: () => void;
  starting?: boolean;
}

export default function DashboardWorkoutPreview({
  children,
  name,
  context,
  workout,
  protocolDescription,
  onStart,
  starting,
}: Props) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const { weightUnit, distanceUnit, convertDistance } = usePreferences();
  const preview = useWorkoutSessionPreview(workout, open);
  const formatLabels = {
    standard: t('workoutPresetForm.formatStandard', 'Standard'),
    interval: t('workoutPresetForm.formatInterval', 'Interval / HIIT'),
    tabata: t('workoutPresetForm.formatTabata', 'Tabata'),
    emom: t('workoutPresetForm.formatEmom', 'EMOM'),
    amrap: t('workoutPresetForm.formatAmrap', 'AMRAP'),
    for_time: t('workoutPresetForm.formatForTime', 'For Time'),
  };
  const formatDistance = (
    distance: number,
    exercise: WorkoutPresetExercise
  ) => {
    const isCarry =
      resolveExerciseModality(
        exercise.modality ?? exercise.exercise?.modality,
        exercise.category ?? exercise.exercise?.category
      ) === 'weight_distance';
    const value = isCarry
      ? carryDistanceFromKm(distance, distanceUnit)
      : convertDistance(distance, 'km', distanceUnit);
    const unit = isCarry ? carryDistanceUnitLabel(distanceUnit) : distanceUnit;
    return `${value.toLocaleString(undefined, { maximumSignificantDigits: 6 })} ${unit}`;
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>{context}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto space-y-4">
          {protocolDescription ? (
            <p>{protocolDescription}</p>
          ) : preview.isPending ? (
            <p role="status">
              {t('dashboardWorkoutPreview.loading', 'Loading workout…')}
            </p>
          ) : preview.isError ? (
            <div role="alert" className="space-y-3">
              <p>
                {t(
                  'dashboardWorkoutPreview.error',
                  'Could not load this workout. Try again.'
                )}
              </p>
              <Button variant="outline" onClick={() => void preview.refetch()}>
                {t('dashboardWorkoutPreview.retry', 'Try again')}
              </Button>
            </div>
          ) : !preview.data?.exercises.length ? (
            <p>
              {t(
                'dashboardWorkoutPreview.empty',
                'No exercises are prescribed in this Workout Session.'
              )}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                <span>
                  {formatLabels[preview.data.workout_format ?? 'standard']}
                </span>
                {preview.data.time_cap_seconds != null && (
                  <span>
                    {t('interval.timeCapLabel', 'Cap: {{cap}}', {
                      cap: formatSecondsClock(preview.data.time_cap_seconds),
                    })}
                  </span>
                )}
              </p>
              {preview.data.description && (
                <p className="text-sm text-muted-foreground">
                  {preview.data.description}
                </p>
              )}
              <ol className="divide-y">
                {preview.data.exercises.map((exercise, index) => (
                  <li key={index} className="py-4 first:pt-0 space-y-2">
                    <h3 className="font-semibold">
                      {index + 1}. {exercise.exercise_name}
                    </h3>
                    {exercise.sets.length ? (
                      <ol className="space-y-2 text-sm">
                        {exercise.sets.map((set, setIndex) => (
                          <li key={setIndex} className="flex gap-3">
                            <span className="text-muted-foreground min-w-5">
                              {setIndex + 1}.
                            </span>
                            <span className="min-w-0">
                              {[
                                set.set_type,
                                set.reps != null
                                  ? t(
                                      'dashboardWorkoutPreview.reps',
                                      '{{count}} reps',
                                      { count: set.reps }
                                    )
                                  : null,
                                set.weight != null
                                  ? formatWeight(set.weight, weightUnit)
                                  : null,
                                set.duration != null
                                  ? t(
                                      'dashboardWorkoutPreview.seconds',
                                      '{{count}}s',
                                      { count: set.duration }
                                    )
                                  : null,
                                set.distance != null
                                  ? formatDistance(set.distance, exercise)
                                  : null,
                                set.rest_time != null
                                  ? t(
                                      'dashboardWorkoutPreview.rest',
                                      '{{count}}s rest',
                                      { count: set.rest_time }
                                    )
                                  : null,
                                exercise.modality === 'duration_distance'
                                  ? set.rpe != null
                                    ? `RPE ${set.rpe}`
                                    : null
                                  : displaySetRir(set) != null
                                    ? `RIR ${displaySetRir(set)}`
                                    : null,
                                set.notes,
                              ]
                                .filter(
                                  (value) => value != null && value !== ''
                                )
                                .join(' · ')}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t(
                          'dashboardWorkoutPreview.noSets',
                          'No sets prescribed.'
                        )}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button
            disabled={
              starting ||
              (!!workout &&
                (preview.isPending ||
                  preview.isError ||
                  !preview.data?.exercises.some(
                    (exercise) => exercise.sets.length > 0
                  )))
            }
            onClick={onStart}
          >
            {t('exerciseCard.startWorkoutButton', 'Start Workout')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
