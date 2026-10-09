import { z } from "zod";

export const trainingProgramsSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  name: z.string(),
  goal: z.string(),
  start_date: z.iso.date(),
  end_date: z.iso.date(),
  schedule_type: z.literal("fixed"),
  auto_shift: z.boolean(),
  created_at: z.date(),
  updated_at: z.date(),
});
export type TrainingPrograms = z.infer<typeof trainingProgramsSchema>;
