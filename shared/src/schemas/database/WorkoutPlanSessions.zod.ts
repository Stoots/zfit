import { z } from "zod";

export const workoutPlanSessionsSchema = z.object({
  id: z.uuid(),
  template_id: z.number().int().positive(),
  user_id: z.uuid(),
  name: z.string(),
  day_of_week: z.number().int().min(0).max(6).nullable(),
  sort_order: z.number().int().nonnegative(),
  is_optional: z.boolean(),
  created_at: z.date(),
  updated_at: z.date(),
});
export const workoutPlanSessionsInitializerSchema = workoutPlanSessionsSchema
  .omit({
    created_at: true,
    updated_at: true,
  })
  .extend({ id: z.uuid().optional() });
export const workoutPlanSessionsMutatorSchema =
  workoutPlanSessionsInitializerSchema.partial();
export type WorkoutPlanSessions = z.infer<typeof workoutPlanSessionsSchema>;
export type WorkoutPlanSessionsInitializer = z.infer<
  typeof workoutPlanSessionsInitializerSchema
>;
export type WorkoutPlanSessionsMutator = z.infer<
  typeof workoutPlanSessionsMutatorSchema
>;
