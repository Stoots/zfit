import { z } from "zod";
import {
  workoutPlanAssignmentInputSchema,
  workoutPlanAssignmentResponseSchema,
  workoutPlanResponseSchema,
} from "./WorkoutPlans.api.zod.ts";

export const workoutPlanBulkFieldSchema = z.enum([
  "sets",
  "set_type",
  "reps",
  "weight",
  "duration",
  "distance",
  "rest_time",
  "notes",
  "workout_format",
  "time_cap_seconds",
  "description",
]);
export const workoutPlanBulkRequestSchema = z.strictObject({
  plan_id: z.number().int().positive(),
  program_id: z.uuid().nullable(),
  source_session_id: z.uuid(),
  source_assignment_id: z.number().int().positive(),
  prescription: workoutPlanAssignmentInputSchema,
  fields: z
    .array(workoutPlanBulkFieldSchema)
    .min(1)
    .refine((v) => new Set(v).size === v.length, "Select each field once."),
  targets: z
    .array(
      z.strictObject({
        workout_session_id: z.uuid(),
        assignment_id: z.number().int().positive(),
        planned_session_ids: z.array(z.uuid()),
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (v) => new Set(v.map((t) => t.workout_session_id)).size === v.length,
      "Select each Workout Session once.",
    ),
});
export const workoutPlanBulkApplyRequestSchema = z.strictObject({
  request: workoutPlanBulkRequestSchema,
  revision: z.string().regex(/^[a-f0-9]{64}$/),
});
export const workoutPlanBulkBindingSchema = z.object({
  id: z.uuid(),
  program_id: z.uuid(),
  program_name: z.string(),
  name: z.string(),
  effective_date: z.iso.date(),
  status: z.string(),
});
export const workoutPlanBulkCandidateSchema = z.object({
  workout_session_id: z.uuid(),
  name: z.string(),
  assignments: z.array(workoutPlanAssignmentResponseSchema),
  bindings: z.array(workoutPlanBulkBindingSchema),
  eligible: z.boolean(),
  reason: z.string().nullable(),
});
export const workoutPlanBulkPreviewSchema = z.object({
  request: workoutPlanBulkRequestSchema,
  revision: z.string(),
  targets: z.array(
    z.object({
      workout_session_id: z.uuid(),
      name: z.string(),
      bindings: z.array(workoutPlanBulkBindingSchema),
      before: workoutPlanAssignmentResponseSchema,
      after: workoutPlanAssignmentResponseSchema,
    }),
  ),
});
export const workoutPlanBulkApplyResponseSchema = z.object({
  plan: workoutPlanResponseSchema,
});
export type WorkoutPlanBulkField = z.infer<typeof workoutPlanBulkFieldSchema>;
export type WorkoutPlanBulkRequest = z.infer<
  typeof workoutPlanBulkRequestSchema
>;
export type WorkoutPlanBulkApplyRequest = z.infer<
  typeof workoutPlanBulkApplyRequestSchema
>;
export type WorkoutPlanBulkCandidate = z.infer<
  typeof workoutPlanBulkCandidateSchema
>;
export type WorkoutPlanBulkPreview = z.infer<
  typeof workoutPlanBulkPreviewSchema
>;
export type WorkoutPlanBulkBinding = z.infer<
  typeof workoutPlanBulkBindingSchema
>;
