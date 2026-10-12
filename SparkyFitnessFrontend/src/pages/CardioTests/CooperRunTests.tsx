import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CooperRunAttempt } from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { useCooperRunAttempts } from '@/hooks/CardioTests/useCooperRunAttempts';

export default function CooperRunTests() {
  const { activeUserId } = useActiveUser();
  return <ProfileCooperRunTests key={activeUserId ?? ''} />;
}

function ProfileCooperRunTests() {
  const { t } = useTranslation();
  const { activeUserId, hasPermission, hasWritePermission } = useActiveUser();
  const canRead = hasPermission('diary');
  const canWrite = hasWritePermission('diary');
  const { attempts, create, update } = useCooperRunAttempts(
    activeUserId ?? '',
    canRead
  );
  const [editing, setEditing] = useState<CooperRunAttempt | null>(null);
  const [attemptDate, setAttemptDate] = useState('');
  const [distance, setDistance] = useState('');
  const mutation = editing ? update : create;
  const pending = create.isPending || update.isPending;
  const savingRef = useRef(false);

  const selectAttempt = (attempt: CooperRunAttempt) => {
    if (savingRef.current || pending) return;
    setEditing(attempt);
    setAttemptDate(attempt.attempt_date);
    setDistance(String(attempt.distance_meters));
  };
  const clearForm = () => {
    setEditing(null);
    setAttemptDate('');
    setDistance('');
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current || pending) return;
    const distanceMeters = Number(distance);
    if (!attemptDate || !Number.isFinite(distanceMeters) || distanceMeters <= 0)
      return;
    savingRef.current = true;
    try {
      const input = {
        attempt_date: attemptDate,
        distance_meters: distanceMeters,
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
    <main className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">
          {t('cardioTests.title', 'Cardio Tests')}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {t(
            'cardioTests.cooper.intro',
            'Record the distance you cover in a 12-minute Cooper run and compare attempts over time.'
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
      ) : (
        <>
          {canWrite ? (
            <form onSubmit={submit} className="space-y-4 rounded-lg border p-4">
              <h2 className="text-lg font-semibold">
                {editing
                  ? t('cardioTests.edit', 'Edit Test Attempt')
                  : t('cardioTests.add', 'Record Test Attempt')}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
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
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={pending}>
                  {pending
                    ? t('common.saving', 'Saving…')
                    : editing
                      ? t('common.save', 'Save')
                      : t('cardioTests.record', 'Record Test')}
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
                <div
                  className="h-64 w-full"
                  role="img"
                  aria-label={t(
                    'cardioTests.cooper.chartA11y',
                    'Cooper run distance trend by date'
                  )}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={attempts.data}
                      margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="attempt_date" />
                      <YAxis
                        width={64}
                        tickFormatter={(value: number) =>
                          `${value.toLocaleString()} m`
                        }
                      />
                      <Tooltip
                        formatter={(value) => [
                          `${Number(value).toLocaleString()} m`,
                          t('cardioTests.cooper.distanceLabel', 'Distance'),
                        ]}
                        labelFormatter={(label) => String(label)}
                      />
                      <Line
                        type="monotone"
                        dataKey="distance_meters"
                        name={t('cardioTests.cooper.distanceLabel', 'Distance')}
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <ol className="divide-y rounded-lg border">
                  {attempts.data.map((attempt) => (
                    <li
                      key={attempt.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-3"
                    >
                      <div>
                        <time dateTime={attempt.attempt_date}>
                          {attempt.attempt_date}
                        </time>
                        <p className="font-semibold">
                          {attempt.distance_meters.toLocaleString()} m
                        </p>
                      </div>
                      {canWrite ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={pending}
                          onClick={() => selectAttempt(attempt)}
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
      )}
    </main>
  );
}
