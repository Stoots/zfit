import { z } from "zod";

export const runProgramStepSchema = z.object({
  kind: z.enum(["warmup", "work", "recovery", "cooldown"]),
  seconds: z.number().int().min(1).max(14400),
});

export const runProgramPlanSchema = z.object({
  style: z.enum(["runWalk", "fastEasy"]),
  steps: z.array(runProgramStepSchema).min(1).max(200),
});

export const runProgramWorkoutSchema = z.object({
  week: z.number().int().min(0).max(51),
  day: z.number().int().min(0).max(6),
  plan: runProgramPlanSchema,
});

export const runProgramAdjustmentSchema = z.object({
  /** ISO timestamp. */
  at: z.string(),
  summary: z.string().max(500),
  source: z.enum(["user", "assistant"]),
});
export type RunProgramAdjustment = z.infer<typeof runProgramAdjustmentSchema>;

export const runProgramEffortSchema = z.object({
  /** Index of the workout in `workouts`. */
  index: z.number().int().min(0).max(1000),
  /** How hard it felt, 1 (very easy) to 10 (all out). */
  rating: z.number().int().min(1).max(10),
  /** ISO timestamp. */
  at: z.string(),
});
export type RunProgramEffort = z.infer<typeof runProgramEffortSchema>;

export const runProgramCompletionSchema = z.object({
  /** Index of the workout in `workouts`. */
  index: z.number().int().min(0).max(1000),
  /** The diary exercise entry the workout was done as. */
  entry_id: z.string().min(1).max(64),
  /** ISO timestamp. */
  at: z.string(),
});
export type RunProgramCompletion = z.infer<typeof runProgramCompletionSchema>;

/** A real calendar day: 2026-02-31 matches the shape but is not a date. */
const isRealDay = (value: string): boolean => {
  const [y, m, d] = value.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
};
const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDay, { message: "Not a real calendar day." });
const weekday = z.number().int().min(0).max(6);

export const runProgramResponseSchema = z.object({
  id: z.string(),
  program_id: z.string(),
  enabled: z.boolean(),
  /** Index into `workouts` of the next workout; the length when finished. */
  next_index: z.number().int().min(0),
  workouts: z.array(runProgramWorkoutSchema),
  /** Most recent last, capped by the server. */
  adjustment_log: z.array(runProgramAdjustmentSchema),
  /** How hard finished workouts felt, most recent last, capped by the server. */
  effort_log: z.array(runProgramEffortSchema),
  /** Which diary entry each workout was done as, most recent last, capped by the server. */
  completion_log: z.array(runProgramCompletionSchema),
  /** Weekdays (0 = Sunday) the person plans to run; empty means every day. */
  run_days: z.array(weekday).max(7),
  /** First day (YYYY-MM-DD) the Diary offers the workout, or null for any. */
  start_date: dayString.nullable(),
  /** The person's goal day (e.g. race day), or null. Nothing is scheduled after it. */
  end_date: dayString.nullable(),
  /** The last day a program workout was completed (the person's local day). */
  last_done_date: dayString.nullable(),
  updated_at: z.string(),
});
export type RunProgramResponse = z.infer<typeof runProgramResponseSchema>;

/** `program` is null until the person has chosen one. */
export const getRunProgramResponseSchema = z.object({
  program: runProgramResponseSchema.nullable(),
});
export type GetRunProgramResponse = z.infer<typeof getRunProgramResponseSchema>;

/**
 * Creates the person's program (seeded from the built-in one) or changes its
 * switch and place. Only fields present are changed.
 */
export const upsertRunProgramBodySchema = z
  .object({
    program_id: z.string().min(1).max(50),
    enabled: z.boolean().optional(),
    next_index: z.number().int().min(0).max(1000).optional(),
    run_days: z.array(weekday).max(7).optional(),
    /** null clears it; absent leaves it as it is. */
    start_date: dayString.nullable().optional(),
    end_date: dayString.nullable().optional(),
  })
  .refine(
    (body) =>
      !body.start_date || !body.end_date || body.end_date >= body.start_date,
    {
      message: "The goal day cannot be before the first day.",
      path: ["end_date"],
    },
  );
export type UpsertRunProgramBody = z.infer<typeof upsertRunProgramBodySchema>;

/** Marks workout `index` done, if it is the one due. */
export const completeRunProgramWorkoutBodySchema = z.object({
  index: z.number().int().min(0).max(1000),
  /** The program the workout belonged to; ignored if the person has switched since. */
  program_id: z.string().min(1).max(40).optional(),
  /** The person's local day, recorded as the last day a workout was done. */
  day: dayString.optional(),
  /** The diary exercise entry the workout was done as, so it can be shown as part of the program. */
  entry_id: z.string().min(1).max(64).optional(),
});
export type CompleteRunProgramWorkoutBody = z.infer<
  typeof completeRunProgramWorkoutBodySchema
>;

/** Records how hard finished workout `index` felt. */
export const rateRunProgramWorkoutBodySchema = z.object({
  index: z.number().int().min(0).max(1000),
  rating: z.number().int().min(1).max(10),
  /** The program the workout belonged to; ignored if the person has switched since. */
  program_id: z.string().min(1).max(40).optional(),
});
export type RateRunProgramWorkoutBody = z.infer<
  typeof rateRunProgramWorkoutBodySchema
>;
