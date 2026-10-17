import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import BottomSheetPicker, { type PickerOption } from '../BottomSheetPicker';
import SegmentedControl from '../SegmentedControl';
import { formatClock } from '../../utils/gpsRecording';
import {
  INTERVAL_PRESETS,
  MAX_INTERVAL_ROUNDS,
  type IntervalOptions,
  type IntervalStyle,
} from '@workspace/shared';

export type IntervalChoice = 'off' | 'custom' | string;

export const DEFAULT_CUSTOM_INTERVALS: IntervalOptions = {
  style: 'runWalk',
  warmupSeconds: 300,
  workSeconds: 60,
  recoverySeconds: 60,
  rounds: 8,
  cooldownSeconds: 300,
};

// Translated names, one static key each (the i18n audit reads keys as text).
export function presetName(t: TFunction, id: string): string {
  switch (id) {
    case 'beginnerRunWalk':
      return t('recordActivity.intervals.preset.beginnerRunWalk', {
        defaultValue: 'Beginner run/walk',
      });
    case 'runWalk2':
      return t('recordActivity.intervals.preset.runWalk2', {
        defaultValue: 'Run/walk, 2 minutes',
      });
    case 'runWalk5':
      return t('recordActivity.intervals.preset.runWalk5', {
        defaultValue: 'Run/walk, 5 minutes',
      });
    case 'short400':
      return t('recordActivity.intervals.preset.short', {
        defaultValue: 'Short repeats',
      });
    case 'threeMinutes':
      return t('recordActivity.intervals.preset.threeMinutes', {
        defaultValue: '3-minute repeats',
      });
    case 'fourByFour':
      return t('recordActivity.intervals.preset.fourByFour', {
        defaultValue: '4 × 4 minutes',
      });
    default:
      return id;
  }
}

/** "8 × 1:00 / 1:30": rounds, work, recovery. Numbers only, so no wording. */
export function intervalSummary(options: IntervalOptions): string {
  const work = formatClock(options.workSeconds);
  const recovery = formatClock(options.recoverySeconds);
  return options.recoverySeconds > 0
    ? `${options.rounds} × ${work} / ${recovery}`
    : `${options.rounds} × ${work}`;
}

const Row: React.FC<{
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
}> = ({ label, value, onMinus, onPlus }) => {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center justify-between py-2">
      <Text className="text-text-primary text-sm flex-1">{label}</Text>
      <TouchableOpacity
        onPress={onMinus}
        accessibilityRole="button"
        accessibilityLabel={t('recordActivity.intervals.decrease', {
          label,
          defaultValue: 'Decrease {{label}}',
        })}
        className="w-10 h-10 rounded-lg bg-raised items-center justify-center"
      >
        <Text className="text-text-primary text-lg">−</Text>
      </TouchableOpacity>
      <Text className="text-text-primary text-base font-semibold w-16 text-center">
        {value}
      </Text>
      <TouchableOpacity
        onPress={onPlus}
        accessibilityRole="button"
        accessibilityLabel={t('recordActivity.intervals.increase', {
          label,
          defaultValue: 'Increase {{label}}',
        })}
        className="w-10 h-10 rounded-lg bg-raised items-center justify-center"
      >
        <Text className="text-text-primary text-lg">+</Text>
      </TouchableOpacity>
    </View>
  );
};

interface Props {
  choice: IntervalChoice;
  onChoice: (choice: IntervalChoice) => void;
  custom: IntervalOptions;
  onCustom: (options: IntervalOptions) => void;
  /** When set, today's program workout is offered as a choice. */
  programLabel?: string;
  /**
   * What is being recorded. A walk or ride has no running in it, so the
   * run/walk presets and style are left out and its steps are Fast and Easy.
   */
  activity?: 'run' | 'walk' | 'ride';
}

