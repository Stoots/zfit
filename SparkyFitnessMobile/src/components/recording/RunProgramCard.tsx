import React, { useRef } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import Button from '../ui/Button';
import Switch from '../ui/Switch';
import BottomSheetPicker, {
  type PickerOption,
  type PickerSection,
} from '../BottomSheetPicker';
import { getAppLocale } from '../../localization';
import CalendarSheet, { type CalendarSheetRef } from '../CalendarSheet';
import type { ProgramScheduleChange } from '../../services/runProgramService';
import { toLocalDateString } from '../../utils/dateUtils';
import { formatDayLabel } from '../../utils/dayLabel';
import {
  addDays,
  findProgram,
  planMinutes,
  programOutline,
  RUN_PROGRAMS,
  type ProgramStatus,
  type RunProgramAdjustment,
} from '@workspace/shared';

export function programName(t: TFunction, id: string): string {
  switch (id) {
    case 'walkFit':
      return t('recordActivity.program.name.walkFit', {
        defaultValue: 'Walk for fitness',
      });
    case 'beginner5k':
      return t('recordActivity.program.name.beginner5k', {
        defaultValue: 'Beginner 5K',
      });
    case 'fiveToTenK':
      return t('recordActivity.program.name.fiveToTenK', {
        defaultValue: '5K to 10K',
      });
    case 'faster5k':
      return t('recordActivity.program.name.faster5k', {
        defaultValue: 'Faster 5K',
      });
    case 'halfMarathon':
      return t('recordActivity.program.name.halfMarathon', {
        defaultValue: 'Half marathon',
      });
    case 'marathon':
      return t('recordActivity.program.name.marathon', {
        defaultValue: 'Marathon',
      });
    default:
      return id;
  }
}

/** A sentence on who a program is for and what it does. */
export function programDescription(t: TFunction, id: string): string {
  switch (id) {
    case 'walkFit':
      return t('recordActivity.program.walkFitDescription', {
        defaultValue:
          'Walk for fitness: eight weeks, three walks a week, with no running. You alternate brisk and easy walking and build up to 30 minutes of brisk walking.',
      });
    case 'beginner5k':
      return t('recordActivity.program.beginner5kDescription', {
        defaultValue:
          'Beginner 5K: nine weeks, three runs a week. You alternate running and walking, and build up to 30 minutes of running.',
      });
    case 'fiveToTenK':
      return t('recordActivity.program.fiveToTenKDescription', {
        defaultValue:
          '5K to 10K: eight weeks, three runs a week, for when you can run 30 minutes. It builds to a 65 minute long run.',
      });
    case 'faster5k':
      return t('recordActivity.program.faster5kDescription', {
        defaultValue:
          'Faster 5K: six weeks of speed sessions, easy runs and tempo runs, for when you already run 5K.',
      });
    case 'halfMarathon':
      return t('recordActivity.program.halfMarathonDescription', {
        defaultValue:
          'Half marathon: twelve weeks, three runs a week, with long runs building to about two hours. For when you run 30 minutes comfortably.',
      });
    case 'marathon':
      return t('recordActivity.program.marathonDescription', {
        defaultValue:
          'Marathon: sixteen weeks, four runs a week, with long runs building to about 2¾ hours and a taper. For people who already run regularly.',
      });
    default:
      return id;
  }
}

/** "Week 3, run 2" for a program workout. */
export function programWorkoutLabel(
  t: TFunction,
  status: ProgramStatus
): string {
  const workout = status.workout;
  if (!workout) return programName(t, status.program.id);
  if (status.program.activity === 'walk') {
    return t('recordActivity.program.workoutLabelWalk', {
      name: programName(t, status.program.id),
      week: workout.week + 1,
      walk: workout.day + 1,
      defaultValue: '{{name}} · Week {{week}}, walk {{walk}}',
    });
  }
  return t('recordActivity.program.workoutLabel', {
    name: programName(t, status.program.id),
    week: workout.week + 1,
    run: workout.day + 1,
    defaultValue: '{{name}} · Week {{week}}, run {{run}}',
  });
}

const weekdayLabel = (day: number, style: 'narrow' | 'long'): string =>
  // 2024-01-07 was a Sunday, so day 0 is Sunday.
  new Date(2024, 0, 7 + day).toLocaleDateString(getAppLocale(), {
    weekday: style,
  });

/** When the Diary offers the workout: weekdays (none = every day) and first day. */
export interface RunSchedule {
  days: number[];
  startDay: string | null;
  endDay: string | null;
}

