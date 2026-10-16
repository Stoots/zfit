import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';
import {
  cardioTestAttemptInputSchema,
  cardioTestProtocols,
  selectProgramCardioAssessmentChoices,
  type CardioTestAttempt,
} from '@workspace/shared';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { useTrainingProgramsList } from '@/hooks/TrainingPrograms/useTrainingPrograms';
import { useProtocolAttempts } from '@/hooks/CardioTests/useCooperRunAttempts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { trendChartTheme } from '@/components/ui/trend-chart';
import { parseWattsInput } from './wattsInput';

export default function RampTests() {
  const { t } = useTranslation();
  const { activeUserId, hasPermission, hasWritePermission, isActingOnBehalf } =
    useActiveUser();
  const requestedProtocol = new URLSearchParams(window.location.search).get(
    'protocol'
  );
  if (
    !activeUserId ||
    !hasPermission('diary') ||
    (requestedProtocol && requestedProtocol !== 'ramp')
  )
    return null;
  return (
    <RampProfile
      key={activeUserId}
      userId={activeUserId}
      canWrite={hasWritePermission('diary')}
      isActingOnBehalf={isActingOnBehalf}
      title={t('cardioTests.ramp.title', 'Ramp Test')}
    />
  );
}

function RampProfile({
  userId,
  canWrite,
  isActingOnBehalf,
  title,
}: {
  userId: string;
  canWrite: boolean;
  isActingOnBehalf: boolean;
  title: string;
}) {
  const { t } = useTranslation();
  const { attempts, save } = useProtocolAttempts(userId, 'ramp');
  const programs = useTrainingProgramsList(userId, !isActingOnBehalf);
  const [date, setDate] = useState('');
  const [plannedSessionId, setPlannedSessionId] = useState(() =>
    new URLSearchParams(window.location.search).get('protocol') === 'ramp'
      ? (new URLSearchParams(window.location.search).get(
          'planned_session_id'
        ) ?? '')
      : ''
  );
  const selectedPlannedSessionId = programs.isError ? '' : plannedSessionId;
  const assessments = selectProgramCardioAssessmentChoices(
    programs.data ?? [],
    'ramp',
    selectedPlannedSessionId
  );
  const [maximumWatts, setMaximumWatts] = useState('');
  const [peakHeartRate, setPeakHeartRate] = useState('');
  const [oneMinuteHeartRate, setOneMinuteHeartRate] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [validationError, setValidationError] = useState('');
  const savingRef = useRef(false);
  const linkedEditBlocked = programs.isError && !!editing && !!plannedSessionId;
  useEffect(() => {
    if (date || !selectedPlannedSessionId) return;
    const chosen = assessments.find(
      ({ session }) => session.id === selectedPlannedSessionId
    );
    if (chosen) setDate(chosen.session.effective_date);
  }, [assessments, date, selectedPlannedSessionId]);

  const clear = () => {
    setDate('');
    setPlannedSessionId('');
    setMaximumWatts('');
    setPeakHeartRate('');
    setOneMinuteHeartRate('');
    setEditing(null);
    setValidationError('');
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current || save.isPending || linkedEditBlocked) return;
    const parsed = cardioTestAttemptInputSchema.safeParse({
      test_type: 'ramp',
      attempt_date: date,
      results: {
        maximum_watts: parseWattsInput(maximumWatts),
        peak_heart_rate: Number(peakHeartRate),
        one_minute_heart_rate: Number(oneMinuteHeartRate),
      },
      ...(editing || selectedPlannedSessionId
        ? { planned_session_id: selectedPlannedSessionId || null }
        : {}),
    });
    if (
      !maximumWatts.trim() ||
      !peakHeartRate.trim() ||
      !oneMinuteHeartRate.trim() ||
      !parsed.success
    ) {
      setValidationError(
        t(
          'cardioTests.ramp.invalid',
          'Enter valid watts and positive whole-number heart rates.'
        )
      );
      return;
    }
    savingRef.current = true;
    try {
      await save.mutateAsync({ input: parsed.data, id: editing ?? undefined });
      clear();
    } catch {
      /* Error is shown below. */
    } finally {
      savingRef.current = false;
    }
  };
  const rows = (attempts.data ?? []).filter(
    (attempt): attempt is Extract<CardioTestAttempt, { test_type: 'ramp' }> =>
      attempt.test_type === 'ramp'
  );
  const recovery =
    peakHeartRate && oneMinuteHeartRate
      ? Number(peakHeartRate) - Number(oneMinuteHeartRate)
      : null;
  const fields = [
    {
      id: 'maximum-watts',
      label: t('cardioTests.ramp.maximumWatts', 'Maximum watts (W)'),
      value: maximumWatts,
      set: setMaximumWatts,
      step: 'any',
    },
    {
      id: 'peak-heart-rate',
      label: t('cardioTests.ramp.peakHeartRate', 'Peak heart rate (bpm)'),
      value: peakHeartRate,
      set: setPeakHeartRate,
      step: '1',
    },
    {
      id: 'one-minute-heart-rate',
      label: t(
        'cardioTests.ramp.oneMinuteHeartRate',
        'One-minute heart rate (bpm)'
      ),
      value: oneMinuteHeartRate,
      set: setOneMinuteHeartRate,
      step: '1',
    },
  ];
  return (
    <section className="space-y-4" aria-label={title}>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">
        {t(
          'cardioTests.ramp.protocol',
          `${cardioTestProtocols.ramp.initial_watts} W initially, increasing by ${cardioTestProtocols.ramp.increment_watts_per_minute} W per minute`
        )}
      </p>
      {canWrite && (
        <form
          onSubmit={submit}
          className="space-y-4 rounded-lg border bg-card p-4 sm:p-6"
        >
          {!isActingOnBehalf && (
            <div>
              <Label htmlFor="ramp-planned-session">
                {t('cardioTests.plannedSession', 'Planned assessment')}
              </Label>
              <select
                id="ramp-planned-session"
                className="flex h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base"
                value={selectedPlannedSessionId}
                disabled={save.isPending || programs.isPending}
                onChange={(event) => {
                  const id = event.target.value;
                  setPlannedSessionId(id);
                  const chosen = assessments.find(
                    ({ session }) => session.id === id
                  );
                  if (chosen && !editing)
                    setDate(chosen.session.effective_date);
                }}
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
          <div>
            <Label htmlFor="ramp-date">{t('cardioTests.date', 'Date')}</Label>
            <Input
              id="ramp-date"
              type="date"
              required
              disabled={save.isPending}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map(({ id, label, value, set, step }) => (
              <div key={id}>
                <Label htmlFor={`ramp-${id}`}>{label}</Label>
                <Input
                  id={`ramp-${id}`}
                  type={id === 'maximum-watts' ? 'text' : 'number'}
                  inputMode={id === 'maximum-watts' ? 'decimal' : 'numeric'}
                  pattern={
                    id === 'maximum-watts' ? '[0-9]+([.,][0-9]+)?' : undefined
                  }
                  min={id === 'maximum-watts' ? '0' : '1'}
                  step={step}
                  required
                  disabled={save.isPending}
                  value={value}
                  onChange={(event) => {
                    set(event.target.value);
                    setValidationError('');
                  }}
                />
              </div>
            ))}
          </div>
          {recovery !== null && Number.isFinite(recovery) && (
            <p aria-live="polite">
              {t('cardioTests.ramp.recovery', 'Heart-rate recovery')}:{' '}
              {recovery} bpm
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={save.isPending || linkedEditBlocked}
            >
              {editing
                ? t('common.save', 'Save')
                : t('cardioTests.ramp.record', 'Record Ramp Test')}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending}
                onClick={clear}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
            )}
          </div>
          {save.isError && <p role="alert">{save.error.message}</p>}
          {validationError && <p role="alert">{validationError}</p>}
        </form>
      )}
      {attempts.isPending ? (
        <p role="status">{t('common.loading', 'Loading…')}</p>
      ) : attempts.isError ? (
        <p role="alert">{attempts.error.message}</p>
      ) : rows.length === 0 ? (
        <p>{t('cardioTests.ramp.empty', 'No Test Attempts recorded yet.')}</p>
      ) : (
        <>
          <div
            className="h-80 sm:h-64"
            role="img"
            aria-label={t('cardioTests.ramp.chart', 'Ramp Test trend by date')}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={rows.map((attempt) => ({
                  date: attempt.attempt_date,
                  watts: attempt.results.maximum_watts,
                  recovery:
                    attempt.results.peak_heart_rate -
                    attempt.results.one_minute_heart_rate,
                }))}
              >
                <XAxis dataKey="date" tick={trendChartTheme.axis} />
                <YAxis yAxisId="watts" tick={trendChartTheme.axis} />
                <YAxis
                  yAxisId="recovery"
                  orientation="right"
                  tick={trendChartTheme.axis}
                />
                <Tooltip contentStyle={trendChartTheme.tooltip} />
                <Legend />
                <Line
                  yAxisId="watts"
                  isAnimationActive={false}
                  dataKey="watts"
                  name={t('cardioTests.ramp.maximumWatts', 'Maximum watts (W)')}
                  stroke="hsl(var(--chart-1))"
                />
                <Line
                  yAxisId="recovery"
                  isAnimationActive={false}
                  dataKey="recovery"
                  name={t('cardioTests.ramp.recovery', 'Heart-rate recovery')}
                  stroke="hsl(var(--chart-2))"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ol className="divide-y rounded-lg border">
            {rows.map((attempt) => (
              <li
                key={attempt.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0 break-words">
                  <time dateTime={attempt.attempt_date}>
                    {attempt.attempt_date}
                  </time>
                  <p>
                    {attempt.results.maximum_watts} W ·{' '}
                    {attempt.results.peak_heart_rate} bpm ·{' '}
                    {attempt.results.one_minute_heart_rate} bpm ·{' '}
                    {attempt.results.peak_heart_rate -
                      attempt.results.one_minute_heart_rate}{' '}
                    bpm {t('cardioTests.ramp.recovery', 'Heart-rate recovery')}
                  </p>
                </div>
                {canWrite && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={save.isPending}
                    onClick={() => {
                      if (savingRef.current) return;
                      setEditing(attempt.id);
                      setDate(attempt.attempt_date);
                      setPlannedSessionId(attempt.planned_session_id ?? '');
                      setMaximumWatts(String(attempt.results.maximum_watts));
                      setPeakHeartRate(String(attempt.results.peak_heart_rate));
                      setOneMinuteHeartRate(
                        String(attempt.results.one_minute_heart_rate)
                      );
                    }}
                  >
                    {t('common.edit', 'Edit')}
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
