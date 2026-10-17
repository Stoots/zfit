import type { TFunction } from 'i18next';
import {
  buildIntervalPlan,
  INTERVAL_PRESETS,
  type IntervalPlan,
  type ProgramStatus,
} from '@workspace/shared';
import { intervalStepName } from './recordingCues';

/**
 * A plan the watch can follow on a wrist-only run, with the step names already
 * in the phone's language (the watch has no translations of its own).
 */
export interface WatchRunPlanPayload {
  /** Stable id: the program id, or the preset id. */
  id: string;
  name: string;
  /** Set for the program's workout due now; the phone ticks it off when the run is saved. */
  programId?: string;
  programIndex?: number;
  /** 'walk' for a walking program; missing is a run. */
  activity?: 'walk';
  steps: {
    label: string;
    seconds: number;
    /** Pace range to hold in this step, seconds per km. */
    paceMin?: number;
    paceMax?: number;
    /** Heart-rate range to hold in this step, bpm. */
    hrMin?: number;
    hrMax?: number;
  }[];
}

const toSteps = (t: TFunction, plan: IntervalPlan) =>
  plan.steps.map((step) => ({
    label: intervalStepName(t, step.kind, plan.style),
    seconds: step.seconds,
    ...(step.pace
      ? {
          paceMin: step.pace.minSecondsPerKm,
          paceMax: step.pace.maxSecondsPerKm,
        }
      : {}),
    ...(step.heartRate
      ? { hrMin: step.heartRate.minBpm, hrMax: step.heartRate.maxBpm }
      : {}),
  }));

/**
 * The plans offered on the watch: the program workout due now (when a program
 * is on), then the built-in interval plans. `programName` and `presetName`
 * are injected so this stays free of the components that own the wording.
 */
export function buildWatchRunPlans(
  t: TFunction,
  program: { status: ProgramStatus | null; enabled: boolean },
  names: {
    program: (status: ProgramStatus) => string;
    preset: (id: string) => string;
  }
): WatchRunPlanPayload[] {
  const plans: WatchRunPlanPayload[] = [];
  const { status } = program;
  if (program.enabled && status?.workout && !status.finished) {
    plans.push({
      id: status.program.id,
      name: names.program(status),
      programId: status.program.id,
      programIndex: status.done,
      ...(status.program.activity === 'walk'
        ? { activity: 'walk' as const }
        : {}),
      steps: toSteps(t, status.workout.plan),
    });
  }
  for (const preset of INTERVAL_PRESETS) {
    plans.push({
      id: preset.id,
      name: names.preset(preset.id),
      steps: toSteps(t, buildIntervalPlan(preset.options)),
    });
  }
  return plans;
}

/**
 * The plan chosen on the phone's Record screen, in the shape the watch takes
 * when the phone starts a run there. `program` marks it as the due program
 * workout so the finished run ticks it off.
 */
export function buildWatchStartPlan(
  t: TFunction,
  plan: IntervalPlan,
  meta: {
    id: string;
    name: string;
    program?: { id: string; index: number; activity: 'run' | 'walk' | 'ride' };
  }
): WatchRunPlanPayload {
  return {
    id: meta.id,
    name: meta.name,
    ...(meta.program
      ? {
          programId: meta.program.id,
          programIndex: meta.program.index,
          ...(meta.program.activity === 'walk'
            ? { activity: 'walk' as const }
            : {}),
        }
      : {}),
    steps: toSteps(t, plan),
  };
}
