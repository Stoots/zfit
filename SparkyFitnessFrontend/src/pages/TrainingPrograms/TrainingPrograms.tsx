import { ArrowRight } from 'lucide-react';
import { todayInZone } from '@workspace/shared';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { exerciseByIdOptions } from '@/hooks/Exercises/useExercises';
import { useTrainingPrograms } from '@/hooks/TrainingPrograms/useTrainingPrograms';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { createWorkoutPlaybackRouteState } from '@/utils/workoutPlayback';
import { buildWorkoutPlanSessionPreset } from '@/utils/workoutPlanSession';
import type { TrainingProgram } from '@workspace/shared';
import TrainingProgramEditor from './TrainingProgramEditor';
import ProgramSessionOutcome from './ProgramSessionOutcome';
import ProgramList from './ProgramList';
import ProgramDetail from './ProgramDetail';
import type { ProgramSession, OutcomeStatus } from './programTypes';
export default function TrainingPrograms() {
  const { user } = useAuth();
  const { isActingOnBehalf } = useActiveUser();
  const { t } = useTranslation();
  if (!user || isActingOnBehalf)
    return (
      <p role="status">
        {t(
          'trainingPrograms.ownerOnly',
          'Training Programs are private. Switch to your own profile to author or view them.'
        )}
      </p>
    );
  return <ProgramWorkspace key={user.id} userId={user.id} />;
}

function ProgramWorkspace({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { timezone } = usePreferences();
  const today = todayInZone(timezone);
  const queryClient = useQueryClient();
  const [startingSession, setStartingSession] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const id = params.get('program') ?? undefined;
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [outcomeTarget, setOutcomeTarget] = useState<{
    session: ProgramSession;
    status: OutcomeStatus;
  }>();
  const { programs, program, plans, save, remove, outcome } =
    useTrainingPrograms(userId, true, id);
  const selected = program.data;
  const startWorkout = async (
    session: TrainingProgram['phases'][number]['weeks'][number]['sessions'][number]
  ) => {
    if (!session.workout_session_id) return;
    setStartingSession(session.id);
    setStartError(null);
    try {
      const plan = plans.data?.find((item) =>
        item.sessions.some(
          (workout) => workout.id === session.workout_session_id
        )
      );
      if (!plan)
        throw new Error(
          t(
            'trainingPrograms.sessionUnavailable',
            'The selected Workout Session is unavailable. Reload the plans or choose its exact replacement.'
          )
        );
      const preset = await buildWorkoutPlanSessionPreset(
        plan,
        session.workout_session_id,
        userId,
        (exerciseId) => queryClient.fetchQuery(exerciseByIdOptions(exerciseId))
      );
      if (!selected) throw new Error('Training Program is unavailable.');
      preset.training_program = {
        program_id: selected.id,
        session_id: session.id,
      };
      navigate(`/workout-playback?date=${session.effective_date}`, {
        state: createWorkoutPlaybackRouteState(
          preset,
          session.effective_date,
          { userId, activeUserId: userId },
          `${window.location.pathname}${window.location.search}`
        ),
      });
    } catch (error) {
      setStartError(
        error instanceof Error
          ? error.message
          : t(
              'trainingPrograms.startError',
              'Could not start the selected workout.'
            )
      );
    } finally {
      setStartingSession(null);
    }
  };
  const back = () => {
    setEditing(false);
    setCreating(false);
    setParams({});
  };

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {t('trainingPrograms.title', 'Training Programs')}
          </h1>
          <p className="mt-2 max-w-prose text-muted-foreground">
            {t(
              'trainingPrograms.intro',
              'Work toward a goal over multiple weeks. Organize phases and schedule Workout Sessions or Cardio Tests.'
            )}
          </p>
        </div>
        <Button variant="outline" asChild className="min-h-11">
          <Link to="/exercises">
            {t('trainingPrograms.managePlans', 'Manage Workout Plans')}
          </Link>
        </Button>
      </header>
      {startError && (
        <p role="alert" className="text-destructive">
          {startError}
        </p>
      )}
      {creating || editing ? (
        <>
          {plans.isPending ? (
            <p role="status">
              {t('trainingPrograms.loadingPlans', 'Loading Workout Plans…')}
            </p>
          ) : plans.isError ? (
            <div role="alert">
              <p>{plans.error.message}</p>
              <Button onClick={() => void plans.refetch()}>
                {t('common.retry', 'Retry')}
              </Button>
            </div>
          ) : (
            <TrainingProgramEditor
              key={creating ? 'new' : selected?.id}
              initial={creating ? undefined : selected}
              plans={plans.data ?? []}
              pending={save.isPending}
              onCancel={() => {
                setCreating(false);
                setEditing(false);
              }}
              onSave={async (input) => {
                const saved = await save.mutateAsync({
                  input,
                  id: creating ? undefined : id,
                });
                setCreating(false);
                setEditing(false);
                setParams({ program: saved.id });
              }}
            />
          )}
        </>
      ) : id ? (
        <>
          <Button variant="outline" onClick={back} className="min-h-11">
            {t('trainingPrograms.back', 'All Training Programs')}
          </Button>
          {program.isPending ? (
            <p role="status">
              {t('trainingPrograms.loading', 'Loading Training Programs…')}
            </p>
          ) : program.isError ? (
            <div role="alert">
              <p>{program.error.message}</p>
              <Button onClick={() => void program.refetch()}>
                {t('common.retry', 'Retry')}
              </Button>
            </div>
          ) : (
            selected && (
              <ProgramDetail
                selected={selected}
                today={today}
                outcomePending={outcome.isPending}
                startingSessionId={startingSession}
                onStartSession={startWorkout}
                onEdit={() => setEditing(true)}
                onDelete={() => {
                  remove.reset();
                  setConfirmDelete(true);
                }}
                onRecordOutcome={setOutcomeTarget}
              />
            )
          )}
        </>
      ) : (
        <>
          <div>
            <Button className="min-h-11" onClick={() => setCreating(true)}>
              {t('trainingPrograms.create', 'Create Training Program')}
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
          <ProgramList programs={programs} today={today} />
        </>
      )}
      {selected && outcomeTarget && (
        <ProgramSessionOutcome
          key={`${outcomeTarget.session.id}-${outcomeTarget.status}`}
          userId={userId}
          session={outcomeTarget.session}
          status={outcomeTarget.status}
          autoShift={selected.auto_shift}
          pending={outcome.isPending}
          onClose={() => setOutcomeTarget(undefined)}
          onSave={async (input) => {
            await outcome.mutateAsync({
              programId: selected.id,
              sessionId: outcomeTarget.session.id,
              input,
            });
            setOutcomeTarget(undefined);
          }}
        />
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('trainingPrograms.delete', 'Delete Training Program')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'trainingPrograms.deleteHelp',
                'This deletes the Program, its phases, weeks and Planned Sessions. Your standalone Workout Plans are kept. This cannot be undone.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {remove.isError && (
            <p role="alert" className="text-destructive">
              {remove.error.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              {t('common.cancel', 'Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!id) return;
                void remove
                  .mutateAsync(id)
                  .then(() => {
                    setConfirmDelete(false);
                    back();
                  })
                  .catch(() => {
                    /* Error remains visible in the confirmation. */
                  });
              }}
            >
              {remove.isPending
                ? t('common.deleting', 'Deleting…')
                : t('trainingPrograms.confirmDelete', 'Delete Program')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
