import type {
  IntervalPlan,
  IntervalStep,
  IntervalStyle,
} from "./runIntervals.ts";

/**
 * Multi-week run programs: an ordered list of workouts, each one an interval
 * plan. Pure data and maths; the person's place in a program is kept by
 * `services/runProgramService.ts`.
 */

export interface ProgramWorkout {
  /** 0-based week. */
  week: number;
  /** 0-based workout within the week. */
  day: number;
  plan: IntervalPlan;
}

export interface RunProgram {
  /** Stable id, also the translation key suffix. */
  id: string;
  /** What the person records for its workouts: a walking program is recorded as a walk. */
  activity: "run" | "walk";
  workouts: ProgramWorkout[];
  weeks: number;
  workoutsPerWeek: number;
}

type Piece = readonly ["run" | "walk", number];

/** How a workout is wrapped: warm-up, cool-down and what the steps are called. */
interface Shape {
  style: IntervalStyle;
  warmup: number;
  cooldown: number;
}

interface Spec {
  pieces: readonly Piece[];
  shape: Shape;
}

const RUN_WALK: Shape = { style: "runWalk", warmup: 300, cooldown: 300 };
const SPEED: Shape = { style: "fastEasy", warmup: 600, cooldown: 600 };
const EASY: Shape = { style: "fastEasy", warmup: 300, cooldown: 300 };
// Brisk walking and easy walking, named Fast and Easy so nothing says "run".
const WALKING: Shape = { style: "fastEasy", warmup: 300, cooldown: 300 };

/** A warm-up, the given run/walk pieces (work/recovery steps), a cool-down. */
function workout(spec: Spec): IntervalPlan {
  const steps: IntervalStep[] = [
    { kind: "warmup", seconds: spec.shape.warmup },
  ];
  for (const [kind, seconds] of spec.pieces) {
    steps.push({ kind: kind === "run" ? "work" : "recovery", seconds });
  }
  steps.push({ kind: "cooldown", seconds: spec.shape.cooldown });
  return { style: spec.shape.style, steps };
}

const repeat = (count: number, pieces: readonly Piece[]): Piece[] =>
  Array.from({ length: count }, () => pieces).flat();

const run = (seconds: number): Piece => ["run", seconds];
const walk = (seconds: number): Piece => ["walk", seconds];

/** Run/walk workout with the usual 5 minute walks either side. */
const rw = (pieces: readonly Piece[]): Spec => ({ pieces, shape: RUN_WALK });
/** A continuous run of `minutes`. */
const steady = (minutes: number): Spec => rw([run(minutes * 60)]);
/** Speed work: fast and easy pieces with a longer warm-up and cool-down. */
const speed = (pieces: readonly Piece[]): Spec => ({ pieces, shape: SPEED });
/** An easy run (an "easy" step, not a "run" one) of `minutes`. */
const easy = (minutes: number): Spec => ({
  pieces: [walk(minutes * 60)],
  shape: EASY,
});

/** A walking workout: brisk pieces (work steps) between easy walking. */
const brisk = (seconds: number): Piece => ["run", seconds];
const stroll = (seconds: number): Piece => ["walk", seconds];
const walking = (pieces: readonly Piece[]): Spec => ({
  pieces,
  shape: WALKING,
});

/** Weeks of continuous runs, one row of minutes per week. */
const steadyWeeks = (rows: readonly (readonly number[])[]): Spec[][] =>
  rows.map((minutes) => minutes.map(steady));

// Eight weeks from short brisk stretches between easy walking to half an hour
// of brisk walking, three walks a week. For someone who wants to start moving
// with no running in it.
const WALK_FIT_WEEKS: readonly (readonly Spec[])[] = [
  Array(3).fill(walking(repeat(4, [brisk(180), stroll(120)]))),
  Array(3).fill(walking(repeat(4, [brisk(240), stroll(120)]))),
  Array(3).fill(walking(repeat(3, [brisk(360), stroll(120)]))),
  Array(3).fill(walking(repeat(3, [brisk(480), stroll(120)]))),
  Array(3).fill(walking(repeat(2, [brisk(720), stroll(120)]))),
  Array(3).fill(walking(repeat(2, [brisk(900), stroll(120)]))),
  [walking([brisk(1200)]), walking([brisk(1200)]), walking([brisk(1500)])],
  [walking([brisk(1500)]), walking([brisk(1800)]), walking([brisk(1800)])],
];

