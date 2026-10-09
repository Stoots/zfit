import { z } from "zod";

export const trainingProgramPhasesSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  program_id: z.uuid(),
  name: z.string(),
  goal: z.string(),
  sort_order: z.number().int().nonnegative(),
  created_at: z.date(),
  updated_at: z.date(),
});
export type TrainingProgramPhases = z.infer<typeof trainingProgramPhasesSchema>;
