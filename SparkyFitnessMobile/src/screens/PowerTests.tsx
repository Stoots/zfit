import { useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CartesianChart } from 'victory-native';
import { useCSSVariable } from 'uniwind';
import {
  cardioTestAttemptInputSchema,
  sprintPowerResults,
  powerTestInput,
  powerTestValues,
  type CardioTestAttempt,
  type CardioTestAttemptInput,
} from '@workspace/shared';
import Button from '../components/ui/Button';
import CalendarSheet, {
  type CalendarSheetRef,
} from '../components/CalendarSheet';
import DateSelectRow from '../components/DateSelectRow';
import FormInput from '../components/FormInput';
import LineSeriesMark from '../components/charts/LineSeriesMark';
import {
  CHART_LABEL_FONT_SIZE,
  formatChartYLabel,
  formatXLabel30d90d,
  makeChartFont,
} from '../components/charts/chartFormatting';
import {
  fetchProtocolAttempts,
  saveProtocolAttempt,
} from '../services/api/cardioTestsApi';
import { getTodayDate } from '../utils/dateUtils';
import { formatLocalizedNumber } from '../localization';
import { useProfile } from '../hooks/useProfile';
import { useServerConfigs } from '../hooks/useServerConfigs';

type Protocol = 'sprint_6s' | 'power_30s';
const font = makeChartFont(CHART_LABEL_FONT_SIZE);

export default function PowerTests() {
  const { profile } = useProfile();
  const { activeConfig } = useServerConfigs();
  const identityKey = `${activeConfig?.id ?? 'none'}:${profile?.id ?? 'none'}`;
  return (
    <View className="gap-8">
      <PowerProtocol key={`${identityKey}:sprint_6s`} protocol="sprint_6s" />
      <PowerProtocol key={`${identityKey}:power_30s`} protocol="power_30s" />
    </View>
  );
}

