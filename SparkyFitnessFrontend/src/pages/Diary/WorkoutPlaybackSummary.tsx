import type { ReactNode } from 'react';
import { StatRows } from '@/components/ui/stat-rows';
import { Numeral } from '@/components/ui/numeral';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Pause,
  Play,
  SkipForward,
  X,
  AlertTriangle,
} from 'lucide-react';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  instantHourMinute,
  userHourMinute,
  WORKOUT_LOCATION_MAX_LENGTH,
} from '@workspace/shared';
import { useWorkoutLocations } from '@/hooks/Exercises/useExerciseEntries';
import type {
  WorkoutPlaybackDraft,
  WorkoutPlaybackStats,
} from '@/utils/workoutPlayback';
import { formatSecondsClock } from '@/utils/timeFormatters';

function formatWorkoutVolume(totalVolume: number): string {
  return `${Number(totalVolume.toFixed(1))}`;
}

interface WorkoutPlaybackSummaryProps {
  draft: WorkoutPlaybackDraft;
  children?: ReactNode;
  elapsedSeconds: number;
  totalVolume: number;
  stats: WorkoutPlaybackStats | null;
  restRemaining: string;
  isRestActive: boolean;
  saveError: string | null;
  requiresSeparateSave: boolean;
  isSaving: boolean;
  timezone: string;
  onCloseKeepDraft: () => void;
  onDiscard: () => void;
  onFinishWorkout: () => void;
  onSaveSeparate: () => void;
  onPauseResumeRest: () => void;
  onSkipRest: () => void;
  onSessionNotesChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onStartTimeChange: (value: string) => void;
}

