import { z } from "zod";
import {
  sprintResultsSchema,
  thirtySecondResultsSchema,
  rampResultsSchema,
} from "../api/CardioTests.api.zod.ts";

export const cardioTestTypeSchema = z.enum([
  "cooper_run",
  "sprint_6s",
  "power_30s",
  "ramp",
]);
export const cardioTestResultsSchema = z.strictObject({
  distance_meters: z.number().positive(),
});

const fields = {
  id: z.uuid(),
  user_id: z.uuid(),
  attempt_date: z.iso.date(),
  planned_session_id: z.uuid().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
};
export const cardioTestAttemptsSchema = z.discriminatedUnion("test_type", [
  z.object({
    ...fields,
    test_type: z.literal("cooper_run"),
    results: cardioTestResultsSchema,
  }),
  z.object({
    ...fields,
    test_type: z.literal("sprint_6s"),
    results: sprintResultsSchema,
  }),
  z.object({
    ...fields,
    test_type: z.literal("power_30s"),
    results: thirtySecondResultsSchema,
  }),
  z.object({
    ...fields,
    test_type: z.literal("ramp"),
    results: rampResultsSchema,
  }),
]);
export type CardioTestAttempts = z.infer<typeof cardioTestAttemptsSchema>;
