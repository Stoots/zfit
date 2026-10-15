import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  cardioTestAttemptInputSchema,
  sprintPowerResults,
  powerTestInput,
  powerTestValues,
  toNumber,
  type CardioTestAttempt,
} from '@workspace/shared';
import { usePowerTestAttempts } from '@/hooks/CardioTests/useCooperRunAttempts';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Protocol = 'sprint_6s' | 'power_30s';
const wattInputPattern = /^\d+(?:[.,]\d+)?$/;

function parseWattsInput(value: string): number {
  const text = value.trim();
  // These short measurements use one separator as a decimal, never grouping.
  if (!wattInputPattern.test(text)) return Number.NaN;
  return toNumber(text, text.includes(',') ? 'eu' : 'us') ?? Number.NaN;
}

const config = {
  sprint_6s: {
    title: '5 × 6-second sprint (54-second rests)',
    labels: [
      'Effort 1 peak (W)',
      'Effort 2 peak (W)',
      'Effort 3 peak (W)',
      'Effort 4 peak (W)',
      'Effort 5 peak (W)',
    ],
  },
  power_30s: {
    title: '2 × 30-second power (60-second rest)',
    labels: [
      'Effort 1 peak (W)',
      'Effort 1 average (W)',
      'Effort 2 peak (W)',
      'Effort 2 average (W)',
    ],
  },
} as const;

export default function PowerTests() {
  const { activeUserId, hasPermission, hasWritePermission } = useActiveUser();
  if (!activeUserId || !hasPermission('diary')) return null;
  return (
    <div className="space-y-8">
      <PowerProtocol
        key={`${activeUserId}-sprint`}
        userId={activeUserId}
        protocol="sprint_6s"
        canWrite={hasWritePermission('diary')}
      />
      <PowerProtocol
        key={`${activeUserId}-thirty`}
        userId={activeUserId}
        protocol="power_30s"
        canWrite={hasWritePermission('diary')}
      />
    </div>
  );
}

