import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  ArrowRight,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Numeral } from '@/components/ui/numeral';
import { Progress } from '@/components/ui/progress';
import WorkoutPlaybackTarget from './WorkoutPlaybackTarget';
import { formatSecondsClock } from '@/utils/timeFormatters';
import { Button } from '@/components/ui/button';
import { resolveExerciseImageSrc } from '@/utils/exercises';
import type {
  WorkoutPlaybackDraft,
  WorkoutSetPointer,
} from '@/utils/workoutPlayback';
import {
  setGuidedSpeechMuted,
  useGuidedCaption,
  useGuidedSpeechMuted,
} from '@/utils/guidedWorkoutSpeech';
import { useImageSlideshow } from '@/hooks/useImageSlideshow';
import { useWorkoutPlaybackGuided } from './useWorkoutPlaybackGuided';

interface WorkoutPlaybackGuidedCardProps {
  draft: WorkoutPlaybackDraft;
  getDraft: () => WorkoutPlaybackDraft | null;
  updateDraft: (
    updater: (current: WorkoutPlaybackDraft) => WorkoutPlaybackDraft
  ) => void;
  onCompleteSet: (pointer: WorkoutSetPointer) => void;
  onToggleRestPause: () => void;
}

/**
 * Guided mode (#1507) for standard workouts: one set at a time with the
 * exercise image (captioned with what is being said) and a DONE — NEXT button
 * for rep-based sets. Pause freezes the session; Replay reads the set and its
 * instructions again; the speaker mutes the voice for this workout while the
 * captions carry on. Sits above the normal set list, which stays editable.
 * Rendered only while the guided-workout preference is on.
 */
export default function WorkoutPlaybackGuidedCard({
  draft,
  getDraft,
  updateDraft,
  onCompleteSet,
  onToggleRestPause,
}: WorkoutPlaybackGuidedCardProps) {
  const { t } = useTranslation();
  const { phase, paused, pause, resume, replay, finish } =
    useWorkoutPlaybackGuided({
      draft,
      getDraft,
      updateDraft,
      onCompleteSet,
      onToggleRestPause,
    });
  const muted = useGuidedSpeechMuted();
  const caption = useGuidedCaption();
  const phaseSet =
    phase.kind === 'done'
      ? null
      : phase.kind === 'rest'
        ? phase.next
        : phase.set;
  const images = phaseSet?.images ?? [];
  const imageIndex = useImageSlideshow(images.length);
  const image = images[imageIndex];
  const imageSrc = image ? resolveExerciseImageSrc(image) : null;
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const isImageValid = imageSrc != null && failedImageSrc !== imageSrc;

  const cardClasses =
    'bg-card text-card-foreground rounded-3xl p-4 sm:p-6 border border-border';

  if (phase.kind === 'done') {
    return (
      <div
        data-testid="guided-workout-card"
        className={`${cardClasses} flex flex-col items-center text-center gap-2`}
      >
        <CheckCircle2 className="h-7 w-7 text-muted-foreground" />
        <p className="font-semibold">
          {t(
            'guidedWorkout.card.doneWeb',
            'All sets done. Finish the workout to save it.'
          )}
        </p>
      </div>
    );
  }

  const set = phaseSet;
  let label: string;
  if (phase.kind === 'getReady') {
    label = t('guidedWorkout.card.getReady', 'Get ready');
  } else if (phase.kind === 'rest') {
    label = t('guidedWorkout.card.rest', 'Rest');
  } else {
    label = t('guidedWorkout.card.setOfTotal', {
      defaultValue: 'Set {{current}} of {{total}}',
      current: phase.set.setNumber,
      total: phase.set.totalSets,
    });
  }
  if (paused) label = t('guidedWorkout.card.paused', 'Paused');

  const exercise = set ? draft.exercises[set.pointer.exerciseIndex] : null;

  const captionText = caption ? (
    <p
      data-testid="guided-caption"
      aria-live="polite"
      className="text-sm sm:text-base font-medium text-foreground text-center"
    >
      {caption}
    </p>
  ) : null;

  const iconButtonClasses =
    'h-11 w-11 rounded-full flex items-center justify-center transition-colors';

  return (
    <div data-testid="guided-workout-card" className={cardClasses}>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-accent text-accent-foreground border border-primary/20 ">
          {t('guidedWorkout.card.badge', 'GUIDED')}
        </span>
        <span className="min-w-16 flex-1 text-sm font-medium text-muted-foreground">
          {label}
        </span>
        <button
          type="button"
          onClick={replay}
          disabled={paused}
          aria-label={t('guidedWorkout.card.replay', 'Replay instructions')}
          title={t('guidedWorkout.card.replay', 'Replay instructions')}
          className={`${iconButtonClasses} bg-muted hover:bg-accent text-foreground disabled:opacity-40`}
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setGuidedSpeechMuted(!muted)}
          aria-label={
            muted
              ? t('guidedWorkout.card.unmute', 'Unmute voice')
              : t('guidedWorkout.card.mute', 'Mute voice')
          }
          aria-pressed={muted}
          className={`${iconButtonClasses} bg-muted hover:bg-accent ${
            muted ? 'text-muted-foreground' : 'text-foreground'
          }`}
        >
          {muted ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          onClick={paused ? resume : pause}
          aria-label={
            paused
              ? t('guidedWorkout.card.resume', 'Resume')
              : t('guidedWorkout.card.pause', 'Pause')
          }
          className={`${iconButtonClasses} ${
            paused
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted hover:bg-accent text-foreground'
          }`}
        >
          {paused ? (
            <Play className="h-4 w-4 fill-current" />
          ) : (
            <Pause className="h-4 w-4 fill-current" />
          )}
        </button>
      </div>

      {set && exercise && (
        <div className="space-y-4 mb-5">
          <h2 className="break-words text-2xl font-semibold">
            {set.exerciseName}
          </h2>
          {phase.kind === 'timed' || phase.kind === 'getReady' ? (
            <Numeral value={formatSecondsClock(phase.remainingSec)} />
          ) : (
            <WorkoutPlaybackTarget
              exercise={exercise}
              setIndex={set.pointer.setIndex}
            />
          )}
          {phase.kind === 'rest' && (
            <p className="text-sm text-muted-foreground">
              {t('guidedWorkout.card.nextUp', 'Next up')}
            </p>
          )}
          <Progress
            value={
              (exercise.sets.filter((item) => item.completed).length /
                exercise.sets.length) *
              100
            }
            className="h-1"
            aria-label={t('exercise.workoutPlaybackPage.progress', 'Sets')}
          />
        </div>
      )}

      {isImageValid ? (
        <div className="relative w-full aspect-[3/2] max-h-48 overflow-hidden rounded-xl bg-muted">
          <img
            src={imageSrc}
            alt={set?.exerciseName ?? ''}
            onError={() => setFailedImageSrc(imageSrc)}
            className="h-full w-full object-contain"
          />
          {captionText && (
            <div className="absolute inset-x-0 bottom-0 bg-background/95 px-3 py-2">
              {captionText}
            </div>
          )}
        </div>
      ) : (
        captionText && (
          <div className="rounded-xl bg-muted px-3 py-2">{captionText}</div>
        )
      )}

      {phase.kind === 'reps' && (
        <Button
          type="button"
          size="lg"
          className="mt-4 w-full h-14 text-lg "
          onClick={() => finish(phase.set.pointer)}
          aria-label={t('guidedWorkout.card.doneNext', 'DONE — NEXT')}
        >
          {t('exercise.workoutPlaybackPage.logSet', 'Log set')}
          <ArrowRight aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
