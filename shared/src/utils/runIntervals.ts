/**
 * Timed interval plans for a GPS recording (run/walk programs, 5 x 3 min
 * repeats). Pure, so it runs under Jest; the recording service owns the state
 * between calls and reads the position from the recording's active clock, which
 * stops while paused, so a pause never eats into an interval.
 */

import { normalizePaceBand, type PaceBand } from "./paceTargets.ts";
import {
  normalizeHeartRateBand,
  type HeartRateBand,
} from "./heartRateTargets.ts";

export type IntervalStepKind = "warmup" | "work" | "recovery" | "cooldown";

/**
 * How the steps are spoken: a run/walk plan says "Run" and "Walk", a speed
 * session says "Fast" and "Easy".
 */
export type IntervalStyle = "runWalk" | "fastEasy";

export interface IntervalStep {
  kind: IntervalStepKind;
  seconds: number;
  /** Pace range to hold during this step; absent means no target. */
  pace?: PaceBand;
  /** Heart-rate range to hold during this step; absent means no target. */
  heartRate?: HeartRateBand;
}

export interface IntervalPlan {
  style: IntervalStyle;
  steps: IntervalStep[];
}

export interface IntervalOptions {
  style: IntervalStyle;
  warmupSeconds: number;
  workSeconds: number;
  recoverySeconds: number;
  rounds: number;
  cooldownSeconds: number;
}

export const MAX_INTERVAL_ROUNDS = 30;
export const MAX_STEP_SECONDS = 3600;
/** A longest step inside a stored program plan: a long run is one step. */
export const MAX_PROGRAM_STEP_SECONDS = 4 * 3600;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)));

/**
 * Builds a plan: an optional warm-up, `rounds` of work then recovery (no
 * recovery after the last round when a cool-down follows, since the cool-down
 * is the easy stretch), and an optional cool-down.
 */
export function buildIntervalPlan(options: IntervalOptions): IntervalPlan {
  const rounds = clamp(options.rounds, 1, MAX_INTERVAL_ROUNDS);
  const work = clamp(options.workSeconds, 5, MAX_STEP_SECONDS);
  const recovery = clamp(options.recoverySeconds, 0, MAX_STEP_SECONDS);
  const warmup = clamp(options.warmupSeconds, 0, MAX_STEP_SECONDS);
  const cooldown = clamp(options.cooldownSeconds, 0, MAX_STEP_SECONDS);
  const steps: IntervalStep[] = [];
  if (warmup > 0) steps.push({ kind: "warmup", seconds: warmup });
  for (let round = 1; round <= rounds; round++) {
    steps.push({ kind: "work", seconds: work });
    const last = round === rounds;
    if (recovery > 0 && !(last && cooldown > 0)) {
      steps.push({ kind: "recovery", seconds: recovery });
    }
  }
  if (cooldown > 0) steps.push({ kind: "cooldown", seconds: cooldown });
  return { style: options.style, steps };
}

export interface IntervalPreset {
  /** Stable id, also used as the translation key suffix. */
  id: string;
  options: IntervalOptions;
}

const MIN = 60;

// The first week of a typical beginner run/walk program, and a few common
// speed sessions. The plan is just a list of timed steps, so these are only
// starting points: Custom covers anything else.
export const INTERVAL_PRESETS: readonly IntervalPreset[] = [
  {
    id: "beginnerRunWalk",
    options: {
      style: "runWalk",
      warmupSeconds: 5 * MIN,
      workSeconds: 60,
      recoverySeconds: 90,
      rounds: 8,
      cooldownSeconds: 5 * MIN,
    },
  },
  {
    id: "runWalk2",
    options: {
      style: "runWalk",
      warmupSeconds: 5 * MIN,
      workSeconds: 2 * MIN,
      recoverySeconds: 2 * MIN,
      rounds: 6,
      cooldownSeconds: 5 * MIN,
    },
  },
  {
    id: "runWalk5",
    options: {
      style: "runWalk",
      warmupSeconds: 5 * MIN,
      workSeconds: 5 * MIN,
      recoverySeconds: 2 * MIN,
      rounds: 3,
      cooldownSeconds: 5 * MIN,
    },
  },
  {
    id: "short400",
    options: {
      style: "fastEasy",
      warmupSeconds: 10 * MIN,
      workSeconds: 90,
      recoverySeconds: 90,
      rounds: 8,
      cooldownSeconds: 10 * MIN,
    },
  },
  {
    id: "threeMinutes",
    options: {
      style: "fastEasy",
      warmupSeconds: 10 * MIN,
      workSeconds: 3 * MIN,
      recoverySeconds: 2 * MIN,
      rounds: 5,
      cooldownSeconds: 10 * MIN,
    },
  },
  {
    id: "fourByFour",
    options: {
      style: "fastEasy",
      warmupSeconds: 10 * MIN,
      workSeconds: 4 * MIN,
      recoverySeconds: 3 * MIN,
      rounds: 4,
      cooldownSeconds: 10 * MIN,
    },
  },
];

