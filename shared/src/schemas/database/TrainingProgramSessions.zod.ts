import { z } from "zod";
import { trainingProgramWorkoutSchema } from "../api/TrainingPrograms.api.zod.ts";

export const trainingProgramSessionsSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  program_id: z.uuid(),
  week_id: z.uuid(),
  name: z.string(),
  scheduled_date: z.iso.date(),
  effective_date: z.iso.date(),
  status: z.enum(["planned", "completed", "missed"]),
  outcome_at: z.date().nullable(),
  completed_workout: trainingProgramWorkoutSchema.nullable(),
  workout_plan_name_snapshot: z.string().nullable(),
  exercise_entry_id: z.uuid().nullable(),
  exercise_preset_entry_id: z.uuid().nullable(),
  workout_plan_id: z.number().int().positive(),
  sort_order: z.number().int().nonnegative(),
  created_at: z.date(),
  updated_at: z.date(),
});
export type TrainingProgramSessions = z.infer<
  typeof trainingProgramSessionsSchema
>;