/** Pick a timed plan for a recording, or build one. */
const IntervalSetup: React.FC<Props> = ({
  choice,
  onChoice,
  custom,
  onCustom,
  programLabel,
  activity = 'run',
}) => {
  const { t } = useTranslation();
  const running = activity === 'run';
  const presets = running
    ? INTERVAL_PRESETS
    : INTERVAL_PRESETS.filter((preset) => preset.options.style !== 'runWalk');
  const customStyle: IntervalStyle = running ? custom.style : 'fastEasy';
  const options: PickerOption<IntervalChoice>[] = [
    {
      label: t('recordActivity.intervals.off', { defaultValue: 'Off' }),
      value: 'off',
    },
    ...(programLabel
      ? [{ label: programLabel, value: 'program' as IntervalChoice }]
      : []),
    ...presets.map((preset) => ({
      label: `${presetName(t, preset.id)} · ${intervalSummary(preset.options)}`,
      value: preset.id,
    })),
    {
      label: t('recordActivity.intervals.custom', { defaultValue: 'Custom' }),
      value: 'custom',
    },
  ];
  const change = (patch: Partial<IntervalOptions>) =>
    onCustom({ ...custom, ...patch });
  const clampRounds = (rounds: number) =>
    Math.min(MAX_INTERVAL_ROUNDS, Math.max(1, rounds));

  return (
    <View className="bg-surface rounded-xl p-4 mt-4">
      <Text className="text-text-primary text-sm font-semibold">
        {t('recordActivity.intervals.title', { defaultValue: 'Intervals' })}
      </Text>
      <Text className="text-text-secondary text-xs mt-1 mb-2">
        {running
          ? t('recordActivity.intervals.description', {
              defaultValue:
                'Follow timed steps, like run/walk or speed repeats. You are told when to switch.',
            })
          : t('recordActivity.intervals.descriptionNoRun', {
              defaultValue:
                'Follow timed steps of fast and easy effort. You are told when to switch.',
            })}
      </Text>
      <BottomSheetPicker<IntervalChoice>
        value={choice}
        options={options}
        onSelect={onChoice}
        title={t('recordActivity.intervals.title', {
          defaultValue: 'Intervals',
        })}
      />
      {choice === 'custom' ? (
        <View className="mt-3">
          {running ? (
            <SegmentedControl<IntervalStyle>
              segments={[
                {
                  key: 'runWalk',
                  label: t('recordActivity.intervals.styleRunWalk', {
                    defaultValue: 'Run / walk',
                  }),
                },
                {
                  key: 'fastEasy',
                  label: t('recordActivity.intervals.styleFastEasy', {
                    defaultValue: 'Fast / easy',
                  }),
                },
              ]}
              activeKey={custom.style}
              onSelect={(style) => change({ style })}
            />
          ) : null}
          <Row
            label={t('recordActivity.intervals.warmup', {
              defaultValue: 'Warm up',
            })}
            value={formatClock(custom.warmupSeconds)}
            onMinus={() =>
              change({ warmupSeconds: Math.max(0, custom.warmupSeconds - 60) })
            }
            onPlus={() =>
              change({
                warmupSeconds: Math.min(3600, custom.warmupSeconds + 60),
              })
            }
          />
          <Row
            label={
              customStyle === 'runWalk'
                ? t('recordActivity.intervals.run', { defaultValue: 'Run' })
                : t('recordActivity.intervals.fast', { defaultValue: 'Fast' })
            }
            value={formatClock(custom.workSeconds)}
            onMinus={() =>
              change({ workSeconds: Math.max(10, custom.workSeconds - 15) })
            }
            onPlus={() =>
              change({ workSeconds: Math.min(3600, custom.workSeconds + 15) })
            }
          />
          <Row
            label={
              customStyle === 'runWalk'
                ? t('recordActivity.intervals.walk', { defaultValue: 'Walk' })
                : t('recordActivity.intervals.easy', { defaultValue: 'Easy' })
            }
            value={formatClock(custom.recoverySeconds)}
            onMinus={() =>
              change({
                recoverySeconds: Math.max(0, custom.recoverySeconds - 15),
              })
            }
            onPlus={() =>
              change({
                recoverySeconds: Math.min(3600, custom.recoverySeconds + 15),
              })
            }
          />
          <Row
            label={t('recordActivity.intervals.rounds', {
              defaultValue: 'Rounds',
            })}
            value={String(custom.rounds)}
            onMinus={() => change({ rounds: clampRounds(custom.rounds - 1) })}
            onPlus={() => change({ rounds: clampRounds(custom.rounds + 1) })}
          />
          <Row
            label={t('recordActivity.intervals.cooldown', {
              defaultValue: 'Cool down',
            })}
            value={formatClock(custom.cooldownSeconds)}
            onMinus={() =>
              change({
                cooldownSeconds: Math.max(0, custom.cooldownSeconds - 60),
              })
            }
            onPlus={() =>
              change({
                cooldownSeconds: Math.min(3600, custom.cooldownSeconds + 60),
              })
            }
          />
        </View>
      ) : null}
    </View>
  );
};

export default IntervalSetup;
