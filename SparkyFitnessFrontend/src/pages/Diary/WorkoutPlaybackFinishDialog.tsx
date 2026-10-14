import { useTranslation } from 'react-i18next';
import { Check, ArrowRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatRows } from '@/components/ui/stat-rows';
import { Numeral } from '@/components/ui/numeral';
import { Button } from '@/components/ui/button';
import { usePreferences } from '@/contexts/PreferencesContext';
import { formatSecondsClock } from '@/utils/timeFormatters';
import WorkoutFeedbackPanel from './WorkoutFeedbackPanel';

export interface WorkoutFinishSummary {
  name: string;
  durationSeconds: number;
  /** Server-computed total for the saved session, in kcal. */
  caloriesKcal: number;
  completedSets: number;
  totalSets: number;
  volume: number;
  /** The saved session, for end-of-workout feedback (#1560). */
  sessionId?: string;
  exercises?: { id: string; name: string }[];
}

interface WorkoutPlaybackFinishDialogProps {
  summary: WorkoutFinishSummary | null;
  onClose: () => void;
}

/**
 * Shown once a workout has saved (#1507 step 6): how long it took and what it
 * burned, before returning to the diary.
 */
export default function WorkoutPlaybackFinishDialog({
  summary,
  onClose,
}: WorkoutPlaybackFinishDialogProps) {
  const { t } = useTranslation();
  const { energyUnit, convertEnergy, getEnergyUnitString } = usePreferences();

  const calories = summary
    ? Math.round(convertEnergy(summary.caloriesKcal, 'kcal', energyUnit))
    : 0;

  const rows = summary
    ? [
        {
          id: 'duration',
          label: t('exercise.workoutFinishSummary.duration', 'Duration'),
          value: formatSecondsClock(summary.durationSeconds),
        },
        {
          id: 'calories',
          label: t('exercise.workoutFinishSummary.calories', 'Calories'),
          value: `${calories} ${getEnergyUnitString(energyUnit)}`,
        },
        {
          id: 'sets',
          label: t('exercise.workoutFinishSummary.sets', 'Sets'),
          value: `${summary.completedSets}/${summary.totalSets}`,
        },
        {
          id: 'volume',
          label: t('exercise.workoutFinishSummary.volume', 'Volume'),
          value: `${Number(summary.volume.toFixed(1))}`,
        },
      ]
    : [];

  return (
    <Dialog
      open={summary != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader className="items-center text-center">
          <Check className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          <DialogTitle>
            {t('exercise.workoutFinishSummary.title', 'Workout complete')}
          </DialogTitle>
          <DialogDescription>{summary?.name}</DialogDescription>
        </DialogHeader>
        <Numeral
          value={summary ? formatSecondsClock(summary.durationSeconds) : null}
          unit={t('exercise.workoutFinishSummary.duration', 'Duration')}
        />
        <StatRows rows={rows} />
        {summary?.sessionId && (
          <WorkoutFeedbackPanel
            presetEntryId={summary.sessionId}
            exercises={summary.exercises ?? []}
          />
        )}
        <DialogFooter className="border-t pt-4">
          <Button type="button" className="w-full" onClick={onClose}>
            {t('exercise.workoutFinishSummary.done', 'Done')}
            <ArrowRight aria-hidden="true" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
