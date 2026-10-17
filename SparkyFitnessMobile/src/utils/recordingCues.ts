import type { TFunction } from 'i18next';
import { METERS_PER_KM, METERS_PER_MILE } from './gpsRecording';
import type {
  IntervalStep,
  HeartRateAlertKind,
  IntervalStyle,
  PaceAlertKind,
} from '@workspace/shared';

/**
 * The words spoken during a GPS recording. Pure and given `t`, so it runs under
 * Jest and follows the app language. Durations are spelled out ("5 minutes 24
 * seconds") because a speech engine reads "5:24" as a time of day.
 */

export type CueUnit = 'km' | 'miles';

export type CueEvent = 'started' | 'paused' | 'autoPaused' | 'resumed';

export const cueUnitMeters = (unit: CueUnit): number =>
  unit === 'miles' ? METERS_PER_MILE : METERS_PER_KM;

/** "1 hour 5 minutes 3 seconds", leaving out the parts that are zero. */
export function spokenDuration(t: TFunction, totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(
      t('recordActivity.cues.hours', {
        count: hours,
        defaultValue: '{{count}} hours',
        defaultValue_one: '{{count}} hour',
        defaultValue_other: '{{count}} hours',
      })
    );
  }
  if (minutes > 0) {
    parts.push(
      t('recordActivity.cues.minutes', {
        count: minutes,
        defaultValue: '{{count}} minutes',
        defaultValue_one: '{{count}} minute',
        defaultValue_other: '{{count}} minutes',
      })
    );
  }
  if (rest > 0 || parts.length === 0) {
    parts.push(
      t('recordActivity.cues.seconds', {
        count: rest,
        defaultValue: '{{count}} seconds',
        defaultValue_one: '{{count}} second',
        defaultValue_other: '{{count}} seconds',
      })
    );
  }
  return parts.join(' ');
}

/** "3 kilometers" or "2.5 miles". */
export function spokenDistance(
  t: TFunction,
  count: number,
  unit: CueUnit
): string {
  return unit === 'miles'
    ? t('recordActivity.cues.miles', {
        count,
        defaultValue: '{{count}} miles',
        defaultValue_one: '{{count}} mile',
        defaultValue_other: '{{count}} miles',
      })
    : t('recordActivity.cues.kilometers', {
        count,
        defaultValue: '{{count}} kilometers',
        defaultValue_one: '{{count}} kilometer',
        defaultValue_other: '{{count}} kilometers',
      });
}

/**
 * Said when a full kilometer or mile is done: how far, the time on the clock,
 * and how long that last kilometer or mile took.
 */
export function splitCue(
  t: TFunction,
  options: {
    /** Whole units completed so far. */
    completed: number;
    /** Active seconds at the end of this split. */
    totalSeconds: number;
    /** How long this one split took, which is its pace. */
    splitSeconds: number;
    unit: CueUnit;
  }
): string {
  const time = spokenDuration(t, options.totalSeconds);
  const distance = spokenDistance(t, options.completed, options.unit);
  const split = spokenDuration(t, options.splitSeconds);
  return options.unit === 'miles'
    ? t('recordActivity.cues.splitMiles', {
        distance,
        time,
        split,
        defaultValue: '{{distance}}. Time {{time}}. Last mile {{split}}.',
      })
    : t('recordActivity.cues.splitKm', {
        distance,
        time,
        split,
        defaultValue: '{{distance}}. Time {{time}}. Last kilometer {{split}}.',
      });
}

/** Said when the Lap button is pressed: the lap number, how far and how long. */
export function lapCue(
  t: TFunction,
  options: {
    number: number;
    distanceMeters: number;
    seconds: number;
    unit: CueUnit;
  }
): string {
  return t('recordActivity.cues.lap', {
    number: options.number,
    distance: spokenDistance(
      t,
      Math.round((options.distanceMeters / cueUnitMeters(options.unit)) * 100) /
        100,
      options.unit
    ),
    time: spokenDuration(t, options.seconds),
    defaultValue: 'Lap {{number}}. {{distance}}. {{time}}.',
  });
}

export function eventCue(t: TFunction, event: CueEvent): string {
  switch (event) {
    case 'started':
      return t('recordActivity.cues.started', {
        defaultValue: 'Recording started',
      });
    case 'paused':
      return t('recordActivity.cues.paused', { defaultValue: 'Paused' });
    case 'autoPaused':
      return t('recordActivity.cues.autoPaused', {
        defaultValue: 'Auto paused',
      });
    case 'resumed':
      return t('recordActivity.cues.resumed', { defaultValue: 'Resumed' });
  }
}

/** Said on Finish: the distance, to one decimal, and the time. */
export function finishCue(
  t: TFunction,
  options: { distanceMeters: number; totalSeconds: number; unit: CueUnit }
): string {
  const distance = spokenDistance(
    t,
    Math.round((options.distanceMeters / cueUnitMeters(options.unit)) * 10) /
      10,
    options.unit
  );
  return t('recordActivity.cues.finished', {
    distance,
    time: spokenDuration(t, options.totalSeconds),
    defaultValue: 'Recording finished. {{distance}}. Time {{time}}.',
  });
}

/** The word for a step: "Run" and "Walk", or "Fast" and "Easy". */
export function intervalStepName(
  t: TFunction,
  kind: IntervalStep['kind'],
  style: IntervalStyle
): string {
  switch (kind) {
    case 'warmup':
      return t('recordActivity.intervals.warmup', { defaultValue: 'Warm up' });
    case 'cooldown':
      return t('recordActivity.intervals.cooldown', {
        defaultValue: 'Cool down',
      });
    case 'work':
      return style === 'runWalk'
        ? t('recordActivity.intervals.run', { defaultValue: 'Run' })
        : t('recordActivity.intervals.fast', { defaultValue: 'Fast' });
    case 'recovery':
      return style === 'runWalk'
        ? t('recordActivity.intervals.walk', { defaultValue: 'Walk' })
        : t('recordActivity.intervals.easy', { defaultValue: 'Easy' });
  }
}

/** Said when an interval step begins: what to do and for how long. */
export function intervalCue(
  t: TFunction,
  options: { step: IntervalStep; style: IntervalStyle }
): string {
  return t('recordActivity.cues.interval', {
    name: intervalStepName(t, options.step.kind, options.style),
    time: spokenDuration(t, options.step.seconds),
    defaultValue: '{{name}}. {{time}}.',
  });
}

/** Said when the last step is over. */
export function intervalsDoneCue(t: TFunction): string {
  return t('recordActivity.cues.intervalsDone', {
    defaultValue: 'Intervals complete.',
  });
}

/** Said when the pace has stayed outside the runner's band. */
export function paceAlertCue(t: TFunction, kind: PaceAlertKind): string {
  return kind === 'tooFast'
    ? t('recordActivity.cues.paceTooFast', {
        defaultValue: 'Too fast. Ease off.',
      })
    : t('recordActivity.cues.paceTooSlow', {
        defaultValue: 'Too slow. Pick it up.',
      });
}

/** Said when the heart rate has stayed outside the runner's range. */
export function heartRateAlertCue(
  t: TFunction,
  kind: HeartRateAlertKind
): string {
  return kind === 'tooHigh'
    ? t('recordActivity.cues.heartRateTooHigh', {
        defaultValue: 'Heart rate high. Ease off.',
      })
    : t('recordActivity.cues.heartRateTooLow', {
        defaultValue: 'Heart rate low. Pick it up.',
      });
}
