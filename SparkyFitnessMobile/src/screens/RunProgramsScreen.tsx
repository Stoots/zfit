import React, { useCallback, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { findProgram, programOutline, RUN_PROGRAMS } from '@workspace/shared';
import RunProgramCard, {
  programDescription,
  programName,
} from '../components/recording/RunProgramCard';
import RunProgramCalendar from '../components/recording/RunProgramCalendar';
import RunProgramGuide, {
  programStructure,
} from '../components/recording/RunProgramGuide';
import Button from '../components/ui/Button';
import CalendarSheet, {
  type CalendarSheetRef,
} from '../components/CalendarSheet';
import { useScreenHeader } from '../hooks/useScreenHeader';
import {
  restartProgram,
  setProgramEnabled,
  setProgramSchedule,
  setProgramPosition,
  skipProgramWorkout,
  startProgram,
  useRunProgram,
} from '../services/runProgramService';
import { addLog } from '../services/LogService';
import type { RootStackScreenProps } from '../types/navigation';
import { addDays, toLocalDateString } from '../utils/dateUtils';

type Props = RootStackScreenProps<'RunPrograms'>;

/**
 * Training programs: browse the programs, start one, and follow it. Today's
 * workout is done from Record Activity (or the Diary's card on run days).
 */
const RunProgramsScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { status, enabled, lastAdjustment, schedule, doneDay, loaded } =
    useRunProgram();
  const [now] = useState(() => Date.now());
  const today = toLocalDateString(new Date(now));
  const [chosenId, setChosenId] = useState('beginner5k');
  const storedId = status?.program.id;
  const startCalendarRef = useRef<CalendarSheetRef>(null);
  const [startingId, setStartingId] = useState<string | null>(null);

  const header = useScreenHeader({
    title: t('screens.runPrograms', { defaultValue: 'Training programs' }),
    left: { kind: 'back' },
  });

  // A program change goes to the server, so it can fail (offline).
  const change = useCallback(
    (action: () => Promise<void>) => {
      void action().catch((error: unknown) => {
        addLog(
          `[Run Program] Could not update the program: ${error}`,
          'WARNING'
        );
        Toast.show({
          type: 'error',
          text1: t('recordActivity.program.errors.update', {
            defaultValue: 'Could not update your program',
          }),
          text2: t('common.tryAgain', { defaultValue: 'Please try again.' }),
        });
      });
    },
    [t]
  );

  // Starting asks when the first workout is: today, or a date from the calendar.
  const askStart = (id: string) => {
    Alert.alert(
      t('runPrograms.startWhenTitle', {
        name: programName(t, id),
        defaultValue: 'Start {{name}}',
      }),
      t('runPrograms.startWhenMessage', {
        defaultValue: 'When is your first workout?',
      }),
      [
        {
          text: t('common.cancel', { defaultValue: 'Cancel' }),
          style: 'cancel',
        },
        {
          text: t('runPrograms.startPickDate', {
            defaultValue: 'Pick a date',
          }),
          onPress: () => {
            setStartingId(id);
            startCalendarRef.current?.present();
          },
        },
        {
          text: t('runPrograms.startToday', { defaultValue: 'Start today' }),
          onPress: () => change(() => startProgram(id, null)),
        },
      ]
    );
  };

  const chooseProgram = (id: string) => {
    if (id === storedId) {
      setChosenId(id);
      return;
    }
    // Switching a stored program, running or paused, starts the new one from
    // week 1 (and switches it on), so it is always confirmed.
    Alert.alert(
      t('recordActivity.program.switchTitle', {
        name: programName(t, id),
        defaultValue: 'Switch to {{name}}?',
      }),
      t('recordActivity.program.switchMessage', {
        defaultValue:
          'You will start the new program at week 1. Your place in the current one is not kept.',
      }),
      [
        {
          text: t('common.cancel', { defaultValue: 'Cancel' }),
          style: 'cancel',
        },
        {
          text: t('recordActivity.program.switchConfirm', {
            defaultValue: 'Switch',
          }),
          onPress: () =>
            change(async () => {
              await startProgram(id);
              setChosenId(id);
            }),
        },
      ]
    );
  };

  let body: React.ReactNode = null;
  if (loaded && status) {
    body = (
      <>
        <RunProgramCard
          programId={storedId ?? chosenId}
          onChooseProgram={chooseProgram}
          lastAdjustment={lastAdjustment}
          now={now}
          schedule={schedule}
          onSchedule={(next) => change(() => setProgramSchedule(next))}
          onPickWorkout={(index) => change(() => setProgramPosition(index))}
          status={status}
          loaded={loaded}
          selected={false}
          enabled={enabled}
          onToggle={(on) =>
            change(() => setProgramEnabled(on, storedId ?? chosenId))
          }
          onSelect={() =>
            navigation.navigate('RecordActivity', { programWorkout: true })
          }
          startLabel={t('runPrograms.startWorkout', {
            defaultValue: "Start today's workout",
          })}
          onRestart={() => change(restartProgram)}
          onSkip={() => change(skipProgramWorkout)}
        />
        <RunProgramCalendar
          status={status}
          schedule={schedule}
          doneDay={doneDay}
          today={today}
        />
        <RunProgramGuide programId={storedId} />
      </>
    );
  } else if (loaded) {
    body = (
      <>
        <Text className="text-text-secondary text-sm">
          {t('runPrograms.intro', {
            defaultValue:
              'Follow a plan that builds up week by week. Pick a program to see what it involves, then start it when you are ready.',
          })}
        </Text>
        <RunProgramGuide defaultOpen />
        {RUN_PROGRAMS.map((program) => {
          const outline = programOutline(findProgram(program.id)!);
          return (
            <View
              key={program.id}
              className="bg-surface rounded-xl p-4 mt-4"
              testID={`run-program-${program.id}`}
            >
              <Text className="text-text-primary text-base font-semibold">
                {programName(t, program.id)}
              </Text>
              <Text className="text-text-muted text-xs mt-0.5">
                {t('runPrograms.weeksRuns', {
                  weeks: program.weeks,
                  runs: program.workoutsPerWeek,
                  defaultValue: '{{weeks}} weeks, {{runs}} workouts a week',
                })}
              </Text>
              <Text className="text-text-secondary text-sm mt-2">
                {programDescription(t, program.id)}
              </Text>
              <Text className="text-text-secondary text-sm mt-2">
                {programStructure(t, program.id)}
              </Text>
              <Text className="text-text-secondary text-xs mt-2">
                {program.activity === 'walk'
                  ? t('recordActivity.program.outlineWalk', {
                      weekOne: outline.firstWeek.join(', '),
                      peak: outline.peakRunMinutes,
                      defaultValue:
                        'Week 1: workouts of {{weekOne}} minutes. Builds to {{peak}} minutes of brisk walking.',
                    })
                  : t('recordActivity.program.outline', {
                      weekOne: outline.firstWeek.join(', '),
                      peak: outline.peakRunMinutes,
                      defaultValue:
                        'Week 1: workouts of {{weekOne}} minutes. Builds to {{peak}} minutes of running.',
                    })}
              </Text>
              <View className="mt-3">
                <Button variant="outline" onPress={() => askStart(program.id)}>
                  {t('runPrograms.start', { defaultValue: 'Start program' })}
                </Button>
              </View>
            </View>
          );
        })}
      </>
    );
  }

  return (
    <>
      {header}
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
        {body}
      </ScrollView>
      <CalendarSheet
        ref={startCalendarRef}
        selectedDate={addDays(today, 1)}
        onSelectDate={(day) => {
          const id = startingId;
          if (id) change(() => startProgram(id, day <= today ? null : day));
        }}
      />
    </>
  );
};

export default RunProgramsScreen;
