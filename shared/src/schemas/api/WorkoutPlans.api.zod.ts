import { z } from "zod";
import {
  workoutFormatSchema,
  workoutPresetExerciseResponseSchema,
  workoutPresetSetRequestSchema,
} from "./WorkoutPresets.api.zod.ts";
import { exerciseModalitySchema } from "./Exercises.api.zod.ts";

/** Local prescription, never refreshed from the library on a plan save/read. */
export const workoutPlanPresetSnapshotSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    description: z.string().nullable(),
    workout_format: workoutFormatSchema,
    time_cap_seconds: z.number().int().nullable().optional(),
    exercises: z.array(
      workoutPresetExerciseResponseSchema
        .extend({
          id: z.number().int().positive().optional(),
          sets: z.array(
            workoutPresetSetRequestSchema
              .extend({
                id: z.number().int().positive().optional(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const workoutPlanAssignmentSetInputSchema = workoutPresetSetRequestSchema
  .extend({
    id: z.number().int().positive().optional(),
  })
  .passthrough();
export const workoutPlanAssignmentInputSchema = z
  .object({
    id: z.number().int().positive().optional(),
    exercise_id: z.uuid().nullable().optional(),
    workout_preset_id: z.number().int().positive().nullable().optional(),
    sort_order: z.number().int().nonnegative(),
    sets: z.array(workoutPlanAssignmentSetInputSchema).optional(),
    preset_snapshot: workoutPlanPresetSnapshotSchema.optional(),
  })
  .superRefine((assignment, ctx) => {
    if (
      (assignment.exercise_id &&
        (assignment.workout_preset_id || assignment.preset_snapshot)) ||
      (!assignment.id &&
        !assignment.exercise_id &&
        !assignment.workout_preset_id &&
        !assignment.preset_snapshot)
    )
      ctx.addIssue({
        code: "custom",
        message: "Select exactly one exercise or preset.",
      });
    if (
      assignment.workout_preset_id &&
      assignment.preset_snapshot &&
      assignment.preset_snapshot.id !== assignment.workout_preset_id
    )
      ctx.addIssue({
        code: "custom",
        path: ["preset_snapshot", "id"],
        message: "Snapshot must belong to the selected preset.",
      });
    if (assignment.exercise_id && assignment.preset_snapshot)
      ctx.addIssue({
        code: "custom",
        path: ["preset_snapshot"],
        message:
          "Individual exercise assignments cannot contain a preset snapshot.",
      });
  });
export const workoutPlanSessionInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(200),
  day_of_week: z.number().int().min(0).max(6).nullable(),
  sort_order: z.number().int().nonnegative(),
  assignments: z.array(workoutPlanAssignmentInputSchema),
});
const planFields = {
  plan_name: z.string().trim().min(1).max(255),
  description: z.string().nullable().optional(),
  start_date: z.iso.date().nullable().optional(),
  end_date: z.iso.date().nullable().optional(),
  is_active: z.boolean().optional(),
  schedule_type: z.enum(["weekly", "sequential"]).optional(),
  entry_mode: z.enum(["prompt", "prefill"]).optional(),
  sessions: z.array(workoutPlanSessionInputSchema),
  currentClientDate: z.iso.date().nullable().optional(),
};
function validateSessions(
  plan: {
    schedule_type?: "weekly" | "sequential";
    sessions?: z.infer<typeof workoutPlanSessionInputSchema>[];
  },
  ctx: z.RefinementCtx,
) {
  const sessionIds = new Set<string>();
  const assignmentIds = new Set<number>();
  for (const [s, session] of (plan.sessions ?? []).entries()) {
    if (session.id && sessionIds.has(session.id))
      ctx.addIssue({
        code: "custom",
        path: ["sessions", s, "id"],
        message: "Session IDs must be unique.",
      });
    if (session.id) sessionIds.add(session.id);
    if (plan.schedule_type === "sequential" && session.day_of_week !== null)
      ctx.addIssue({
        code: "custom",
        path: ["sessions", s, "day_of_week"],
        message: "Sequential sessions have no weekday.",
      });
    for (const [a, assignment] of session.assignments.entries()) {
      if (assignment.id && assignmentIds.has(assignment.id))
        ctx.addIssue({
          code: "custom",
          path: ["sessions", s, "assignments", a, "id"],
          message: "Assignment IDs must be unique.",
        });
      if (assignment.id) assignmentIds.add(assignment.id);
      const setNumbers = new Set<number>();
      for (const set of assignment.sets ?? []) {
        if (setNumbers.has(set.set_number))
          ctx.addIssue({
            code: "custom",
            path: ["sessions", s, "assignments", a, "sets"],
            message: "Set numbers must be unique within an assignment.",
          });
        setNumbers.add(set.set_number);
      }
    }
  }
}
export const workoutPlanCreateRequestSchema = z
  .strictObject(planFields)
  .superRefine(validateSessions);
export const workoutPlanUpdateRequestSchema = z
  .strictObject(planFields)
  .partial()
  .superRefine(validateSessions);
export const workoutPlanAssignmentResponseSchema = z.object({
  id: z.number().int().positive(),
  workout_session_id: z.uuid(),
  exercise_id: z.uuid().nullable(),
  workout_preset_id: z.number().int().positive().nullable(),
  sort_order: z.number().int().nonnegative(),
  exercise_name: z.string().nullable(),
  modality: exerciseModalitySchema.nullable(),
  workout_preset_name: z.string().nullable(),
  workout_preset_format: workoutFormatSchema.nullable(),
  preset_snapshot: workoutPlanPresetSnapshotSchema.nullable(),
  sets: z.array(workoutPlanAssignmentSetInputSchema),
});
export const workoutPlanSessionResponseSchema =
  workoutPlanSessionInputSchema.extend({
    id: z.uuid(),
    assignments: z.array(workoutPlanAssignmentResponseSchema),
  });
export const workoutPlanSequencePositionSchema = z.object({
  current: z.number().int().positive(),
  total: z.number().int().positive(),
  session_name: z.string(),
});
export const workoutPlanResponseSchema = z.object({
  id: z.number().int().positive(),
  user_id: z.string(),
  plan_name: z.string(),
  description: z.string().nullable(),
  start_date: z.iso.date().nullable(),
  end_date: z.iso.date().nullable(),
  is_active: z.boolean().nullable(),
  schedule_type: z.enum(["weekly", "sequential"]),
  entry_mode: z.enum(["prompt", "prefill"]),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  sessions: z.array(workoutPlanSessionResponseSchema),
  training_program_session_id: z.uuid().optional(),
  next_session: workoutPlanSessionResponseSchema.nullable().optional(),
  next_assignments: z.array(workoutPlanAssignmentResponseSchema).optional(),
  sequence_position: workoutPlanSequencePositionSchema.nullable().optional(),
});
export type WorkoutPlanPresetSnapshot = z.infer<
  typeof workoutPlanPresetSnapshotSchema
>;
export type WorkoutPlanAssignmentSetInput = z.infer<
  typeof workoutPlanAssignmentSetInputSchema
>;
export type WorkoutPlanAssignmentInput = z.infer<
  typeof workoutPlanAssignmentInputSchema
>;
export type WorkoutPlanSessionInput = z.infer<
  typeof workoutPlanSessionInputSchema
>;
export type WorkoutPlanCreateRequest = z.input<
  typeof workoutPlanCreateRequestSchema
>;
export type WorkoutPlanUpdateRequest = z.input<
  typeof workoutPlanUpdateRequestSchema
>;
export type WorkoutPlanAssignmentResponse = z.infer<
  typeof workoutPlanAssignmentResponseSchema
>;
export type WorkoutPlanSessionResponse = z.infer<
  typeof workoutPlanSessionResponseSchema
>;
export type WorkoutPlanResponse = z.infer<typeof workoutPlanResponseSchema>;
