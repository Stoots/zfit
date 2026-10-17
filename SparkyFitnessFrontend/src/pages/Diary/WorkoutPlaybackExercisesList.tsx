import { useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, ChevronDown } from 'lucide-react';
import {
  carryDistanceUnitLabel,
  DEFAULT_DROP_SET_COUNT,
  DEFAULT_DROP_SET_PERCENT,
  findDropSetBaseIndex,
} from '@workspace/shared';
import { usePreferences, type WeightUnit } from '@/contexts/PreferencesContext';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { SET_TABLE_LAYOUT, toSetTableModality } from '@/constants/exercises';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  WORKOUT_PLAYBACK_SET_GRID_CLASSES,
  type WorkoutPlaybackExerciseDraft,
  type WorkoutSetEditableField,
  type WorkoutSetPointer,
} from '@/utils/workoutPlayback';
import WorkoutPlaybackSetRow from './WorkoutPlaybackSetRow';
import AdaptiveSuggestionNotice from './AdaptiveSuggestionNotice';
import ImageLightbox from '@/components/ImageLightbox';
import {
  filterValidExerciseImages,
  resolveExerciseImageSrc,
} from '@/utils/exercises';

interface WorkoutPlaybackExercisesListProps {
  exercises: WorkoutPlaybackExerciseDraft[];
  setNotesVisibility: Record<string, boolean>;
  onToggleSetNotesVisibility: (setKey: string, visible: boolean) => void;
  onSelectSet: (pointer: WorkoutSetPointer) => void;
  onCompleteSet: (pointer: WorkoutSetPointer) => void;
  onUncompleteSet: (pointer: WorkoutSetPointer) => void;
  onSetFieldChange: (
    pointer: WorkoutSetPointer,
    field: WorkoutSetEditableField,
    value: number | string | null
  ) => void;
  onExerciseNotesChange: (exerciseIndex: number, value: string) => void;
  onOpenRestEditor: (pointer: WorkoutSetPointer) => void;
  onRemoveSet: (pointer: WorkoutSetPointer) => void;
  onAddSet: (exerciseIndex: number) => void;
  onAddDropSets?: (exerciseIndex: number) => void;
  /** Swap the exercise for an alternative (issue #1560). */
  onReplaceExercise?: (exerciseIndex: number) => void;
  /** "Use my usual" / "Use the adjusted suggestion" (#1560). */
  onAdaptiveDeclined?: (exerciseIndex: number, declined: boolean) => void;
  weightUnit: WeightUnit;
}

