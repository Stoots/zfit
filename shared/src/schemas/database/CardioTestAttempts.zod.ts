import { z } from "zod";

export const cardioTestTypeSchema = z.literal("cooper_run");
export const cardioTestResultsSchema = z.strictObject({
  distance_meters: z.number().positive(),
});

export const cardioTestAttemptsSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  test_type: cardioTestTypeSchema,
  attempt_date: z.iso.date(),
  results: cardioTestResultsSchema,
  created_at: z.date(),
  updated_at: z.date(),
});
export type CardioTestAttempts = z.infer<typeof cardioTestAttemptsSchema>;