const WorkoutPlaybackSummary = ({
  draft,
  children,
  elapsedSeconds,
  totalVolume,
  stats,
  restRemaining,
  isRestActive,
  saveError,
  requiresSeparateSave,
  isSaving,
  timezone,
  onCloseKeepDraft,
  onDiscard,
  onFinishWorkout,
  onSaveSeparate,
  onPauseResumeRest,
  onSkipRest,
  onSessionNotesChange,
  onLocationChange,
  onStartTimeChange,
}: WorkoutPlaybackSummaryProps) => {
  const { t } = useTranslation();
  const { data: locationSuggestions = [] } = useWorkoutLocations();

  const startTime = (() => {
    if (!draft.started_at) return '';
    try {
      const hm = instantHourMinute(draft.started_at, timezone);
      return `${String(hm.hour).padStart(2, '0')}:${String(hm.minute).padStart(2, '0')}`;
    } catch {
      return '';
    }
  })();

  return (
    <>
      <header className="flex items-center gap-3 border-b pb-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onCloseKeepDraft}
          aria-label={t('common.back', 'Back')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="min-w-0 break-words text-lg font-semibold">
          {draft.name}
        </h1>
      </header>
      {children}
      {isRestActive && (
        <section
          className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border bg-card p-5"
          aria-label={t('exercise.workoutPlaybackPage.restTimer', 'Rest')}
        >
          <Numeral
            value={restRemaining}
            unit={t('exercise.workoutPlaybackPage.restTimer', 'Rest')}
            size="lg"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={
                draft.rest_timer.state === 'running'
                  ? t('common.pause', 'Pause')
                  : t('common.resume', 'Resume')
              }
              onClick={onPauseResumeRest}
            >
              {draft.rest_timer.state === 'running' ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
            <Button type="button" variant="outline" onClick={onSkipRest}>
              {t('common.skip', 'Skip')}
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>
        </section>
      )}
      <Card>
        <CardContent className="px-4 pt-2 pb-0">
          <StatRows
            rows={[
              {
                id: 'duration',
                label: t(
                  'exercise.workoutPlaybackPage.elapsedTime',
                  'Duration'
                ),
                value: formatSecondsClock(elapsedSeconds),
              },
              {
                id: 'volume',
                label: t('exercise.workoutPlaybackPage.volume', 'Volume'),
                value: formatWorkoutVolume(totalVolume),
              },
              {
                id: 'sets',
                label: t('exercise.workoutPlaybackPage.progress', 'Sets'),
                value: `${stats?.completedSets ?? 0}/${stats?.totalSets ?? 0}`,
              },
            ]}
          />
          <details className="border-t">
            <summary className="min-h-11 cursor-pointer py-3 text-sm text-muted-foreground">
              {t(
                'exercise.workoutPlaybackDialog.sessionDetails',
                'Session details'
              )}
            </summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Start Time */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="startTime" className="text-sm">
                    Start Time
                  </Label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onStartTimeChange('')}
                      disabled={!startTime}
                      className="inline-flex min-h-11 items-center gap-1 rounded-full border border-input bg-background px-3 py-1 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-40 disabled:pointer-events-none"
                      title="Clear time"
                    >
                      <X className="h-4 w-4" />
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const { hour, minute } = userHourMinute(timezone);
                        onStartTimeChange(
                          `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
                        );
                      }}
                      className="inline-flex min-h-11 items-center gap-1 rounded-full border border-input bg-background px-3 py-1 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                      title="Set to current local time"
                    >
                      <Clock className="h-4 w-4" />
                      Now
                    </button>
                  </div>
                </div>
                <Input
                  id="startTime"
                  type="time"
                  value={startTime}
                  onChange={(e) => onStartTimeChange(e.target.value)}
                  className="text-base"
                />
              </div>

              {/* Gym / Location */}
              <div className="space-y-1.5">
                <Label htmlFor="location" className="text-sm">
                  {t(
                    'exercise.workoutPlaybackDialog.location',
                    'Gym / Location'
                  )}
                </Label>
                <Input
                  id="location"
                  type="text"
                  placeholder={t(
                    'exercise.workoutPlaybackDialog.locationPlaceholder',
                    'e.g., Downtown Equinox, Garage Gym'
                  )}
                  value={draft.location ?? ''}
                  onChange={(e) => onLocationChange(e.target.value)}
                  maxLength={WORKOUT_LOCATION_MAX_LENGTH}
                  list="workout-location-suggestions"
                  autoComplete="off"
                  className="text-base"
                />
                <datalist id="workout-location-suggestions">
                  {locationSuggestions.map((location) => (
                    <option key={location} value={location} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="space-y-2 py-3">
              <label
                htmlFor="workout-session-notes"
                className="text-sm font-medium"
              >
                {t('exercise.logExerciseEntryDialog.sessionNotes', 'Notes')}
              </label>
              <Textarea
                id="workout-session-notes"
                value={draft.notes ?? ''}
                rows={2}
                className="resize-none text-sm"
                placeholder={t(
                  'exercise.logExerciseEntryDialog.notesPlaceholder',
                  'Any notes about this session...'
                )}
                onChange={(event) => onSessionNotesChange(event.target.value)}
              />
            </div>
          </details>
          {saveError && (
            <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-2">
                <p>{saveError}</p>
                {requiresSeparateSave && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSaving}
                    onClick={onSaveSeparate}
                  >
                    {t(
                      'exercise.workoutPlaybackDialog.saveSeparate',
                      'Save as a separate workout'
                    )}
                  </Button>
                )}
              </div>
            </div>
          )}
          <StatRows
            rows={[]}
            actions={[
              {
                id: 'close',
                label: t(
                  'exercise.workoutPlaybackDialog.closeKeepDraft',
                  'Close'
                ),
                onClick: onCloseKeepDraft,
              },
              {
                id: 'discard',
                label: t('exercise.workoutPlaybackDialog.discard', 'Discard'),
                onClick: onDiscard,
              },
              {
                id: 'finish',
                label: isSaving
                  ? t('exercise.workoutPlaybackDialog.finishing', 'Saving...')
                  : t(
                      'exercise.workoutPlaybackDialog.finish',
                      'Finish Workout'
                    ),
                onClick: onFinishWorkout,
                disabled: isSaving || requiresSeparateSave,
              },
            ]}
          />
        </CardContent>
      </Card>
    </>
  );
};

export default WorkoutPlaybackSummary;