const WorkoutPlaybackExercisesList = ({
  exercises,
  setNotesVisibility,
  onToggleSetNotesVisibility,
  onSelectSet,
  onCompleteSet,
  onUncompleteSet,
  onSetFieldChange,
  onExerciseNotesChange,
  onOpenRestEditor,
  onRemoveSet,
  onAddSet,
  onAddDropSets,
  onReplaceExercise,
  onAdaptiveDeclined,
  weightUnit,
}: WorkoutPlaybackExercisesListProps) => {
  const { t } = useTranslation();
  const { distanceUnit } = usePreferences();
  const [expandedCompletedExercises, setExpandedCompletedExercises] = useState<
    Record<string, boolean>
  >({});
  // Full-screen exercise images (#1691), opened from a header thumbnail.
  const [imageViewer, setImageViewer] = useState<{
    images: string[];
    title: string;
  } | null>(null);

  return (
    <div className="space-y-5">
      {exercises.map((exercise, exerciseIndex) => {
        const isTimedExercise = exercise.modality
          ? exercise.modality === 'duration' ||
            exercise.modality === 'duration_distance'
          : exercise.sets.some(
              (set) => set.duration != null && set.reps == null
            );
        const layout =
          SET_TABLE_LAYOUT[
            toSetTableModality(
              exercise.modality ??
                (isTimedExercise ? 'duration' : 'weight_reps')
            )
          ];
        const completedSets = exercise.sets.filter(
          (set) => set.completed
        ).length;
        const totalSets = exercise.sets.length;
        const isComplete = totalSets > 0 && completedSets === totalSets;
        const exerciseKey = `${exercise.exercise_id}-${exerciseIndex}`;
        const isExpanded =
          !isComplete || expandedCompletedExercises[exerciseKey] === true;
        const exerciseImages = filterValidExerciseImages(
          exercise.images ?? (exercise.image_url ? [exercise.image_url] : [])
        ).map((image) => resolveExerciseImageSrc(image));
        const toggleLabel = isExpanded
          ? t('common.collapse', 'Collapse')
          : t('common.expand', 'Expand');

        return (
          <Card
            key={`${exercise.exercise_id}-${exerciseIndex}`}
            className="border-border/70 shadow-none"
          >
            <CardHeader className="px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                {exerciseImages.length > 0 && (
                  <button
                    type="button"
                    className="h-11 w-11 shrink-0 overflow-hidden rounded-lg"
                    aria-label={t(
                      'exercise.workoutPlaybackPage.viewImages',
                      'View {{name}} images',
                      { name: exercise.exercise_name }
                    )}
                    onClick={() =>
                      setImageViewer({
                        images: exerciseImages,
                        title: exercise.exercise_name,
                      })
                    }
                  >
                    <img
                      src={exerciseImages[0]}
                      alt=""
                      className="h-11 w-11 object-cover"
                      loading="lazy"
                    />
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="break-words text-base font-semibold">
                    {exercise.exercise_name}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'exercise.workoutPlaybackPage.sets',
                      '{{completedSets}}/{{totalSets}} sets',
                      { completedSets, totalSets }
                    )}
                  </p>
                </div>
                {onReplaceExercise && (
                  <button
                    type="button"
                    className="h-11 w-11 shrink-0 rounded-full p-3 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title={t(
                      'exercise.workoutPlaybackPage.replaceExercise',
                      'Replace exercise'
                    )}
                    aria-label={t(
                      'exercise.workoutPlaybackPage.replaceExerciseNamed',
                      'Replace {{name}}',
                      { name: exercise.exercise_name }
                    )}
                    onClick={() => onReplaceExercise(exerciseIndex)}
                  >
                    <ArrowLeftRight className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  className="flex min-h-11 cursor-pointer items-center gap-1.5 text-left"
                  aria-label={`${toggleLabel} ${exercise.exercise_name}`}
                  onClick={() => {
                    if (!isComplete) return;
                    setExpandedCompletedExercises((current) => ({
                      ...current,
                      [exerciseKey]: !current[exerciseKey],
                    }));
                  }}
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      isExpanded ? 'rotate-180' : ''
                    } ${isComplete ? 'text-muted-foreground' : ''}`}
                  />
                  <span className="text-xs text-muted-foreground">
                    {isComplete
                      ? t('exercise.workoutPlaybackPage.completed', 'Completed')
                      : t(
                          'exercise.workoutPlaybackPage.inProgress',
                          'In Progress'
                        )}
                  </span>
                </button>
              </div>
            </CardHeader>
            {(exercise.adaptive || exercise.suggest_variation) && (
              <div className="px-4 pb-3">
                <AdaptiveSuggestionNotice
                  adaptive={exercise.adaptive ?? null}
                  suggestVariation={exercise.suggest_variation === true}
                  onDeclinedChange={
                    onAdaptiveDeclined
                      ? (declined) =>
                          onAdaptiveDeclined(exerciseIndex, declined)
                      : undefined
                  }
                  onSeeAlternatives={
                    onReplaceExercise
                      ? () => onReplaceExercise(exerciseIndex)
                      : undefined
                  }
                />
              </div>
            )}
            {isExpanded && (
              <CardContent className="px-4 pb-3 pt-0">
                <div className="space-y-1">
                  <div
                    className={`text-center text-xs text-muted-foreground ${WORKOUT_PLAYBACK_SET_GRID_CLASSES}`}
                  >
                    <span>
                      {t('exercise.workoutPlaybackPage.columnSet', 'Set')}
                    </span>
                    <span>
                      {layout.signedWeight
                        ? t('workout.addedAssistedWeight', '+/− weight')
                        : t(
                            'exercise.workoutPlaybackPage.columnWeight',
                            'Weight'
                          )}
                    </span>
                    <span>
                      {layout.showReps
                        ? t('exercise.workoutPlaybackPage.columnReps', 'Reps')
                        : layout.showDistance
                          ? t('workout.distanceUnit', 'Distance ({{unit}})', {
                              unit: carryDistanceUnitLabel(distanceUnit),
                            })
                          : t('workout.durationSec', 'Duration (s)')}
                    </span>
                    <span>{t('workout.rpe', 'RPE')}</span>
                  </div>

                  {exercise.sets.map((set, setIndex) => {
                    return (
                      <WorkoutPlaybackSetRow
                        key={`${exercise.exercise_id}-${exerciseIndex}-${setIndex}`}
                        exerciseName={exercise.exercise_name}
                        exerciseKey={exerciseKey}
                        exerciseIndex={exerciseIndex}
                        setIndex={setIndex}
                        setNumber={set.set_number}
                        setType={set.set_type}
                        isTimedExercise={isTimedExercise}
                        modality={exercise.modality}
                        distance={set.distance}
                        reps={set.reps}
                        weight={set.weight}
                        duration={set.duration}
                        rpe={set.rpe}
                        timerStartedAtMs={set.timer_started_at_ms ?? null}
                        restTime={set.rest_time}
                        notes={set.notes}
                        completed={set.completed}
                        isNotesVisible={
                          setNotesVisibility[`${exerciseKey}-${setIndex}`] ??
                          !!set.notes
                        }
                        onToggleNotesVisibility={(key) =>
                          onToggleSetNotesVisibility(
                            key,
                            setNotesVisibility[key] ?? !!set.notes
                          )
                        }
                        onSelectSet={onSelectSet}
                        onCompleteSet={onCompleteSet}
                        onUncompleteSet={onUncompleteSet}
                        onSetFieldChange={onSetFieldChange}
                        onOpenRestEditor={onOpenRestEditor}
                        onRemoveSet={onRemoveSet}
                        canRemove={exercise.sets.length > 1}
                        weightUnit={weightUnit}
                      />
                    );
                  })}
                  <div className="mt-3 space-y-1.5">
                    <Label htmlFor={`exercise-notes-${exerciseIndex}`}>
                      {t('workout.exerciseNotes', 'Exercise notes')}
                    </Label>
                    <Textarea
                      id={`exercise-notes-${exerciseIndex}`}
                      aria-label={t(
                        'workout.exerciseNotesNamed',
                        'Exercise notes for {{name}}',
                        { name: exercise.exercise_name }
                      )}
                      value={exercise.notes ?? ''}
                      onChange={(event) =>
                        onExerciseNotesChange(exerciseIndex, event.target.value)
                      }
                      className="min-h-16 resize-y text-sm"
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap justify-center gap-3 border-t">
                  <button
                    type="button"
                    aria-label={`Add set for ${exercise.exercise_name}`}
                    className="inline-flex min-h-11 items-center justify-center px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => onAddSet(exerciseIndex)}
                  >
                    {t('exercise.workoutPlaybackPage.addSet', 'Add Set')}
                  </button>
                  {findDropSetBaseIndex(exercise.sets) >= 0 && (
                    <button
                      type="button"
                      aria-label={t(
                        'exercise.workoutPlaybackPage.addDropSetsFor',
                        'Add drop sets for {{name}}',
                        { name: exercise.exercise_name }
                      )}
                      className="inline-flex min-h-11 items-center justify-center px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => onAddDropSets?.(exerciseIndex)}
                    >
                      {t(
                        'exercise.workoutPlaybackPage.addDropSets',
                        'Add {{sets}} Drop Sets (-{{percent}}%)',
                        {
                          sets: DEFAULT_DROP_SET_COUNT,
                          percent: DEFAULT_DROP_SET_PERCENT,
                        }
                      )}
                    </button>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
      <ImageLightbox
        images={imageViewer?.images ?? []}
        open={imageViewer != null}
        onOpenChange={(open) => {
          if (!open) setImageViewer(null);
        }}
        title={imageViewer?.title}
      />
    </div>
  );
};

export default memo(WorkoutPlaybackExercisesList);
