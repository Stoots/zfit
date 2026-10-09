import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { useTrainingPrograms } from '@/hooks/TrainingPrograms/useTrainingPrograms';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import TrainingProgramEditor from './TrainingProgramEditor';
import ProgramSessionOutcome from './ProgramSessionOutcome';
import type { TrainingProgram } from '@workspace/shared';

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
  const [params, setParams] = useSearchParams();
  const id = params.get('program') ?? undefined;
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [outcomeTarget, setOutcomeTarget] = useState<{
    session: TrainingProgram['phases'][number]['weeks'][number]['sessions'][number];
    status: 'missed' | 'completed';
  }>();
  const { programs, program, plans, save, remove, outcome } =
    useTrainingPrograms(userId, true, id);
  const selected = program.data;
  const back = () => {
    setEditing(false);
    setCreating(false);
    setParams({});
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {t('trainingPrograms.title', 'Training Programs')}
          </h1>
          <p className="mt-2 max-w-prose text-muted-foreground">
            {t(
              'trainingPrograms.intro',
              'Work toward a goal over multiple weeks. Organize phases and schedule sessions using your existing Workout Plans.'
            )}
          </p>
        </div>
        <Button variant="outline" asChild className="min-h-11">
          <Link to="/exercises">
            {t('trainingPrograms.managePlans', 'Manage Workout Plans')}
          </Link>
        </Button>
      </header>
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
              <article className="space-y-7">
                <div className="space-y-3 border-b pb-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h2 className="break-words text-2xl font-semibold">
                      {selected.name}
                    </h2>
                    <Badge variant="secondary">
                      {selected.auto_shift
                        ? t(
                            'trainingPrograms.autoShiftOn',
                            'Auto-shift enabled'
                          )
                        : t('trainingPrograms.fixedDates', 'Fixed dates')}
                    </Badge>
                  </div>
                  <p className="whitespace-pre-wrap break-words">
                    {selected.goal}
                  </p>
                  <p className="text-muted-foreground">
                    <time dateTime={selected.start_date}>
                      {selected.start_date}
                    </time>{' '}
                    –{' '}
                    <time dateTime={selected.end_date}>
                      {selected.end_date}
                    </time>
                  </p>
                  {selected.schedule_end_date !== selected.end_date && (
                    <p className="text-sm text-muted-foreground">
                      {t(
                        'trainingPrograms.scheduleEnd',
                        'Resulting schedule ends:'
                      )}{' '}
                      <time dateTime={selected.schedule_end_date}>
                        {selected.schedule_end_date}
                      </time>
                    </p>
                  )}
                  <p className="max-w-prose text-sm text-muted-foreground">
                    {selected.auto_shift
                      ? t(
                          'trainingPrograms.shiftHelp',
                          'Off by default. Each new miss moves later still-planned sessions forward one calendar day, even beyond the authored week or Program. Same-day, missed and completed sessions stay unchanged.'
                        )
                      : t(
                          'trainingPrograms.fixedOutcomeHelp',
                          'Fixed dates: recording a miss leaves all other dates unchanged.'
                        )}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      className="min-h-11"
                      onClick={() => setEditing(true)}
                    >
                      {t('trainingPrograms.edit', 'Edit Training Program')}
                    </Button>
                    <Button
                      variant="destructive"
                      className="min-h-11"
                      onClick={() => {
                        remove.reset();
                        setConfirmDelete(true);
                      }}
                    >
                      {t('trainingPrograms.delete', 'Delete Training Program')}
                    </Button>
                  </div>
                </div>
                {selected.phases.length === 0 && (
                  <p className="text-muted-foreground">
                    {t(
                      'trainingPrograms.noPhases',
                      'No phases yet. Edit your Program to add phases, weeks and Planned Sessions.'
                    )}
                  </p>
                )}
                {selected.phases.map((phase, p) => (
                  <section key={phase.id} className="space-y-4">
                    <h3 className="break-words text-xl font-semibold">
                      {p + 1}. {phase.name}
                    </h3>
                    <p className="whitespace-pre-wrap break-words text-muted-foreground">
                      {phase.goal}
                    </p>
                    {phase.weeks.length === 0 && (
                      <p className="text-muted-foreground">
                        {t(
                          'trainingPrograms.noWeeks',
                          'No weeks scheduled in this phase.'
                        )}
                      </p>
                    )}
                    {phase.weeks.map((week, w) => (
                      <section
                        key={week.id}
                        className="space-y-3 border-t pt-4"
                      >
                        <h4 className="font-semibold">
                          {t('trainingPrograms.weekNumber', {
                            number: w + 1,
                            defaultValue: 'Week {{number}}',
                          })}
                          :{' '}
                          <time dateTime={week.start_date}>
                            {week.start_date}
                          </time>{' '}
                          –{' '}
                          <time dateTime={week.end_date}>{week.end_date}</time>
                        </h4>
                        {week.sessions.length === 0 ? (
                          <p className="text-muted-foreground">
                            {t(
                              'trainingPrograms.noSessions',
                              'No Planned Sessions this week.'
                            )}
                          </p>
                        ) : (
                          <ul className="divide-y">
                            {week.sessions.map((session) => (
                              <li
                                key={session.id}
                                className="grid gap-3 py-4 sm:grid-cols-[9rem_1fr] sm:gap-4"
                              >
                                <div className="space-y-1">
                                  <time
                                    className="tabular-nums"
                                    dateTime={session.effective_date}
                                  >
                                    {session.effective_date}
                                  </time>
                                  {session.effective_date !==
                                    session.scheduled_date && (
                                    <p className="text-sm text-muted-foreground">
                                      {t(
                                        'trainingPrograms.authoredDate',
                                        'Authored:'
                                      )}{' '}
                                      <time dateTime={session.scheduled_date}>
                                        {session.scheduled_date}
                                      </time>
                                    </p>
                                  )}
                                  <Badge
                                    variant={
                                      session.status === 'missed'
                                        ? 'outline'
                                        : 'secondary'
                                    }
                                  >
                                    {t(
                                      `trainingPrograms.state.${session.status}`,
                                      session.status
                                    )}
                                  </Badge>
                                </div>
                                <div className="min-w-0 space-y-2">
                                  <p className="break-words font-medium">
                                    {session.name}
                                  </p>
                                  <p className="break-words text-muted-foreground">
                                    {session.workout_plan_name}
                                  </p>
                                  {session.completed_workout && (
                                    <p className="break-words text-sm">
                                      {t(
                                        'trainingPrograms.linkedWorkout',
                                        'Linked workout:'
                                      )}{' '}
                                      <Link
                                        className="underline underline-offset-4"
                                        to={`/?date=${session.completed_workout.entry_date}`}
                                      >
                                        {session.completed_workout.name} ·{' '}
                                        {session.completed_workout.entry_date}
                                      </Link>
                                    </p>
                                  )}
                                  {session.outcome_at && (
                                    <p className="text-sm text-muted-foreground">
                                      {t(
                                        'trainingPrograms.recordedAt',
                                        'Recorded:'
                                      )}{' '}
                                      <time dateTime={session.outcome_at}>
                                        {new Date(
                                          session.outcome_at
                                        ).toLocaleString()}
                                      </time>
                                    </p>
                                  )}
                                  {session.status === 'planned' && (
                                    <div className="flex flex-wrap gap-3">
                                      <Button
                                        className="min-h-11"
                                        variant="outline"
                                        disabled={outcome.isPending}
                                        onClick={() =>
                                          setOutcomeTarget({
                                            session,
                                            status: 'completed',
                                          })
                                        }
                                      >
                                        {t(
                                          'trainingPrograms.linkCompleted',
                                          'Link completed workout'
                                        )}
                                      </Button>
                                      <Button
                                        className="min-h-11"
                                        variant="outline"
                                        disabled={outcome.isPending}
                                        onClick={() =>
                                          setOutcomeTarget({
                                            session,
                                            status: 'missed',
                                          })
                                        }
                                      >
                                        {t(
                                          'trainingPrograms.markMissed',
                                          'Mark missed'
                                        )}
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    ))}
                  </section>
                ))}
              </article>
            )
          )}
        </>
      ) : (
        <>
          <div>
            <Button className="min-h-11" onClick={() => setCreating(true)}>
              {t('trainingPrograms.create', 'Create Training Program')}
            </Button>
          </div>
          {programs.isPending ? (
            <p role="status">
              {t('trainingPrograms.loading', 'Loading Training Programs…')}
            </p>
          ) : programs.isError ? (
            <div role="alert">
              <p>{programs.error.message}</p>
              <Button onClick={() => void programs.refetch()}>
                {t('common.retry', 'Retry')}
              </Button>
            </div>
          ) : programs.data?.length === 0 ? (
            <div className="space-y-2 border-t py-8">
              <h2 className="text-lg font-semibold">
                {t('trainingPrograms.emptyTitle', 'Your next goal starts here')}
              </h2>
              <p className="max-w-prose text-muted-foreground">
                {t(
                  'trainingPrograms.empty',
                  'Create a Training Program, define your goal and date range, then build the phases and sessions that get you there.'
                )}
              </p>
            </div>
          ) : (
            <ul className="divide-y border-y">
              {programs.data?.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-5"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      className="break-words text-lg font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      to={`?program=${item.id}`}
                    >
                      {item.name}
                    </Link>
                    <p className="mt-1 break-words text-muted-foreground">
                      {item.goal}
                    </p>
                    <p className="mt-2 text-sm tabular-nums text-muted-foreground">
                      {item.start_date} – {item.end_date}
                    </p>
                  </div>
                  <Button asChild variant="outline" className="min-h-11">
                    <Link
                      to={`?program=${item.id}`}
                      aria-label={t('trainingPrograms.viewNamed', {
                        name: item.name,
                        defaultValue: 'View {{name}}',
                      })}
                    >
                      {t('common.view', 'View')}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
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
