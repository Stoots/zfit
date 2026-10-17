import { useAttemptEditorFocus } from './useAttemptEditorFocus';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Numeral } from '@/components/ui/numeral';
import { TrendChart } from '@/components/ui/trend-chart';
import {
  selectProgramCardioAssessmentChoices,
  type CooperRunAttempt,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { useCooperRunAttempts } from '@/hooks/CardioTests/useCooperRunAttempts';
import PowerTests from './PowerTests';
import RampTests from './RampTests';
import { useTrainingProgramsList } from '@/hooks/TrainingPrograms/useTrainingPrograms';

export default function CooperRunTests() {
  const { activeUserId } = useActiveUser();
  return <ProfileCooperRunTests key={activeUserId ?? ''} />;
}

function ProfileCooperRunTests() {
  const { t } = useTranslation();
  const { activeUserId, hasPermission, hasWritePermission, isActingOnBehalf } =
    useActiveUser();
  const canRead = hasPermission('diary');
  const canWrite = hasWritePermission('diary');
  const requestedProtocol = new URLSearchParams(window.location.search).get(
    'protocol'
  );
  const focusedPowerProtocol =
    requestedProtocol === 'sprint_6s' || requestedProtocol === 'power_30s';
  const focusedProtocol = focusedPowerProtocol || requestedProtocol === 'ramp';
  const { attempts, create, update } = useCooperRunAttempts(
    activeUserId ?? '',
    canRead
  );
  const programs = useTrainingProgramsList(
    activeUserId ?? '',
    canRead && !isActingOnBehalf
  );
  const [editing, setEditing] = useState<CooperRunAttempt | null>(null);
  const { headingRef, editButtonRef } = useAttemptEditorFocus(
    editing?.id ?? null
  );
  const [attemptDate, setAttemptDate] = useState('');
  const [distance, setDistance] = useState('');
  const latest = attempts.data?.at(-1);
  const [plannedSessionId, setPlannedSessionId] = useState(
    () =>
      new URLSearchParams(window.location.search).get('planned_session_id') ??
      ''
  );
  const selectedPlannedSessionId = programs.isError ? '' : plannedSessionId;
  const assessments = selectProgramCardioAssessmentChoices(
    programs.data ?? [],
    'cooper_run',
    selectedPlannedSessionId
  );
  useEffect(() => {
    if (editing || attemptDate || !selectedPlannedSessionId) return;
    const chosen = assessments.find(
      (item) => item.session.id === selectedPlannedSessionId
    );
    if (chosen) setAttemptDate(chosen.session.effective_date);
  }, [assessments, attemptDate, editing, selectedPlannedSessionId]);
  const mutation = editing ? update : create;
  const pending = create.isPending || update.isPending;
  const linkedEditBlocked = programs.isError && !!editing?.planned_session_id;
  const savingRef = useRef(false);

  const selectAttempt = (attempt: CooperRunAttempt) => {
    if (savingRef.current || pending) return;
    setEditing(attempt);
    setAttemptDate(attempt.attempt_date);
    setDistance(String(attempt.distance_meters));
    setPlannedSessionId(attempt.planned_session_id ?? '');
  };
  const clearForm = () => {
    setEditing(null);
    setAttemptDate('');
    setDistance('');
    setPlannedSessionId('');
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current || pending || linkedEditBlocked) return;
    const distanceMeters = Number(distance);
    if (!attemptDate || !Number.isFinite(distanceMeters) || distanceMeters <= 0)
      return;
    savingRef.current = true;
    try {
      const input = {
        attempt_date: attemptDate,
        distance_meters: distanceMeters,
        planned_session_id: selectedPlannedSessionId || null,
      };
      if (editing) await update.mutateAsync({ id: editing.id, input });
      else await create.mutateAsync(input);
      clearForm();
    } catch {
      // The mutation state and global query error handler present the failure.
    } finally {
      savingRef.current = false;
    }
  };

  return (
    <main className="mx-auto w-full min-w-0 max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">
          {t('cardioTests.title', 'Cardio Tests')}
        </h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          {t(
            'cardioTests.intro',
            'Record Cooper, power, and ramp Test Attempts and compare results over time.'
          )}
        </p>
      </header>

      {!canRead ? (
        <p role="status">
          {t(
            'cardioTests.noAccess',
            'You do not have access to these attempts.'
          )}
        </p>
      ) : !focusedProtocol ? (
        <>
          {latest && !attempts.isError && (
            <section className="rounded-3xl border bg-card p-5 sm:p-6">
              <h2 className="mb-4 text-lg font-semibold">
                {t('cardioTests.cooper.latestResult', 'Latest Cooper run')}
              </h2>
              <Numeral
                value={latest.distance_meters}
                unit="m"
                subline={
                  <time dateTime={latest.attempt_date}>
                    {latest.attempt_date}
                  </time>
                }
              />
            </section>
          )}
          {canWrite ? (
            <form
              onSubmit={submit}
              className="space-y-4 rounded-lg border bg-card p-4 sm:p-6"
            >
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="scroll-mt-4 text-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {editing ? (
                  <>
                    {t('cardioTests.editingAttempt', 'Editing Test Attempt')} ·{' '}
                    <time dateTime={editing.attempt_date}>
                      {editing.attempt_date}
                    </time>
                  </>
                ) : (
                  t('cardioTests.add', 'Record Test Attempt')
                )}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {!isActingOnBehalf && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="cooper-planned-session">
                      {t('cardioTests.plannedSession', 'Planned assessment')}
                    </Label>
                    <select
                      id="cooper-planned-session"
                      value={selectedPlannedSessionId}
                      disabled={pending || programs.isPending}
                      onChange={(event) => {
                        const id = event.target.value;
                        setPlannedSessionId(id);
                        const chosen = assessments.find(
                          (item) => item.session.id === id
                        );
                        if (chosen && !editing)
                          setAttemptDate(chosen.session.effective_date);
                      }}
                      className="flex h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">
                        {t('cardioTests.standalone', 'Standalone Test Attempt')}
                      </option>
                      {assessments.map(({ program, phase, session }) => (
                        <option key={session.id} value={session.id}>
                          {program.name} · {phase.name} · {session.name} ·{' '}
                          {session.effective_date}
                        </option>
                      ))}
                    </select>
                    {programs.isError && (
                      <p role="alert" className="text-sm text-destructive">
                        {t(
                          'cardioTests.plannedAssessmentsUnavailable',
                          'Planned assessments could not be loaded. New attempts will be standalone; linked attempts cannot be edited.'
                        )}
                      </p>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="cooper-attempt-date">
                    {t('cardioTests.date', 'Date')}
                  </Label>
                  <Input
                    id="cooper-attempt-date"
                    type="date"
                    required
                    disabled={pending}
                    value={attemptDate}
                    onChange={(event) => {
                      if (!savingRef.current)
                        setAttemptDate(event.target.value);
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cooper-distance">
                    {t('cardioTests.cooper.distance', '12-minute distance (m)')}
                  </Label>
                  <Input
                    id="cooper-distance"
                    type="number"
                    min="0.01"
                    step="any"
                    required
                    disabled={pending}
                    value={distance}
                    onChange={(event) => {
                      if (!savingRef.current) setDistance(event.target.value);
                    }}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button type="submit" disabled={pending || linkedEditBlocked}>
                  {pending
                    ? t('common.saving', 'Saving…')
                    : editing
                      ? t('common.save', 'Save')
                      : t('cardioTests.record', 'Record Test')}
                  <ArrowRight aria-hidden="true" />
                </Button>
                {editing ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      if (!savingRef.current) clearForm();
                    }}
                  >
                    {t('common.cancel', 'Cancel')}
                  </Button>
                ) : null}
              </div>
              {mutation.isError ? (
                <p role="alert">{mutation.error.message}</p>
              ) : null}
            </form>
          ) : (
            <p role="status">
              {t(
                'cardioTests.readOnly',
                'You can view this history but do not have permission to edit it.'
              )}
            </p>
          )}

          <section aria-labelledby="cooper-history-title" className="space-y-4">
            <h2 id="cooper-history-title" className="text-xl font-semibold">
              {t('cardioTests.history', 'Test Attempt History')}
            </h2>
            {attempts.isPending ? (
              <p role="status">{t('common.loading', 'Loading…')}</p>
            ) : attempts.isError ? (
              <p role="alert">{attempts.error.message}</p>
            ) : attempts.data.length === 0 ? (
              <p>
                {t(
                  'cardioTests.cooper.empty',
                  'No Cooper run Test Attempts recorded yet.'
                )}
              </p>
            ) : (
              <>
                <TrendChart
                  showDots
                  data={attempts.data.map((attempt) => ({
                    label: attempt.attempt_date,
                    value: attempt.distance_meters,
                  }))}
                  label={t(
                    'cardioTests.cooper.chartA11y',
                    'Cooper run distance trend by date'
                  )}
                  valueLabel={t('cardioTests.cooper.distanceLabel', 'Distance')}
                  formatValue={(value) => `${value.toLocaleString()} m`}
                />
                <ol
                  aria-labelledby="cooper-history-title"
                  className="divide-y divide-border border-y"
                >
                  {attempts.data.map((attempt) => (
                    <li
                      key={attempt.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-3"
                    >
                      <div>
                        <time dateTime={attempt.attempt_date}>
                          {attempt.attempt_date}
                        </time>
                        <p className="font-medium tabular-nums">
                          {attempt.distance_meters.toLocaleString()} m
                        </p>
                        {attempt.planned_session_id && (
                          <p className="text-sm text-muted-foreground">
                            {t('cardioTests.scheduled', 'Scheduled assessment')}
                          </p>
                        )}
                      </div>
                      {canWrite ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={pending}
                          onClick={(event) => {
                            editButtonRef.current = event.currentTarget;
                            selectAttempt(attempt);
                          }}
                        >
                          {t('common.edit', 'Edit')}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </>
      ) : null}
      <PowerTests />
      <RampTests />
    </main>
  );
}
