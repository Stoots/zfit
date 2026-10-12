import { z } from "zod";

const attemptDateSchema = z.iso.date();
export const cooperRunAttemptInputSchema = z.strictObject({
  attempt_date: attemptDateSchema,
  distance_meters: z.number().positive(),
});
export type CooperRunAttemptInput = z.infer<
  typeof cooperRunAttemptInputSchema
>;

export const cooperRunAttemptSchema = z.strictObject({
  id: z.uuid(),
  user_id: z.uuid(),
  test_type: z.literal("cooper_run"),
  attempt_date: attemptDateSchema,
  distance_meters: z.number().positive(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type CooperRunAttempt = z.infer<typeof cooperRunAttemptSchema>;
