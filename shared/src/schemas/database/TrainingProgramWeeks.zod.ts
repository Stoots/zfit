import { z } from "zod";

export const trainingProgramWeeksSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  program_id: z.uuid(),
  phase_id: z.uuid(),
  start_date: z.iso.date(),
  end_date: z.iso.date(),
  sort_order: z.number().int().nonnegative(),
  created_at: z.date(),
  updated_at: z.date(),
});
export type TrainingProgramWeeks = z.infer<typeof trainingProgramWeeksSchema>;
