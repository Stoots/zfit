import { z } from "zod";

export const workoutProgramConsolidationsSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  program_id: z.uuid(),
  target_plan_id: z.number().int().positive(),
  manifest: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()),
  created_at: z.date(),
});
export type WorkoutProgramConsolidations = z.infer<
  typeof workoutProgramConsolidationsSchema
>;
