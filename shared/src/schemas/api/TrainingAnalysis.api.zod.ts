import { z } from "zod";
import { cardioTestTypeSchema } from "../database/CardioTestAttempts.zod.ts";

export const TRAINING_HEALTH_METRICS = [
  "total_steps",
  "total_distance_meters",
  "active_calories",
  "resting_heart_rate",
  "vo2_max",
  "heart_rate",
  "hrv",
] as const;

// This is the user's per-query disclosure ceiling, never provider-generated.
export const trainingAnalysisScopeSchema = z
  .strictObject({
    start_date: z.iso.date(),
    end_date: z.iso.date(),
    programs: z.boolean(),
    program_id: z.uuid().optional(),
    test_types: z.array(cardioTestTypeSchema).max(4),
    health_metrics: z.array(z.enum(TRAINING_HEALTH_METRICS)).max(7),
  })
  .refine(
    (s) =>
      s.end_date >= s.start_date &&
      Date.parse(s.end_date) - Date.parse(s.start_date) <= 365 * 86400000,
    "Choose an ordered date range of at most 366 days.",
  )
  .refine(
    (s) => s.programs || s.test_types.length > 0 || s.health_metrics.length > 0,
    "Select at least one data source.",
  );
export type TrainingAnalysisScope = z.infer<typeof trainingAnalysisScopeSchema>;