interface Props {
  /** The program picked in the list (the running one, or the one to start). */
  programId: string;
  onChooseProgram: (programId: string) => void;
  /** The latest change to the plan, shown for a couple of weeks. */
  lastAdjustment?: RunProgramAdjustment | null;
  /** Epoch ms "now", from the screen, to judge whether a change is recent. */
  now: number;
  /** The days the workout shows in the Diary, and the first day it does. */
  schedule: RunSchedule;
  onSchedule: (change: ProgramScheduleChange) => void;
  /** Jump to any workout in the program (0-based index). */
  onPickWorkout: (index: number) => void;
  status: ProgramStatus | null;
  loaded: boolean;
  /** Whether today's program workout is the plan chosen for this recording. */
  selected: boolean;
  /** Whether the person is using the program. */
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onSelect: () => void;
  /** Label for the button that uses today's workout; defaults to the Record screen's wording. */
  startLabel?: string;
  onRestart: () => void;
  onSkip: () => void;
}

/** Start, follow and leave a multi-week run program. */
const RunProgramCard: React.FC<Props> = ({
  programId,
  onChooseProgram,
  lastAdjustment = null,
  now,
  schedule,
  onSchedule,
  onPickWorkout,
  status,
  loaded,
  selected,
  enabled,
  onToggle,
  onSelect,
  startLabel,
  onRestart,
  onSkip,
}) => {
  const { t } = useTranslation();
  const calendarRef = useRef<CalendarSheetRef>(null);
  const goalCalendarRef = useRef<CalendarSheetRef>(null);
  if (!loaded) return null;

  const header = (
    <View className="flex-row items-center justify-between">
      <View className="flex-1 mr-3">
        <Text className="text-text-primary text-sm font-semibold">
          {t('recordActivity.program.title', {
            defaultValue: 'Training program',
          })}
        </Text>
        <Text className="text-text-secondary text-xs mt-1">
          {t('recordActivity.program.switchHint', {
            defaultValue:
              'Follow a plan that builds up week by week. Off by default.',
          })}
        </Text>
      </View>
      <Switch
        value={enabled}
        onValueChange={onToggle}
        accessibilityLabel={t('recordActivity.program.use', {
          defaultValue: 'Use a training program',
        })}
      />
    </View>
  );

  const programOptions: PickerOption<string>[] = RUN_PROGRAMS.map((p) => ({
    label: t('recordActivity.program.optionLabel', {
      name: programName(t, p.id),
      weeks: p.weeks,
      runs: p.workoutsPerWeek,
      defaultValue: '{{name}} · {{weeks}} weeks, {{runs}} workouts a week',
    }),
    value: p.id,
  }));

  if (!enabled || !status) {
    return (
      <View className="bg-surface rounded-xl p-4 mt-4">
        {header}
        <View className="mt-3">
          <BottomSheetPicker<string>
            value={programId}
            options={programOptions}
            onSelect={onChooseProgram}
            title={t('recordActivity.program.chooseTitle', {
              defaultValue: 'Choose a program',
            })}
          />
        </View>
        <Text className="text-text-secondary text-xs mt-3">
          {status && status.program.id === programId
            ? t('recordActivity.program.paused', {
                name: programName(t, status.program.id),
                done: status.done,
                total: status.total,
                defaultValue:
                  '{{name}} is paused at {{done}} of {{total}} workouts. Switch it on to carry on.',
              })
            : programDescription(t, programId)}
        </Text>
        {(!status || status.program.id !== programId) &&
          (() => {
            const program = findProgram(programId);
            if (!program) return null;
            const outline = programOutline(program);
            return (
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
            );
          })()}
      </View>
    );
  }

  const sections: PickerSection<number>[] = Array.from(
    { length: status.program.weeks },
    (_, week) => ({
      title: t('recordActivity.program.weekTitle', {
        week: week + 1,
        defaultValue: 'Week {{week}}',
      }),
      options: status.program.workouts
        .map((workout, index) => ({ workout, index }))
        .filter(({ workout }) => workout.week === week)
        .map(({ workout, index }) => ({
          label:
            status.program.activity === 'walk'
              ? t('recordActivity.program.pickOptionWalk', {
                  walk: workout.day + 1,
                  minutes: planMinutes(workout.plan),
                  mark: index < status.done ? '✓ ' : '',
                  defaultValue: '{{mark}}Walk {{walk}} · {{minutes}} min',
                })
              : t('recordActivity.program.pickOption', {
                  run: workout.day + 1,
                  minutes: planMinutes(workout.plan),
                  mark: index < status.done ? '✓ ' : '',
                  defaultValue: '{{mark}}Run {{run}} · {{minutes}} min',
                }),
          value: index,
        })),
    })
  );
  // A change older than this is history, not news.
  const recentChange =
    lastAdjustment &&
    now - Date.parse(lastAdjustment.at) < 14 * 24 * 3600 * 1000
      ? lastAdjustment
      : null;
  const changeDate = recentChange
    ? new Date(recentChange.at).toLocaleDateString(getAppLocale(), {
        month: 'short',
        day: 'numeric',
      })
    : '';
  const today = toLocalDateString(new Date(now));
  const hasStart = !!schedule.startDay;
  const futureStart = hasStart && (schedule.startDay as string) > today;
  const dayLabel = (day: string): string => formatDayLabel(day);
  const fraction = status.total > 0 ? status.done / status.total : 0;
  return (
    <View className="bg-surface rounded-xl p-4 mt-4">
      {header}
      <Text className="text-text-primary text-sm font-semibold mt-3">
        {status.finished
          ? t('recordActivity.program.finished', {
              name: programName(t, status.program.id),
              defaultValue: '{{name}} complete',
            })
          : programWorkoutLabel(t, status)}
      </Text>
      <Text className="text-text-secondary text-xs mt-1">
        {status.finished
          ? t('recordActivity.program.finishedHint', {
              defaultValue: 'Well done. You can start it again or move on.',
            })
          : t('recordActivity.program.progress', {
              done: status.done,
              total: status.total,
              minutes: status.workout ? planMinutes(status.workout.plan) : 0,
              defaultValue:
                'Workout {{done}} of {{total}} done · {{minutes}} min today',
            })}
      </Text>
      {recentChange ? (
        <Text className="text-text-secondary text-xs mt-2">
          {recentChange.source === 'assistant'
            ? t('recordActivity.program.changedBySparky', {
                date: changeDate,
                summary: recentChange.summary,
                defaultValue:
                  'Sparky changed your plan on {{date}}: {{summary}}',
              })
            : t('recordActivity.program.changed', {
                date: changeDate,
                summary: recentChange.summary,
                defaultValue: 'Plan changed on {{date}}: {{summary}}',
              })}
        </Text>
      ) : null}
      <View className="h-2 rounded-full bg-raised mt-3 overflow-hidden">
        <View
          className="h-2 rounded-full bg-accent-primary"
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </View>
      <View className="flex-row mt-3">
        {status.finished ? (
          <View className="flex-1 mr-2">
            <Button variant="outline" onPress={onRestart}>
              {t('recordActivity.program.restart', {
                defaultValue: 'Start again',
              })}
            </Button>
          </View>
        ) : (
          <View className="flex-1 mr-2">
            <Button
              variant={selected ? 'primary' : 'outline'}
              onPress={onSelect}
            >
              {selected
                ? t('recordActivity.program.using', {
                    defaultValue: 'Using this workout',
                  })
                : (startLabel ??
                  t('recordActivity.program.doThis', {
                    defaultValue: 'Do this workout',
                  }))}
            </Button>
          </View>
        )}
      </View>
      {status.finished ? null : (
        <View className="mt-3">
          <Text className="text-text-primary text-sm font-semibold">
            {t('recordActivity.program.diaryDays', {
              defaultValue: 'Days in your Diary',
            })}
          </Text>
          <View className="flex-row justify-between mt-2">
            {Array.from({ length: 7 }, (_, day) => {
              const on = schedule.days.includes(day);
              return (
                <TouchableOpacity
                  key={day}
                  accessibilityRole="button"
                  accessibilityLabel={weekdayLabel(day, 'long')}
                  accessibilityState={{ selected: on }}
                  onPress={() => onSchedule({ toggleDay: day })}
                  className={`w-10 h-10 rounded-full items-center justify-center ${
                    on ? 'bg-accent-primary' : 'bg-raised'
                  }`}
                >
                  <Text
                    className={`text-sm font-semibold ${
                      on ? 'text-white' : 'text-text-primary'
                    }`}
                  >
                    {weekdayLabel(day, 'narrow')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text className="text-text-muted text-xs mt-2">
            {schedule.days.length > 0
              ? t('recordActivity.program.diaryDaysSet', {
                  defaultValue:
                    'The Diary shows the workout on these days. A workout you miss stays due.',
                })
              : t('recordActivity.program.diaryDaysHint', {
                  defaultValue:
                    'Pick the days you plan to train, or leave them empty to see the workout every day.',
                })}
          </Text>
          <Text className="text-text-primary text-sm font-semibold mt-3">
            {t('recordActivity.program.startDay', {
              defaultValue: 'First workout',
            })}
          </Text>
          <Text className="text-text-secondary text-xs mt-1">
            {futureStart
              ? t('recordActivity.program.startDaySet', {
                  date: dayLabel(schedule.startDay as string),
                  defaultValue:
                    'Starts {{date}}. Nothing shows in the Diary before then.',
                })
              : hasStart
                ? t('recordActivity.program.startDayPast', {
                    date: dayLabel(schedule.startDay as string),
                    defaultValue:
                      'Started {{date}}. Your next workout is scheduled from today.',
                  })
                : t('recordActivity.program.startDayToday', {
                    date: dayLabel(today),
                    defaultValue:
                      'Starts today, {{date}}. Pick a later date if you want to begin then.',
                  })}
          </Text>
          <View className="flex-row">
            <Button
              variant="link"
              onPress={() => calendarRef.current?.present()}
            >
              {t('recordActivity.program.startChange', {
                defaultValue: 'Change start date',
              })}
            </Button>
            {hasStart ? (
              <Button
                variant="link"
                onPress={() => onSchedule({ startDay: null })}
              >
                {t('recordActivity.program.startClear', {
                  defaultValue: 'Start today',
                })}
              </Button>
            ) : null}
          </View>
          <Text className="text-text-primary text-sm font-semibold mt-1">
            {t('recordActivity.program.goalDay', {
              defaultValue: 'Goal date',
            })}
          </Text>
          <Text className="text-text-secondary text-xs mt-1">
            {schedule.endDay
              ? t('recordActivity.program.goalDaySet', {
                  date: dayLabel(schedule.endDay),
                  defaultValue:
                    'Nothing is scheduled after {{date}}. The schedule below says whether the program fits.',
                })
              : t('recordActivity.program.goalDayHint', {
                  defaultValue:
                    'Optional, for example a race day. The schedule below says whether the program fits before it.',
                })}
          </Text>
          <View className="flex-row">
            <Button
              variant="link"
              onPress={() => goalCalendarRef.current?.present()}
            >
              {schedule.endDay
                ? t('recordActivity.program.goalChange', {
                    defaultValue: 'Change goal date',
                  })
                : t('recordActivity.program.goalPick', {
                    defaultValue: 'Set a goal date',
                  })}
            </Button>
            {schedule.endDay ? (
              <Button
                variant="link"
                onPress={() => onSchedule({ endDay: null })}
              >
                {t('recordActivity.program.goalClear', {
                  defaultValue: 'Clear',
                })}
              </Button>
            ) : null}
          </View>
        </View>
      )}
      <BottomSheetPicker<string>
        value={programId}
        options={programOptions}
        onSelect={onChooseProgram}
        title={t('recordActivity.program.chooseTitle', {
          defaultValue: 'Choose a program',
        })}
        renderTrigger={({ onPress }) => (
          <Button variant="link" onPress={onPress}>
            {t('recordActivity.program.change', {
              defaultValue: 'Change program',
            })}
          </Button>
        )}
      />
      <BottomSheetPicker<number>
        value={Math.min(status.done, status.total - 1)}
        sections={sections}
        onSelect={onPickWorkout}
        title={t('recordActivity.program.pickTitle', {
          defaultValue: 'Choose a workout',
        })}
        renderTrigger={({ onPress }) => (
          <Button variant="link" onPress={onPress}>
            {t('recordActivity.program.pick', {
              defaultValue: 'Choose a different workout',
            })}
          </Button>
        )}
      />
      <View className="flex-row mt-1">
        {status.finished ? null : (
          <Button variant="link" onPress={onSkip}>
            {t('recordActivity.program.skip', { defaultValue: 'Skip' })}
          </Button>
        )}
        {status.done > 0 ? (
          <Button variant="link" onPress={onRestart}>
            {t('recordActivity.program.startOver', {
              defaultValue: 'Start over',
            })}
          </Button>
        ) : null}
      </View>
      <CalendarSheet
        ref={goalCalendarRef}
        selectedDate={schedule.endDay ?? addDays(today, 28)}
        onSelectDate={(day) =>
          onSchedule({ endDay: day <= today ? null : day })
        }
      />
      <CalendarSheet
        ref={calendarRef}
        selectedDate={schedule.startDay ?? today}
        onSelectDate={(day) => onSchedule({ startDay: day })}
      />
    </View>
  );
};

export default RunProgramCard;