function PowerProtocol({ protocol }: { protocol: Protocol }) {
  const { t, i18n } = useTranslation();
  const [accent, muted] = useCSSVariable([
    '--color-accent-primary',
    '--color-text-muted',
  ]) as [string, string];
  const queryClient = useQueryClient();
  const key = ['cardioTestAttempts', protocol];
  const attempts = useQuery({
    queryKey: key,
    queryFn: () => fetchProtocolAttempts(protocol),
  });
  const save = useMutation({
    mutationFn: ({
      input,
      id,
    }: {
      input: CardioTestAttemptInput;
      id?: string;
    }) => saveProtocolAttempt(input, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const calendar = useRef<CalendarSheetRef>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );
  const [date, setDate] = useState(getTodayDate);
  const [values, setValues] = useState<string[]>(
    Array.from({ length: protocol === 'sprint_6s' ? 5 : 4 }, () => '')
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [validationError, setValidationError] = useState('');
  const title =
    protocol === 'sprint_6s'
      ? t('cardioTests.sprint_6s.title', {
          defaultValue: '5 × 6-second sprint (54-second rests)',
        })
      : t('cardioTests.power_30s.title', {
          defaultValue: '2 × 30-second power (60-second rest)',
        });
  const labels =
    protocol === 'sprint_6s'
      ? [
          t('cardioTests.sprint_6s.field0', {
            defaultValue: 'Effort 1 peak (W)',
          }),
          t('cardioTests.sprint_6s.field1', {
            defaultValue: 'Effort 2 peak (W)',
          }),
          t('cardioTests.sprint_6s.field2', {
            defaultValue: 'Effort 3 peak (W)',
          }),
          t('cardioTests.sprint_6s.field3', {
            defaultValue: 'Effort 4 peak (W)',
          }),
          t('cardioTests.sprint_6s.field4', {
            defaultValue: 'Effort 5 peak (W)',
          }),
        ]
      : [
          t('cardioTests.power_30s.field0', {
            defaultValue: 'Effort 1 peak (W)',
          }),
          t('cardioTests.power_30s.field1', {
            defaultValue: 'Effort 1 average (W)',
          }),
          t('cardioTests.power_30s.field2', {
            defaultValue: 'Effort 2 peak (W)',
          }),
          t('cardioTests.power_30s.field3', {
            defaultValue: 'Effort 2 average (W)',
          }),
        ];
  const recordLabel =
    protocol === 'sprint_6s'
      ? t('cardioTests.sprint_6s.record', { defaultValue: 'Record Sprint' })
      : t('cardioTests.power_30s.record', {
          defaultValue: 'Record 30-second Power',
        });
  const clear = () => {
    setDate(getTodayDate());
    setValues(labels.map(() => ''));
    setEditing(null);
    setValidationError('');
    save.reset();
  };
  const submit = async () => {
    if (
      saving.current ||
      save.isPending ||
      values.some((value) => value.trim() === '')
    )
      return;
    const parsed = cardioTestAttemptInputSchema.safeParse(
      powerTestInput(
        protocol,
        date,
        values.map((value) => Number(value.trim().replace(',', '.')))
      )
    );
    if (!parsed.success) {
      setValidationError(
        t('cardioTests.invalidPower', {
          defaultValue:
            'Enter nonnegative watts, with each average no greater than its peak.',
        })
      );
      return;
    }
    saving.current = true;
    try {
      await save.mutateAsync({ input: parsed.data, id: editing ?? undefined });
      if (mounted.current) clear();
    } catch {
      /* Error is shown below. */
    } finally {
      saving.current = false;
    }
  };
  const select = (attempt: CardioTestAttempt) => {
    if (saving.current || save.isPending) return;
    setValidationError('');
    setEditing(attempt.id);
    setDate(attempt.attempt_date);
    setValues(powerTestValues(attempt).map(String));
  };
  const rows = (attempts.data ?? []).filter(
    (attempt) => attempt.test_type === protocol
  );
  const chartKeys: ('value0' | 'value1' | 'value2' | 'value3' | 'value4')[] =
    protocol === 'sprint_6s'
      ? ['value0', 'value1', 'value2', 'value3', 'value4']
      : ['value0', 'value1', 'value2', 'value3'];
  const chartData = rows.map((attempt) => {
    const watts = powerTestValues(attempt);
    return {
      date: attempt.attempt_date,
      value0: watts[0] ?? 0,
      value1: watts[1] ?? 0,
      value2: watts[2] ?? 0,
      value3: watts[3] ?? 0,
      value4: watts[4] ?? 0,
    };
  });

  const displayDate = (day: string) =>
    new Date(`${day}T12:00:00`).toLocaleDateString(
      i18n.resolvedLanguage ?? i18n.language
    );

  return (
    <View className="gap-4">
      <Text className="text-text-primary text-xl font-bold">{title}</Text>
      <View className="rounded-2xl border border-border-subtle p-4 gap-3">
        <DateSelectRow
          date={date}
          onPress={() => {
            if (!saving.current && !save.isPending) calendar.current?.present();
          }}
        />
        {labels.map((label, index) => (
          <View key={label} className="gap-1">
            <Text className="text-text-secondary">{label}</Text>
            <FormInput
              accessibilityLabel={label}
              keyboardType="decimal-pad"
              value={values[index]}
              editable={!save.isPending}
              onChangeText={(value) => {
                if (!saving.current && !save.isPending) {
                  setValues((current) =>
                    current.map((item, position) =>
                      position === index ? value : item
                    )
                  );
                  setValidationError('');
                }
              }}
            />
          </View>
        ))}
        <View className="flex-row gap-2">
          <Button
            accessibilityRole="button"
            accessibilityLabel={
              editing ? t('common.save', { defaultValue: 'Save' }) : recordLabel
            }
            disabled={
              save.isPending || values.some((value) => value.trim() === '')
            }
            loading={save.isPending}
            onPress={() => void submit()}
            className="flex-1"
          >
            {editing ? t('common.save', { defaultValue: 'Save' }) : recordLabel}
          </Button>
          {editing && (
            <Button variant="outline" disabled={save.isPending} onPress={clear}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
          )}
        </View>
        {save.isError && (
          <Text accessibilityRole="alert" className="text-error">
            {save.error.message}
          </Text>
        )}
        {validationError ? (
          <Text accessibilityRole="alert" className="text-error text-sm">
            {validationError}
          </Text>
        ) : null}
      </View>
      {attempts.isPending ? (
        <Text>{t('common.loading', { defaultValue: 'Loading...' })}</Text>
      ) : attempts.isError ? (
        <Text accessibilityRole="alert">{attempts.error.message}</Text>
      ) : rows.length === 0 ? (
        <Text className="text-text-secondary">
          {protocol === 'sprint_6s'
            ? t('cardioTests.sprint_6s.empty', {
                defaultValue: 'No Test Attempts recorded yet.',
              })
            : t('cardioTests.power_30s.empty', {
                defaultValue: 'No Test Attempts recorded yet.',
              })}
        </Text>
      ) : (
        <>
          <View
            className="h-52"
            testID={`${protocol}-trend-chart`}
            accessibilityLabel={
              protocol === 'sprint_6s'
                ? t('cardioTests.sprint_6s.chart', {
                    defaultValue:
                      '5 × 6-second sprint (54-second rests) trend by date',
                  })
                : t('cardioTests.power_30s.chart', {
                    defaultValue:
                      '2 × 30-second power (60-second rest) trend by date',
                  })
            }
          >
            <CartesianChart
              data={chartData}
              xKey="date"
              yKeys={chartKeys}
              domainPadding={{ left: 18, right: 18, top: 12, bottom: 10 }}
              xAxis={{
                font,
                labelColor: muted,
                formatXLabel: formatXLabel30d90d,
                tickCount: Math.min(chartData.length, 5),
              }}
              yAxis={[
                { font, labelColor: muted, formatYLabel: formatChartYLabel },
              ]}
            >
              {({ points }) =>
                chartKeys.map((key, index) => (
                  <LineSeriesMark
                    key={key}
                    points={points[key]}
                    color={
                      index === 0
                        ? accent
                        : `hsl(${(index * 67 + 210) % 360} 65% 45%)`
                    }
                    strokeWidth={2}
                    curveType="linear"
                  />
                ))
              }
            </CartesianChart>
          </View>
          <View className="flex-row flex-wrap gap-3">
            {labels.map((label, index) => (
              <View key={label} className="flex-row items-center gap-1">
                <View
                  style={{
                    width: 10,
                    height: 3,
                    backgroundColor:
                      index === 0
                        ? accent
                        : `hsl(${(index * 67 + 210) % 360} 65% 45%)`,
                  }}
                />
                <Text className="text-text-secondary text-xs">{label}</Text>
              </View>
            ))}
          </View>
          <View className="rounded-xl border border-border-subtle">
            {rows.map((attempt) => (
              <TouchableOpacity
                key={attempt.id}
                accessibilityRole="button"
                accessibilityLabel={
                  protocol === 'sprint_6s'
                    ? t('cardioTests.sprint_6s.editA11y', {
                        defaultValue: 'Edit sprint attempt on {{date}}',
                        date: displayDate(attempt.attempt_date),
                      })
                    : t('cardioTests.power_30s.editA11y', {
                        defaultValue:
                          'Edit 30-second power attempt on {{date}}',
                        date: displayDate(attempt.attempt_date),
                      })
                }
                disabled={save.isPending}
                onPress={() => select(attempt)}
                className="border-b border-border-subtle px-4 py-3"
              >
                <Text className="text-text-secondary">
                  {displayDate(attempt.attempt_date)}
                </Text>
                <Text className="text-text-primary font-semibold">
                  {attempt.test_type === 'sprint_6s'
                    ? t('cardioTests.sprint_6s.values', {
                        defaultValue: '{{values}} W',
                        values: attempt.results.peak_watts
                          .map((value) => formatLocalizedNumber(value))
                          .join(', '),
                      })
                    : attempt.test_type === 'power_30s'
                      ? t('cardioTests.power_30s.values', {
                          defaultValue:
                            '{{firstPeak}}/{{firstAverage}} W · {{secondPeak}}/{{secondAverage}} W',
                          firstPeak: formatLocalizedNumber(
                            attempt.results.efforts[0].peak_watts
                          ),
                          firstAverage: formatLocalizedNumber(
                            attempt.results.efforts[0].average_watts
                          ),
                          secondPeak: formatLocalizedNumber(
                            attempt.results.efforts[1].peak_watts
                          ),
                          secondAverage: formatLocalizedNumber(
                            attempt.results.efforts[1].average_watts
                          ),
                        })
                      : ''}
                </Text>
                {attempt.test_type === 'sprint_6s' && (
                  <Text className="text-text-secondary">
                    {t('cardioTests.sprint_6s.summary', {
                      defaultValue:
                        'Maximum {{maximum}} W · Drop-off {{dropOff}} W ({{percent}}%)',
                      maximum: formatLocalizedNumber(
                        sprintPowerResults(attempt.results.peak_watts)
                          .maximum_watts
                      ),
                      dropOff: formatLocalizedNumber(
                        sprintPowerResults(attempt.results.peak_watts)
                          .drop_off_watts
                      ),
                      percent: formatLocalizedNumber(
                        sprintPowerResults(attempt.results.peak_watts)
                          .drop_off_percent,
                        { maximumFractionDigits: 1, minimumFractionDigits: 1 }
                      ),
                    })}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
      <CalendarSheet
        ref={calendar}
        selectedDate={date}
        onSelectDate={(selected) => {
          if (!saving.current && !save.isPending) setDate(selected);
        }}
      />
    </View>
  );
}
