import { useTranslation } from 'react-i18next';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  carryDistanceFromKm,
  carryDistanceToKm,
  carryDistanceUnitLabel,
  type ExerciseModality,
} from '@workspace/shared';
import { SET_TABLE_LAYOUT, toSetTableModality } from '@/constants/exercises';
import { usePreferences } from '@/contexts/PreferencesContext';
import type { WeightUnit } from '@/contexts/PreferencesContext';
import { MessageSquare, Play, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/NumericInput';
import { Textarea } from '@/components/ui/textarea';
import { UnitInput } from '@/components/ui/UnitInput';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { excerciseWorkoutSetTypes } from '@/constants/excerciseWorkoutSetTypes';
import { formatSecondsClock } from '@/utils/timeFormatters';
import {
  DEFAULT_REST_SECONDS,
  WORKOUT_PLAYBACK_SET_GRID_CLASSES,
  type WorkoutSetEditableField,
  type WorkoutSetPointer,
} from '@/utils/workoutPlayback';

function formatRestChip(seconds: number | null | undefined): string {
  const value = seconds ?? DEFAULT_REST_SECONDS;
  if (value < 60) {
    return `${value}s`;
  }

  return formatSecondsClock(value);
}

function parseNullableInteger(raw: string): number | null {
  if (raw.trim() === '') {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

interface WorkoutPlaybackSetRowProps {
  exerciseName: string;
  exerciseKey: string;
  exerciseIndex: number;
  setIndex: number;
  setNumber: number;
  setType: string | null | undefined;
  isTimedExercise: boolean;
  modality?: ExerciseModality;
  distance?: number | null;
  reps: number | null | undefined;
  weight: number | null | undefined;
  duration: number | null | undefined;
  rpe: number | null | undefined;
  /** Epoch ms the set's stopwatch started; null when not running. */
  timerStartedAtMs: number | null;
  restTime: number | null | undefined;
  notes: string | null | undefined;
  completed: boolean;
  isNotesVisible: boolean;
  onToggleNotesVisibility: (setKey: string) => void;
  onSelectSet: (pointer: WorkoutSetPointer) => void;
  onCompleteSet: (pointer: WorkoutSetPointer) => void;
  onUncompleteSet: (pointer: WorkoutSetPointer) => void;
  onSetFieldChange: (
    pointer: WorkoutSetPointer,
    field: WorkoutSetEditableField,
    value: number | string | null
  ) => void;
  onOpenRestEditor: (pointer: WorkoutSetPointer) => void;
  onRemoveSet: (pointer: WorkoutSetPointer) => void;
  canRemove: boolean;
  weightUnit: WeightUnit;
}

const WorkoutPlaybackSetRow = ({
  exerciseName,
  exerciseKey,
  exerciseIndex,
  setIndex,
  setNumber,
  setType,
  isTimedExercise,
  modality,
  distance,
  reps,
  weight,
  duration,
  rpe,
  timerStartedAtMs,
  restTime,
  notes,
  completed,
  isNotesVisible,
  onToggleNotesVisibility,
  onSelectSet,
  onCompleteSet,
  onUncompleteSet,
  onSetFieldChange,
  onOpenRestEditor,
  onRemoveSet,
  canRemove,
  weightUnit,
}: WorkoutPlaybackSetRowProps) => {
  const { t } = useTranslation();
  const { distanceUnit } = usePreferences();
  const layout =
    SET_TABLE_LAYOUT[
      toSetTableModality(
        modality ?? (isTimedExercise ? 'duration' : 'weight_reps')
      )
    ];
  const pointer: WorkoutSetPointer = useMemo(
    () => ({ exerciseIndex, setIndex }),
    [exerciseIndex, setIndex]
  );
  const notesKey = `${exerciseKey}-${setIndex}`;

  // Timed/hold-set stopwatch. The start time lives on the draft (persisted),
  // so it survives re-renders and a reload; only the ticking display is local.
  const stopwatchStartedAt = timerStartedAtMs;
  const [stopwatchNowMs, setStopwatchNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (stopwatchStartedAt == null) return;
    const interval = window.setInterval(
      () => setStopwatchNowMs(Date.now()),
      500
    );
    return () => window.clearInterval(interval);
  }, [stopwatchStartedAt]);
  const stopwatchElapsedSec =
    stopwatchStartedAt != null
      ? Math.max(0, Math.floor((stopwatchNowMs - stopwatchStartedAt) / 1000))
      : 0;

  const handleToggleStopwatch = useCallback(() => {
    if (stopwatchStartedAt == null) {
      setStopwatchNowMs(Date.now());
      onSetFieldChange(pointer, 'timer_started_at_ms', Date.now());
      return;
    }
    const elapsed = Math.max(
      1,
      Math.floor((Date.now() - stopwatchStartedAt) / 1000)
    );
    onSetFieldChange(pointer, 'timer_started_at_ms', null);
    onSetFieldChange(pointer, 'duration', elapsed);
    // Hand the pre-filled cell back so the time can be corrected.
    window.setTimeout(() => {
      document
        .getElementById(`set-duration-${exerciseIndex}-${setIndex}`)
        ?.focus();
    }, 0);
  }, [stopwatchStartedAt, onSetFieldChange, pointer, exerciseIndex, setIndex]);

  return (
    <div
      className={`border-t py-3 ${completed ? 'bg-muted/40 text-muted-foreground' : ''}`}
    >
      <div className={WORKOUT_PLAYBACK_SET_GRID_CLASSES}>
        <Button
          type="button"
          variant="ghost"
          className="h-11 w-11 p-0 tabular-nums"
          aria-label={`Select set ${setNumber} for ${exerciseName}`}
          onClick={() => onSelectSet(pointer)}
        >
          {setNumber}
        </Button>
        {layout.showWeight ? (
          <UnitInput
            id={`set-weight-${exerciseIndex}-${setIndex}`}
            value={weight ?? ''}
            unit={weightUnit}
            type="weight"
            placeholder={
              layout.signedWeight ? '±0' : t('common.weight', 'Weight')
            }
            onChange={(value) => onSetFieldChange(pointer, 'weight', value)}
            inputClassName="pl-2 tabular-nums"
            className="min-w-0"
            aria-label={`Weight set ${setNumber}`}
          />
        ) : (
          <span
            aria-hidden="true"
            className="text-center text-muted-foreground"
          >
            —
          </span>
        )}
        {layout.showReps ? (
          <Input
            id={`set-reps-${exerciseIndex}-${setIndex}`}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            aria-label={`Reps set ${setNumber}`}
            value={reps ?? ''}
            onChange={(event) =>
              onSetFieldChange(
                pointer,
                'reps',
                parseNullableInteger(event.target.value)
              )
            }
            placeholder={t('common.reps', 'reps')}
            className="min-w-0 px-2 tabular-nums"
          />
        ) : layout.showDistance ? (
          <NumericInput
            inputMode="decimal"
            min={0}
            step={1}
            decimals={1}
            aria-label={t(
              'workout.distanceSet',
              'Distance set {{setNumber}} ({{unit}})',
              { setNumber, unit: carryDistanceUnitLabel(distanceUnit) }
            )}
            value={
              distance == null
                ? null
                : carryDistanceFromKm(distance, distanceUnit)
            }
            onValueChange={(value) =>
              onSetFieldChange(
                pointer,
                'distance',
                value == null ? null : carryDistanceToKm(value, distanceUnit)
              )
            }
            placeholder="—"
            className="min-w-0 px-2 tabular-nums"
          />
        ) : (
          <Input
            id={`set-duration-${exerciseIndex}-${setIndex}`}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            aria-label={t('workout.durationSet', 'Duration set {{setNumber}}', {
              setNumber,
            })}
            value={
              stopwatchStartedAt != null
                ? stopwatchElapsedSec
                : (duration ?? '')
            }
            readOnly={stopwatchStartedAt != null}
            onChange={(event) =>
              onSetFieldChange(
                pointer,
                'duration',
                parseNullableInteger(event.target.value)
              )
            }
            placeholder={t('workout.durationSecShort', 'Sec')}
            className="min-w-0 px-2 tabular-nums"
          />
        )}
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          max={10}
          step={0.5}
          aria-label={t('workout.rpeSet', 'RPE set {{setNumber}}', {
            setNumber,
          })}
          value={rpe ?? ''}
          onChange={(event) =>
            onSetFieldChange(
              pointer,
              'rpe',
              event.target.value === '' ? null : Number(event.target.value)
            )
          }
          className="min-w-0 px-2 tabular-nums"
        />
      </div>
      <div className="mt-2 grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem_2.75rem_2.75rem] items-center gap-2">
        <Checkbox
          aria-label={`Complete set ${setNumber}`}
          checked={completed}
          className="h-11 w-11 shrink-0 rounded-full data-[state=checked]:border-border data-[state=checked]:bg-muted data-[state=checked]:text-muted-foreground"
          onCheckedChange={(checked) =>
            checked === true ? onCompleteSet(pointer) : onUncompleteSet(pointer)
          }
        />
        <Select
          value={setType ?? 'Working Set'}
          onValueChange={(value) =>
            onSetFieldChange(pointer, 'set_type', value)
          }
        >
          <SelectTrigger
            aria-label={`Type set ${setNumber}`}
            className="min-w-0 bg-transparent px-2 text-sm"
          >
            <SelectValue>
              {t(
                `workout.setType.${setType ?? 'Working Set'}`,
                setType ?? 'Working Set'
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {excerciseWorkoutSetTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`workout.setType.${type}`, type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          className="w-11 px-0 text-sm tabular-nums"
          aria-label={`Edit rest for set ${setNumber}`}
          onClick={() => onOpenRestEditor(pointer)}
        >
          {formatRestChip(restTime)}
        </Button>
        {!layout.showReps && !layout.showDistance && !completed && (
          <Button
            type="button"
            size="icon"
            variant={stopwatchStartedAt != null ? 'destructive' : 'outline'}
            onClick={handleToggleStopwatch}
            aria-label={
              stopwatchStartedAt != null
                ? t('workout.stopTimer', 'Stop stopwatch')
                : t('workout.startTimer', 'Start stopwatch')
            }
            title={
              stopwatchStartedAt != null
                ? t('workout.stopTimer', 'Stop stopwatch')
                : t('workout.startTimer', 'Start stopwatch')
            }
          >
            {stopwatchStartedAt != null ? (
              <Square className="h-4 w-4 fill-current" />
            ) : (
              <Play className="h-4 w-4 fill-current" />
            )}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Toggle notes for set ${setNumber}`}
          aria-expanded={isNotesVisible}
          onClick={() => onToggleNotesVisibility(notesKey)}
        >
          <MessageSquare className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={!canRemove}
          aria-label={`Remove set ${setNumber} for ${exerciseName}`}
          onClick={() => onRemoveSet(pointer)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {isNotesVisible && (
        <Textarea
          aria-label={`Set notes ${setNumber}`}
          value={notes ?? ''}
          onChange={(event) =>
            onSetFieldChange(pointer, 'notes', event.target.value)
          }
          placeholder={t(
            'workout.notesPlaceholder',
            'Add a note for this set...'
          )}
          className="mt-2 min-h-16 resize-none"
        />
      )}
    </div>
  );
};

export default memo(WorkoutPlaybackSetRow);