export const planTotalSeconds = (plan: IntervalPlan): number =>
  plan.steps.reduce((sum, step) => sum + step.seconds, 0);

export interface IntervalPosition {
  /** Index into `plan.steps`; the last index once the plan is done. */
  index: number;
  step: IntervalStep;
  /** Seconds into the current step. */
  elapsedInStep: number;
  /** Seconds left in the current step (0 once done). */
  remaining: number;
  /** The step after this one, or null on the last. */
  next: IntervalStep | null;
  /** Which work round this is (the nearest one for warm-up and cool-down). */
  round: number;
  rounds: number;
  /** Every step is finished; the person is free to carry on or stop. */
  done: boolean;
}

/** Where the plan stands after `activeSeconds` of recorded (unpaused) time. */
export function intervalPosition(
  plan: IntervalPlan,
  activeSeconds: number
): IntervalPosition | null {
  if (plan.steps.length === 0) return null;
  const at = Math.max(0, activeSeconds);
  const rounds = plan.steps.filter((s) => s.kind === "work").length;
  let start = 0;
  let round = 0;
  for (let index = 0; index < plan.steps.length; index++) {
    const step = plan.steps[index];
    if (!step) break;
    if (step.kind === "work") round++;
    const end = start + step.seconds;
    if (at < end) {
      return {
        index,
        step,
        elapsedInStep: at - start,
        remaining: end - at,
        next: plan.steps[index + 1] ?? null,
        round: Math.max(1, round),
        rounds,
        done: false,
      };
    }
    start = end;
  }
  const lastIndex = plan.steps.length - 1;
  const lastStep = plan.steps[lastIndex];
  if (!lastStep) return null;
  return {
    index: lastIndex,
    step: lastStep,
    elapsedInStep: lastStep.seconds,
    remaining: 0,
    next: null,
    round: Math.max(1, rounds),
    rounds,
    done: true,
  };
}

/** Active seconds at which step `index` begins. */
export function stepStartSeconds(plan: IntervalPlan, index: number): number {
  let start = 0;
  for (let i = 0; i < index && i < plan.steps.length; i++) {
    start += plan.steps[i]?.seconds ?? 0;
  }
  return start;
}

/** Checks a plan read back from storage or built by hand. */
export function isValidIntervalPlan(value: unknown): value is IntervalPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as IntervalPlan;
  return (
    (plan.style === "runWalk" || plan.style === "fastEasy") &&
    Array.isArray(plan.steps) &&
    plan.steps.length > 0 &&
    plan.steps.length <= 200 &&
    plan.steps.every(
      (step) =>
        ["warmup", "work", "recovery", "cooldown"].includes(step.kind) &&
        Number.isFinite(step.seconds) &&
        step.seconds > 0 &&
        step.seconds <= MAX_PROGRAM_STEP_SECONDS &&
        (step.pace === undefined || normalizePaceBand(step.pace) !== null) &&
        (step.heartRate === undefined ||
          normalizeHeartRateBand(step.heartRate) !== null)
    )
  );
}

/** Whether the last step has begun, i.e. the person got through the plan. */
export const lastStepStarted = (
  intervals: { plan: IntervalPlan; cued: number } | undefined
): boolean => !!intervals && intervals.cued >= intervals.plan.steps.length - 1;

/**
 * The plan with a pace range on its fast and easy stretches: `work` goes on
 * every work step and `easy` on every recovery step. Warm-up and cool-down
 * stay free. A band that is not usable is ignored.
 */
export function applyPaceTargets(
  plan: IntervalPlan,
  targets: { work?: PaceBand | null; easy?: PaceBand | null }
): IntervalPlan {
  const work = normalizePaceBand(targets.work);
  const easy = normalizePaceBand(targets.easy);
  if (!work && !easy) return plan;
  return {
    ...plan,
    steps: plan.steps.map((step) => {
      const pace =
        step.kind === "work" ? work : step.kind === "recovery" ? easy : null;
      return pace ? { ...step, pace } : step;
    }),
  };
}

/**
 * The same for heart rate: `work` goes on every work step and `easy` on every
 * recovery step.
 */
export function applyHeartRateTargets(
  plan: IntervalPlan,
  targets: { work?: HeartRateBand | null; easy?: HeartRateBand | null }
): IntervalPlan {
  const work = normalizeHeartRateBand(targets.work);
  const easy = normalizeHeartRateBand(targets.easy);
  if (!work && !easy) return plan;
  return {
    ...plan,
    steps: plan.steps.map((step) => {
      const heartRate =
        step.kind === "work" ? work : step.kind === "recovery" ? easy : null;
      return heartRate ? { ...step, heartRate } : step;
    }),
  };
}
