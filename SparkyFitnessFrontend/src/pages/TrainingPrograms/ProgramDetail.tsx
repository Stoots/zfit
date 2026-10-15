import { ArrowRight, Check } from 'lucide-react';
import { Numeral } from '@/components/ui/numeral';
import { cn } from '@/lib/utils';
import ProgramSchedule from './ProgramSchedule';
import { programProgress } from './programProgress';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TrainingProgram } from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import SessionRowActions from './SessionRowActions';
import type { ProgramSession, OutcomeStatus } from './programTypes';
import { cardioTestTitle } from './cardioTestTitle';

const recordableTests = new Set(['cooper_run', 'sprint_6s', 'power_30s']);

function recordTestPath(session: ProgramSession): string {
  const params = new URLSearchParams({ planned_session_id: session.id });
  if (session.cardio_test_type !== 'cooper_run')
    params.set('protocol', session.cardio_test_type!);
  return `/cardio-tests?${params}`;
}

export default function ProgramDetail({
  selected,
  today,
  outcomePending,
  startingSessionId,
  onStartSession,
  onEdit,
  onDelete,
  onRecordOutcome,
}: {
  selected: TrainingProgram;
  today: string;
  outcomePending: boolean;
  startingSessionId: string | null;
  onStartSession: (session: ProgramSession) => void;
  onEdit: () => void;
  onDelete: () => void;
  onRecordOutcome: (target: {
    session: ProgramSession;
    status: OutcomeStatus;
  }) => void;
}) {
  const { t } = useTranslation();
  const progress = programProgress(selected, today);
  return (
    <article className="min-w-0 space-y-8">
      <div className="space-y-4 rounded-3xl border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="min-w-0 flex-1 break-words text-2xl font-semibold">
            {selected.name}
          </h2>
          <Badge variant="secondary">
            {selected.auto_shift
              ? t('trainingPrograms.autoShiftOn', 'Auto-shift enabled')
              : t('trainingPrograms.fixedDates', 'Fixed dates')}
          </Badge>
        </div>
        <Numeral
          value={progress.current}
          unit={t('trainingPrograms.weekProgress', {
            current: progress.current,
            total: progress.total,
            defaultValue: 'Week {{current}} of {{total}}',
          })}
        />
        <p className="whitespace-pre-wrap break-words">{selected.goal}</p>
        <p className="text-muted-foreground">
          <time dateTime={selected.start_date}>{selected.start_date}</time> –{' '}
          <time dateTime={selected.end_date}>{selected.end_date}</time>
        </p>
        {selected.schedule_end_date !== selected.end_date && (
          <p className="text-sm text-muted-foreground">
            {t('trainingPrograms.scheduleEnd', 'Resulting schedule ends:')}{' '}
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
          <Button className="min-h-11" onClick={onEdit}>
            {t('trainingPrograms.edit', 'Edit Training Program')}{' '}
            <ArrowRight aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            className="min-h-11 text-destructive"
            onClick={onDelete}
          >
            {t('trainingPrograms.delete', 'Delete Training Program')}
          </Button>
        </div>
      </div>
      <ProgramSchedule program={selected} today={today} />
      {selected.phases.length === 0 && (
        <p className="text-muted-foreground">
          {t(
            'trainingPrograms.noPhases',
            'No phases yet. Edit your Program to add phases, weeks and Planned Sessions.'
          )}
        </p>
      )}
      {selected.phases.map((phase, p) => (
        <section key={phase.id} className="min-w-0 space-y-4">
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
            <section key={week.id} className="min-w-0 space-y-3 border-t pt-4">
              <h4 className="font-semibold">
                {t('trainingPrograms.weekNumber', {
                  number: w + 1,
                  defaultValue: 'Week {{number}}',
                })}
                : <time dateTime={week.start_date}>{week.start_date}</time> –{' '}
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
                      id={`program-session-${session.id}`}
                      tabIndex={-1}
                      aria-current={
                        session.effective_date === today ? 'date' : undefined
                      }
                      className={cn(
                        'grid min-w-0 scroll-mt-24 gap-3 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4',
                        session.effective_date === today &&
                          'rounded-lg outline -outline-offset-1 outline-primary',
                        session.status === 'completed' &&
                          'text-muted-foreground'
                      )}
                    >
                      <div className="space-y-1">
                        <time
                          className="tabular-nums"
                          dateTime={session.effective_date}
                        >
                          {session.effective_date}
                        </time>
                        {session.effective_date !== session.scheduled_date && (
                          <p className="text-sm text-muted-foreground">
                            {t('trainingPrograms.authoredDate', 'Authored:')}{' '}
                            <time dateTime={session.scheduled_date}>
                              {session.scheduled_date}
                            </time>
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Badge
                            className={
                              session.status === 'missed'
                                ? 'border-destructive/30 text-destructive'
                                : 'text-muted-foreground'
                            }
                            variant={
                              session.status === 'missed'
                                ? 'outline'
                                : 'secondary'
                            }
                          >
                            {session.status === 'completed' && (
                              <Check
                                className="mr-1 size-3"
                                aria-hidden="true"
                              />
                            )}
                            {t(
                              `trainingPrograms.state.${session.status}`,
                              session.status
                            )}
                          </Badge>
                          {session.is_optional && (
                            <Badge variant="outline">
                              {t('trainingPrograms.optional', 'Optional')}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="min-w-0 space-y-2">
                        <p className="break-words font-medium">
                          {session.name}
                        </p>
                        <p className="break-words text-muted-foreground">
                          {session.cardio_test_type
                            ? cardioTestTitle(session.cardio_test_type, t)
                            : `${session.workout_plan_name} · ${session.workout_session_name}`}
                        </p>
                        {session.completed_test_attempt && (
                          <p className="break-words text-sm">
                            {t(
                              'trainingPrograms.linkedAttempt',
                              'Linked Test Attempt:'
                            )}{' '}
                            {session.completed_test_attempt.test_type ===
                            'cooper_run' ? (
                              <Link
                                className="underline underline-offset-4"
                                to="/cardio-tests"
                              >
                                {session.completed_test_attempt.attempt_date} ·{' '}
                                {String(
                                  session.completed_test_attempt.results[
                                    'distance_meters'
                                  ]
                                )}{' '}
                                {t('cardioTests.unit.meters', 'm')}
                              </Link>
                            ) : (
                              session.completed_test_attempt.attempt_date
                            )}
                          </p>
                        )}
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
                            {t('trainingPrograms.recordedAt', 'Recorded:')}{' '}
                            <time dateTime={session.outcome_at}>
                              {new Date(session.outcome_at).toLocaleString()}
                            </time>
                          </p>
                        )}
                        {recordableTests.has(session.cardio_test_type ?? '') &&
                          (session.status === 'planned' ||
                            (session.status === 'omitted' &&
                              session.is_optional)) && (
                            <Button asChild className="min-h-11">
                              <Link to={recordTestPath(session)}>
                                {t(
                                  'trainingPrograms.recordTest',
                                  'Record Test Attempt'
                                )}
                              </Link>
                            </Button>
                          )}
                        {!session.cardio_test_type &&
                          session.status === 'planned' && (
                            <Button
                              className="min-h-11"
                              disabled={startingSessionId === session.id}
                              onClick={() => onStartSession(session)}
                            >
                              {startingSessionId === session.id
                                ? t('common.loading', 'Starting…')
                                : t(
                                    'trainingPrograms.startWorkout',
                                    'Start Workout'
                                  )}
                            </Button>
                          )}
                        <SessionRowActions
                          session={session}
                          disabled={outcomePending}
                          onRecord={onRecordOutcome}
                        />
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
  );
}
