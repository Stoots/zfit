import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isDayString } from '@workspace/shared';
import type {
  TrainingProgram,
  TrainingProgramOutcomeInput,
} from '@workspace/shared';
import { useExerciseEntries } from '@/hooks/Exercises/useExerciseEntries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

type Session =
  TrainingProgram['phases'][number]['weeks'][number]['sessions'][number];

export default function ProgramSessionOutcome({
  session,
  status,
  autoShift,
  userId,
  pending,
  onClose,
  onSave,
}: {
  session: Session;
  status: 'missed' | 'completed';
  autoShift: boolean;
  userId: string;
  pending: boolean;
  onClose: () => void;
  onSave: (input: TrainingProgramOutcomeInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [date, setDate] = useState(session.effective_date);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const diary = useExerciseEntries(
    status === 'completed' && isDayString(date) ? date : '',
    userId
  );
  const workout = diary.data?.find(
    (item) => `${item.type}:${item.id}` === selected
  );
  const submit = async () => {
    setError('');
    try {
      if (status === 'missed') await onSave({ status });
      else if (workout)
        await onSave({
          status,
          workout: { type: workout.type, id: workout.id },
        });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : t('trainingPrograms.outcomeError', 'Could not record this outcome.')
      );
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {status === 'missed'
              ? t('trainingPrograms.markMissed', 'Mark missed')
              : t('trainingPrograms.linkCompleted', 'Link completed workout')}
          </DialogTitle>
          <DialogDescription>
            {session.name} · {session.effective_date}
          </DialogDescription>
        </DialogHeader>
        {status === 'missed' ? (
          <p className="text-sm">
            {autoShift
              ? t(
                  'trainingPrograms.missShiftConfirm',
                  'This records a permanent miss and moves later still-planned sessions forward one calendar day. Same-day sessions and existing history stay unchanged.'
                )
              : t(
                  'trainingPrograms.missFixedConfirm',
                  'This records a permanent miss. Fixed dates stay unchanged.'
                )}
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t(
                'trainingPrograms.linkHelp',
                'Choose a workout you actually completed from your diary. Linking records a permanent completion; it does not log a new workout or move any dates.'
              )}
            </p>
            <div>
              <Label htmlFor="completed-workout-date">
                {t('trainingPrograms.workoutDate', 'Diary workout date')}
              </Label>
              <Input
                id="completed-workout-date"
                type="date"
                value={date}
                disabled={pending}
                onChange={(event) => {
                  setDate(event.target.value);
                  setSelected('');
                  setError('');
                }}
              />
            </div>
            {!isDayString(date) ? (
              <p role="alert">
                {t(
                  'trainingPrograms.validWorkoutDate',
                  'Enter a valid diary date.'
                )}
              </p>
            ) : diary.isPending ? (
              <p role="status">
                {t(
                  'trainingPrograms.loadingWorkouts',
                  'Loading diary workouts…'
                )}
              </p>
            ) : diary.isError ? (
              <div role="alert">
                <p>{diary.error.message}</p>
                <Button variant="outline" onClick={() => void diary.refetch()}>
                  {t('common.retry', 'Retry')}
                </Button>
              </div>
            ) : diary.data?.length === 0 ? (
              <p role="status">
                {t(
                  'trainingPrograms.noWorkouts',
                  'No diary workouts on this date. Choose another date or log your completed workout in the diary first.'
                )}
              </p>
            ) : (
              <div>
                <Label htmlFor="completed-workout">
                  {t(
                    'trainingPrograms.completedWorkout',
                    'Completed diary workout'
                  )}
                </Label>
                <select
                  id="completed-workout"
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={selected}
                  disabled={pending}
                  onChange={(event) => setSelected(event.target.value)}
                >
                  <option value="">
                    {t(
                      'trainingPrograms.chooseWorkout',
                      'Choose a completed workout'
                    )}
                  </option>
                  {diary.data?.map((item) => (
                    <option
                      key={`${item.type}:${item.id}`}
                      value={`${item.type}:${item.id}`}
                    >
                      {item.name ||
                        t('trainingPrograms.workoutFallback', 'Workout')}{' '}
                      · {item.entry_date} ·{' '}
                      {item.type === 'preset'
                        ? t(
                            'trainingPrograms.groupedWorkout',
                            'Grouped workout'
                          )
                        : t(
                            'trainingPrograms.individualWorkout',
                            'Standalone workout'
                          )}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={pending}
            onClick={onClose}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            className="min-h-11"
            disabled={
              pending ||
              (status === 'completed' &&
                (!workout || diary.isError || !isDayString(date)))
            }
            onClick={() => void submit()}
          >
            {pending
              ? t('trainingPrograms.recording', 'Recording…')
              : status === 'missed'
                ? t('trainingPrograms.confirmMiss', 'Confirm missed session')
                : t('trainingPrograms.confirmCompletion', 'Confirm completion')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
