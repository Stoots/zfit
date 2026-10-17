import React, { useMemo, useRef, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CartesianChart } from 'victory-native';
import { useTranslation } from 'react-i18next';
import { useCSSVariable } from 'uniwind';
import type { CooperRunAttempt } from '@workspace/shared';
import Button from '../components/ui/Button';
import CalendarSheet, {
  type CalendarSheetRef,
} from '../components/CalendarSheet';
import DateSelectRow from '../components/DateSelectRow';
import FormInput from '../components/FormInput';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { useCooperRunAttempts } from '../hooks/useCooperRunAttempts';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { formatLocalizedNumber } from '../localization';
import { getTodayDate } from '../utils/dateUtils';
import {
  CHART_LABEL_FONT_SIZE,
  formatChartYLabel,
  formatXLabel30d90d,
  useChartFont,
} from '../components/charts/chartFormatting';
import LineSeriesMark from '../components/charts/LineSeriesMark';

const CooperRunTestsScreen: React.FC = () => {
  const { t, i18n } = useTranslation();
  const chartFont = useChartFont(CHART_LABEL_FONT_SIZE);
  const insets = useSafeAreaInsets();
  const usesNativeHeader = useNativeIOSHeadersActive();
  const calendarRef = useRef<CalendarSheetRef>(null);
  const [accentColor, textMuted] = useCSSVariable([
    '--color-accent-primary',
    '--color-text-muted',
  ]) as [string, string];
  const [selectedDate, setSelectedDate] = useState(getTodayDate);
  const [distanceText, setDistanceText] = useState('');
  const [editing, setEditing] = useState<CooperRunAttempt | null>(null);
  const { attempts, create, update } = useCooperRunAttempts();
  const pending = create.isPending || update.isPending;
  const savingRef = useRef(false);
  const distanceMeters = Number(distanceText);
  const validDistance = Number.isFinite(distanceMeters) && distanceMeters > 0;
  const activeMutation = editing ? update : create;
  const header = useScreenHeader({
    title: t('cardioTests.title', { defaultValue: 'Cardio Tests' }),
    left: { kind: 'back' },
  });
  const chartData = useMemo(
    () =>
      (attempts.data ?? []).map((attempt) => ({
        date: attempt.attempt_date,
        distance: attempt.distance_meters,
      })),
    [attempts.data]
  );

  const clearForm = () => {
    setEditing(null);
    setSelectedDate(getTodayDate());
    setDistanceText('');
    create.reset();
    update.reset();
  };
  const submit = async () => {
    if (savingRef.current || pending) return;
    const distanceMeters = Number(distanceText);
    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return;
    savingRef.current = true;
    try {
      const input = {
        attempt_date: selectedDate,
        distance_meters: distanceMeters,
      };
      if (editing) await update.mutateAsync({ id: editing.id, input });
      else await create.mutateAsync(input);
      clearForm();
    } catch {
      // The visible mutation error below explains the failed save.
    } finally {
      savingRef.current = false;
    }
  };
  const editAttempt = (attempt: CooperRunAttempt) => {
    if (savingRef.current || pending) return;
    setEditing(attempt);
    setSelectedDate(attempt.attempt_date);
    setDistanceText(String(attempt.distance_meters));
    create.reset();
    update.reset();
  };

  return (
    <View
      className="flex-1 bg-background"
      style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
    >
      {!usesNativeHeader ? header : null}
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-8 gap-5"
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-2">
          <Text className="text-text-primary text-2xl font-bold">
            {t('cardioTests.cooper.title', { defaultValue: 'Cooper Run Test' })}
          </Text>
          <Text className="text-text-secondary text-sm">
            {t('cardioTests.cooper.intro', {
              defaultValue:
                'Record the distance you cover in 12 minutes and compare attempts over time.',
            })}
          </Text>
        </View>

        <View className="rounded-2xl border border-border-subtle p-4 gap-4">
          <Text className="text-text-primary text-lg font-semibold">
            {editing
              ? t('cardioTests.cooper.editFormTitle', {
                  defaultValue: 'Edit Test Attempt',
                })
              : t('cardioTests.cooper.formTitle', {
                  defaultValue: 'Record Test Attempt',
                })}
          </Text>
          <View
            pointerEvents={pending ? 'none' : 'auto'}
            style={{ opacity: pending ? 0.5 : 1 }}
            accessibilityState={{ disabled: pending }}
          >
            <DateSelectRow
              date={selectedDate}
              onPress={() => {
                if (!savingRef.current && !pending)
                  calendarRef.current?.present();
              }}
            />
          </View>
          <View className="gap-2">
            <Text className="text-text-secondary text-sm">
              {t('cardioTests.cooper.distance', {
                defaultValue: '12-minute distance (m)',
              })}
            </Text>
            <FormInput
              accessibilityLabel={t('cardioTests.cooper.distanceA11y', {
                defaultValue: 'Distance covered in 12 minutes in meters',
              })}
              keyboardType="decimal-pad"
              value={distanceText}
              editable={!pending}
              onChangeText={(value) => {
                if (!savingRef.current && !pending) setDistanceText(value);
              }}
              placeholder={t('cardioTests.cooper.distancePlaceholder', {
                defaultValue: 'e.g. 2500',
              })}
              returnKeyType="done"
            />
          </View>
          <View className="flex-row gap-2">
            <Button
              onPress={() => void submit()}
              disabled={pending || !validDistance}
              loading={pending}
              className="flex-1"
              accessibilityRole="button"
              accessibilityLabel={
                editing
                  ? t('common.save', { defaultValue: 'Save' })
                  : t('cardioTests.cooper.save', {
                      defaultValue: 'Record Test Attempt',
                    })
              }
            >
              {editing
                ? t('common.save', { defaultValue: 'Save' })
                : t('cardioTests.cooper.save', {
                    defaultValue: 'Record Test Attempt',
                  })}
            </Button>
            {editing ? (
              <Button
                variant="outline"
                accessibilityRole="button"
                disabled={pending}
                onPress={() => {
                  if (!savingRef.current) clearForm();
                }}
              >
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Button>
            ) : null}
          </View>
          {activeMutation.isError ? (
            <Text accessibilityRole="alert" className="text-error text-sm">
              {activeMutation.error.message}
            </Text>
          ) : null}
        </View>

        <View className="gap-3">
          <Text className="text-text-primary text-xl font-semibold">
            {t('cardioTests.history', { defaultValue: 'Test Attempt History' })}
          </Text>
          {attempts.isPending ? (
            <Text className="text-text-muted">
              {t('common.loading', { defaultValue: 'Loading...' })}
            </Text>
          ) : attempts.isError ? (
            <Text accessibilityRole="alert" className="text-error">
              {attempts.error.message}
            </Text>
          ) : attempts.data.length === 0 ? (
            <Text className="text-text-secondary">
              {t('cardioTests.cooper.empty', {
                defaultValue: 'No Cooper run Test Attempts recorded yet.',
              })}
            </Text>
          ) : (
            <>
              <View
                className="h-52"
                testID="cooper-run-trend-chart"
                accessibilityLabel={t('cardioTests.cooper.chartA11y', {
                  defaultValue: 'Cooper run distance trend by date',
                })}
              >
                <CartesianChart
                  data={chartData}
                  xKey="date"
                  yKeys={['distance']}
                  domainPadding={{ left: 18, right: 18, top: 12, bottom: 10 }}
                  xAxis={{
                    font: chartFont,
                    labelColor: textMuted,
                    formatXLabel: formatXLabel30d90d,
                    tickCount: Math.min(chartData.length, 5),
                  }}
                  yAxis={[
                    {
                      font: chartFont,
                      labelColor: textMuted,
                      formatYLabel: formatChartYLabel,
                    },
                  ]}
                >
                  {({ points }) => (
                    <LineSeriesMark
                      points={points.distance}
                      color={accentColor}
                      strokeWidth={2}
                      curveType="linear"
                    />
                  )}
                </CartesianChart>
              </View>
              <View className="rounded-xl border border-border-subtle">
                {attempts.data.map((attempt) => (
                  <TouchableOpacity
                    key={attempt.id}
                    accessibilityRole="button"
                    accessibilityLabel={t(
                      'cardioTests.cooper.editAttemptA11y',
                      {
                        defaultValue: 'Edit Cooper run attempt on {{date}}',
                        date: attempt.attempt_date,
                      }
                    )}
                    onPress={() => editAttempt(attempt)}
                    disabled={pending}
                    accessibilityState={{ disabled: pending }}
                    className="flex-row items-center justify-between border-b border-border-subtle px-4 py-3"
                  >
                    <Text className="text-text-secondary">
                      {new Date(
                        `${attempt.attempt_date}T12:00:00`
                      ).toLocaleDateString(
                        i18n.resolvedLanguage ?? i18n.language
                      )}
                    </Text>
                    <Text className="text-text-primary font-semibold">
                      {formatLocalizedNumber(attempt.distance_meters)} m
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>
      <CalendarSheet
        ref={calendarRef}
        selectedDate={selectedDate}
        onSelectDate={(date) => {
          if (!savingRef.current && !pending) setSelectedDate(date);
        }}
      />
    </View>
  );
};

export default CooperRunTestsScreen;