// A nine-week beginner progression from alternating minutes of running and
// walking to 30 minutes of running, three workouts a week. Each week lists its
// three workouts; a week that repeats one workout lists it three times.
const BEGINNER_5K_WEEKS: readonly (readonly Spec[])[] = [
  Array(3).fill(rw(repeat(8, [run(60), walk(90)]))),
  Array(3).fill(rw(repeat(6, [run(90), walk(120)]))),
  Array(3).fill(rw(repeat(2, [run(90), walk(90), run(180), walk(180)]))),
  Array(3).fill(
    rw([run(180), walk(90), run(300), walk(150), run(180), walk(90), run(300)]),
  ),
  [
    rw([run(300), walk(180), run(300), walk(180), run(300)]),
    rw([run(480), walk(300), run(480)]),
    steady(20),
  ],
  [
    rw([run(300), walk(180), run(480), walk(180), run(300)]),
    rw([run(600), walk(180), run(600)]),
    steady(22),
  ],
  Array(3).fill(steady(25)),
  Array(3).fill(steady(28)),
  Array(3).fill(steady(30)),
];

// For someone who can run 30 minutes: eight weeks to 10K, three runs a week
// (two steady, one long), with an easier week every fourth and a taper.
const FIVE_TO_TEN_K_WEEKS = steadyWeeks([
  [30, 30, 40],
  [30, 35, 45],
  [35, 35, 50],
  [30, 30, 40],
  [35, 40, 55],
  [40, 40, 60],
  [40, 45, 65],
  [30, 30, 40],
]);

// Six weeks to get faster over 5K: a speed session, an easy run and a longer
// run or tempo each week.
const FASTER_5K_WEEKS: readonly (readonly Spec[])[] = [
  [speed(repeat(6, [run(120), walk(120)])), easy(30), easy(40)],
  [speed(repeat(5, [run(180), walk(120)])), easy(30), easy(45)],
  [speed(repeat(4, [run(240), walk(150)])), easy(35), easy(50)],
  [speed(repeat(8, [run(90), walk(90)])), easy(30), speed([run(900)])],
  [speed(repeat(3, [run(360), walk(180)])), easy(30), speed([run(1200)])],
  [speed(repeat(4, [run(180), walk(120)])), easy(25), speed([run(1500)])],
];

// Twelve weeks to a half marathon for someone who runs 30 minutes: an easy
// run, a middle run and a long run each week, with an easier week every
// fourth and a taper.
const HALF_MARATHON_WEEKS = steadyWeeks([
  [30, 30, 50],
  [30, 35, 55],
  [35, 40, 65],
  [30, 30, 50],
  [35, 40, 75],
  [40, 45, 85],
  [40, 45, 95],
  [35, 35, 70],
  [45, 50, 105],
  [45, 50, 115],
  [40, 40, 90],
  [25, 20, 30],
]);

// Sixteen weeks to a marathon for someone who already runs a few times a
// week: easy, middle, easy and long runs, long runs building to under three
// hours, an easier week every fourth, and a three-week taper.
const MARATHON_WEEKS = steadyWeeks([
  [30, 40, 30, 70],
  [30, 40, 30, 80],
  [35, 45, 35, 90],
  [30, 40, 30, 70],
  [35, 50, 35, 100],
  [40, 50, 40, 110],
  [40, 55, 40, 120],
  [30, 45, 30, 90],
  [40, 55, 40, 130],
  [45, 60, 45, 140],
  [45, 60, 45, 150],
  [35, 50, 35, 110],
  [45, 60, 45, 150],
  [45, 60, 45, 165],
  [40, 50, 40, 120],
  [30, 25, 20],
]);

function buildProgram(
  id: string,
  weeks: readonly (readonly Spec[])[],
  activity: RunProgram["activity"] = "run",
): RunProgram {
  const workouts = weeks.flatMap((days, week) =>
    days.map((spec, day) => ({ week, day, plan: workout(spec) })),
  );
  return {
    id,
    activity,
    workouts,
    weeks: weeks.length,
    workoutsPerWeek: weeks[0]?.length ?? 0,
  };
}