function PowerProtocol({
  userId,
  protocol,
  canWrite,
}: {
  userId: string;
  protocol: Protocol;
  canWrite: boolean;
}) {
  const { t } = useTranslation();
  const { attempts, save } = usePowerTestAttempts(userId, protocol);
  const [date, setDate] = useState('');
  const [values, setValues] = useState<string[]>(
    config[protocol].labels.map(() => '')
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [validationError, setValidationError] = useState('');
  const savingRef = useRef(false);
  const title =
    protocol === 'sprint_6s'
      ? t('cardioTests.sprint_6s.title', config.sprint_6s.title)
      : t('cardioTests.power_30s.title', config.power_30s.title);
  const labels =
    protocol === 'sprint_6s'
      ? [
          t('cardioTests.sprint_6s.field0', 'Effort 1 peak (W)'),
          t('cardioTests.sprint_6s.field1', 'Effort 2 peak (W)'),
          t('cardioTests.sprint_6s.field2', 'Effort 3 peak (W)'),
          t('cardioTests.sprint_6s.field3', 'Effort 4 peak (W)'),
          t('cardioTests.sprint_6s.field4', 'Effort 5 peak (W)'),
        ]
      : [
          t('cardioTests.power_30s.field0', 'Effort 1 peak (W)'),
          t('cardioTests.power_30s.field1', 'Effort 1 average (W)'),
          t('cardioTests.power_30s.field2', 'Effort 2 peak (W)'),
          t('cardioTests.power_30s.field3', 'Effort 2 average (W)'),
        ];
  const clear = () => {
    setDate('');
    setValues(labels.map(() => ''));
    setEditing(null);
    setValidationError('');
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      savingRef.current ||
      save.isPending ||
      values.some((value) => value.trim() === '')
    )
      return;
    const parsed = cardioTestAttemptInputSchema.safeParse(
      powerTestInput(protocol, date, values.map(parseWattsInput))
    );
    if (!parsed.success) {
      setValidationError(
        t(
          'cardioTests.invalidPower',
          'Enter nonnegative watts, with each average no greater than its peak.'
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
  const select = (attempt: CardioTestAttempt) => {
    if (savingRef.current || save.isPending) return;
    setValidationError('');
    setEditing(attempt.id);
    setDate(attempt.attempt_date);
    setValues(powerTestValues(attempt).map(String));
  };
  const rows = (attempts.data ?? []).filter(
    (attempt) => attempt.test_type === protocol
  );
  const data = rows.map((attempt) => ({
    attempt_date: attempt.attempt_date,
    ...Object.fromEntries(
      powerTestValues(attempt).map((value, index) => [`effort${index}`, value])
    ),
  }));
  return (
    <section className="space-y-4" aria-label={title}>
      <h2 className="text-xl font-semibold">{title}</h2>
      {canWrite && (
        <form onSubmit={submit} className="space-y-4 rounded-lg border p-4">
          <div>
            <Label htmlFor={`${protocol}-date`}>
              {t('cardioTests.date', 'Date')}
            </Label>
            <Input
              id={`${protocol}-date`}
              type="date"
              required
              disabled={save.isPending}
              value={date}
              onChange={(event) => {
                if (!savingRef.current) {
                  setDate(event.target.value);
                  setValidationError('');
                }
              }}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {labels.map((label, index) => (
              <div key={label}>
                <Label htmlFor={`${protocol}-${index}`}>{label}</Label>
                <Input
                  id={`${protocol}-${index}`}
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]+([.,][0-9]+)?"
                  required
                  disabled={save.isPending}
                  value={values[index]}
                  onChange={(event) => {
                    if (!savingRef.current) {
                      setValues((current) =>
                        current.map((value, position) =>
                          position === index ? event.target.value : value
                        )
                      );
                      setValidationError('');
                    }
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              {editing
                ? t('common.save', 'Save')
                : protocol === 'sprint_6s'
                  ? t('cardioTests.sprint_6s.record', 'Record Sprint')
                  : t('cardioTests.power_30s.record', 'Record 30-second Power')}
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
        <p>
          {protocol === 'sprint_6s'
            ? t('cardioTests.sprint_6s.empty', 'No Test Attempts recorded yet.')
            : t(
                'cardioTests.power_30s.empty',
                'No Test Attempts recorded yet.'
              )}
        </p>
      ) : (
        <>
          <div
            className="h-80 sm:h-64"
            role="img"
            aria-label={
              protocol === 'sprint_6s'
                ? t(
                    'cardioTests.sprint_6s.chart',
                    '5 × 6-second sprint (54-second rests) trend by date'
                  )
                : t(
                    'cardioTests.power_30s.chart',
                    '2 × 30-second power (60-second rest) trend by date'
                  )
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="attempt_date" />
                <YAxis />
                <Tooltip />
                <Legend />
                {labels.map((label, index) => (
                  <Line
                    key={label}
                    dataKey={`effort${index}`}
                    name={label}
                    stroke={`hsl(${(index * 67 + 210) % 360} 65% 45%)`}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                ))}
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
                    {attempt.test_type === 'sprint_6s'
                      ? `${attempt.results.peak_watts.join(', ')} W`
                      : attempt.test_type === 'power_30s'
                        ? attempt.results.efforts
                            .map(
                              (effort) =>
                                `${effort.peak_watts}/${effort.average_watts} W`
                            )
                            .join(' · ')
                        : ''}
                  </p>
                  {attempt.test_type === 'sprint_6s' && (
                    <p>
                      {t('cardioTests.sprintResult', 'Maximum')}:{' '}
                      {
                        sprintPowerResults(attempt.results.peak_watts)
                          .maximum_watts
                      }{' '}
                      W · {t('cardioTests.dropOff', 'Drop-off')}:{' '}
                      {
                        sprintPowerResults(attempt.results.peak_watts)
                          .drop_off_watts
                      }{' '}
                      W (
                      {sprintPowerResults(
                        attempt.results.peak_watts
                      ).drop_off_percent.toLocaleString(undefined, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}
                      %)
                    </p>
                  )}
                </div>
                {canWrite && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={save.isPending}
                    onClick={() => select(attempt)}
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