/** Easiest first: the order the picker lists them. */
export const RUN_PROGRAMS: readonly RunProgram[] = [
  buildProgram("walkFit", WALK_FIT_WEEKS, "walk"),
  buildProgram("beginner5k", BEGINNER_5K_WEEKS),
  buildProgram("fiveToTenK", FIVE_TO_TEN_K_WEEKS),
  buildProgram("faster5k", FASTER_5K_WEEKS),
  buildProgram("halfMarathon", HALF_MARATHON_WEEKS),
  buildProgram("marathon", MARATHON_WEEKS),
];

/** What a program's workouts are recorded as; a program that is gone reads as a run. */
export function programActivity(id: string): RunProgram["activity"] {
  return findProgram(id)?.activity ?? "run";
}

export function findProgram(id: string): RunProgram | null {
  return RUN_PROGRAMS.find((program) => program.id === id) ?? null;
}

/** Where a person stands in a program. */
export interface ProgramProgress {
  programId: string;
  /**
   * Whether the person is using the program. Off keeps their place but stops
   * the Record screen choosing its workouts and the reminders. Absent in
   * older stored data, which means on.
   */
  enabled?: boolean;
  /** Index of the next workout to do; equals the length when finished. */
  next: number;
}

export interface ProgramStatus {
  program: RunProgram;
  /** The next workout, or null when every workout is done. */
  workout: ProgramWorkout | null;
  /** Workouts finished so far. */
  done: number;
  total: number;
  finished: boolean;
}

/** Resolves stored progress against the program, clamping a stale index. */
export function programStatus(progress: ProgramProgress): ProgramStatus | null {
  const program = findProgram(progress.programId);
  if (!program) return null;
  const total = program.workouts.length;
  const next = Math.min(Math.max(0, Math.floor(progress.next)), total);
  return {
    program,
    workout: program.workouts[next] ?? null,
    done: next,
    total,
    finished: next >= total,
  };
}

/** Moves on from workout `index`, but only if it is the one due. */
export function advanceProgress(
  progress: ProgramProgress,
  completedIndex: number,
): ProgramProgress {
  return completedIndex === progress.next
    ? { ...progress, next: progress.next + 1 }
    : progress;
}

/** Total time of a plan in whole minutes, for a one-line description. */
export function planMinutes(plan: IntervalPlan): number {
  return Math.round(plan.steps.reduce((sum, s) => sum + s.seconds, 0) / 60);
}

/** Whole minutes of running (work steps) in a plan, walking and warm-up left out. */
export function runMinutes(plan: IntervalPlan): number {
  return Math.round(
    plan.steps
      .filter((s) => s.kind === "work")
      .reduce((sum, s) => sum + s.seconds, 0) / 60,
  );
}

export interface ProgramOutline {
  /** Total minutes of each workout in week 1, in order. */
  firstWeek: number[];
  /** Minutes of running in the biggest workout, where it builds to. */
  peakRunMinutes: number;
}

/** A glance at a program: what week 1 looks like and what it builds to. */
export function programOutline(program: RunProgram): ProgramOutline {
  const first = program.workouts.filter((w) => w.week === 0);
  return {
    firstWeek: first.map((w) => planMinutes(w.plan)),
    peakRunMinutes: program.workouts.reduce(
      (max, w) => Math.max(max, runMinutes(w.plan)),
      0,
    ),
  };
}

/** A stored program as the server holds it: the person's own workouts. */
export interface StoredRunProgram {
  program_id: string;
  next_index: number;
  workouts: ProgramWorkout[];
}

/**
 * Like `programStatus`, but over the person's own (possibly adjusted)
 * workouts rather than the built-in definition.
 */
export function storedProgramStatus(stored: StoredRunProgram): ProgramStatus {
  const workouts = stored.workouts;
  const weeks = workouts.reduce((max, w) => Math.max(max, w.week + 1), 0);
  const program: RunProgram = {
    id: stored.program_id,
    activity: programActivity(stored.program_id),
    workouts,
    weeks,
    workoutsPerWeek: workouts.filter((w) => w.week === 0).length,
  };
  const total = workouts.length;
  const next = Math.min(Math.max(0, Math.floor(stored.next_index)), total);
  return {
    program,
    workout: workouts[next] ?? null,
    done: next,
    total,
    finished: next >= total,
  };
}
