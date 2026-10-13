import { z } from 'zod';
import { dateSchema, setTypeEnum, uuidSchema } from './common.js';
import { workoutPlanPresetSnapshotSchema } from '@workspace/shared';

// workout_plan_templates.id is a SERIAL PRIMARY KEY (integer), so plan_id must be
// a positive integer, not a UUID. z.coerce accepts the numeric string the model
// echoes back from list_workout_plans output.
const planIdSchema = z.coerce
  .number()
  .int()
  .positive('Workout plan ID must be a positive integer');

const confirmedSchema = z
  .boolean()
  .optional()
  .describe(
    'Must be true to apply the mutation (update/delete). If omitted or false, the tool returns a confirmation prompt and does not change anything.'
  );

export const workoutPlanSetSchema = z
  .object({
    id: z.number().int().positive().optional(),
    set_number: z.number().int().positive().optional(),
    set_type: setTypeEnum.nullable().optional(),
    reps: z.number().nullable().optional(),
    weight: z
      .number()
      .nullable()
      .optional()
      .describe('Weight in kg; retain null for unspecified load'),
    duration: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .describe('Duration in seconds'),
    distance: z
      .number()
      .min(0)
      .nullable()
      .optional()
      .describe('Distance in km'),
    rest_time: z.number().min(0).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .strict();

export const workoutPlanAssignmentItemSchema = z
  .object({
    id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Retain existing assignment ID when editing'),
    workout_session_id: uuidSchema.optional(),
    preset_snapshot: workoutPlanPresetSnapshotSchema
      .optional()
      .describe(
        'Frozen local prescription; retain on edits instead of refreshing from the library'
      ),
    workout_preset_id: z.coerce.number().int().positive().nullable().optional(),
    preset_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Name of a preset you own or that is family-shared (alternative to workout_preset_id)'
      ),
    exercise_id: uuidSchema.nullable().optional(),
    exercise_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Name of an exercise (alternative to exercise_id)'),
    sets: z
      .array(workoutPlanSetSchema)
      .optional()
      .describe('Planned sets for an exercise assignment'),
    sort_order: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export const workoutPlanSessionItemSchema = z
  .object({
    id: uuidSchema
      .optional()
      .describe('Stable Workout Session ID; omit only for a new session'),
    name: z.string().min(1).max(200),
    day_of_week: z.number().int().min(0).max(6).nullable().default(null),
    sort_order: z.number().int().min(0).optional(),
    is_optional: z
      .boolean()
      .default(false)
      .describe(
        'Explicit optionality; Program bindings omit unfinished optional work after its effective day'
      ),
    assignments: z.array(workoutPlanAssignmentItemSchema),
  })
  .strict();

export const workoutPlanSessionsInputSchema = z
  .union([z.array(workoutPlanSessionItemSchema), z.string()])
  .describe(
    'Nested Workout Sessions as an array or JSON string: [{id?,name,day_of_week:null|0..6,sort_order?,is_optional?,assignments:[{id?,exercise_id?|exercise_name?|workout_preset_id?|preset_name?,sets?,preset_snapshot?}]}]. Repeated names do not group sessions; optionality is never inferred from names.'
  );

export type WorkoutPlanSessionItemInput = z.infer<
  typeof workoutPlanSessionItemSchema
>;

export const WORKOUT_PLAN_ACTIONS = [
  'list_workout_plans',
  'get_workout_plan',
  'get_active_workout_plan',
  'create_workout_plan',
  'update_workout_plan',
  'delete_workout_plan',
] as const;

const listWorkoutPlansSchema = z
  .object({
    action: z.literal('list_workout_plans'),
  })
  .strict();

const getWorkoutPlanSchema = z
  .object({
    action: z.literal('get_workout_plan'),
    plan_id: planIdSchema.describe(
      'ID of the workout plan template to inspect'
    ),
  })
  .strict();

const getActiveWorkoutPlanSchema = z
  .object({
    action: z.literal('get_active_workout_plan'),
    date: dateSchema
      .optional()
      .describe(
        'Date in YYYY-MM-DD format to check active plan progression for (defaults to today in user timezone)'
      ),
  })
  .strict();

const createWorkoutPlanSchema = z
  .object({
    action: z.literal('create_workout_plan'),
    plan_name: z
      .string()
      .min(1)
      .max(200)
      .describe('Name for the workout plan template'),
    description: z
      .string()
      .max(1000)
      .nullable()
      .optional()
      .describe('Optional description for the plan'),
    schedule_type: z
      .enum(['sequential', 'weekly'])
      .default('sequential')
      .describe(
        'Schedule type: "sequential" (default, ordered cycle of sessions unaffected by missed days) or "weekly" (tied to specific weekdays)'
      ),
    entry_mode: z
      .enum(['prompt', 'prefill'])
      .optional()
      .describe(
        'Diary behavior: "prompt" (shows banner to start session; forced for sequential) or "prefill" (pre-generates entries on calendar; weekly only)'
      ),
    is_active: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether this plan is active'),
    start_date: dateSchema
      .nullable()
      .optional()
      .describe('Start date for the plan (YYYY-MM-DD)'),
    end_date: dateSchema
      .nullable()
      .optional()
      .describe('End date for the plan (YYYY-MM-DD)'),
    sessions: workoutPlanSessionsInputSchema.optional(),
  })
  .strict();

const updateWorkoutPlanSchema = z
  .object({
    action: z.literal('update_workout_plan'),
    plan_id: planIdSchema.describe('ID of the workout plan template to update'),
    confirmed: confirmedSchema,
    plan_name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).nullable().optional(),
    schedule_type: z.enum(['sequential', 'weekly']).optional(),
    entry_mode: z.enum(['prompt', 'prefill']).optional(),
    is_active: z.boolean().optional(),
    start_date: dateSchema.nullable().optional(),
    end_date: dateSchema.nullable().optional(),
    sessions: workoutPlanSessionsInputSchema.optional(),
  })
  .strict();

const deleteWorkoutPlanSchema = z
  .object({
    action: z.literal('delete_workout_plan'),
    plan_id: planIdSchema.describe('ID of the workout plan template to delete'),
    confirmed: confirmedSchema,
  })
  .strict();

export const manageWorkoutPlansSchema = z.discriminatedUnion('action', [
  listWorkoutPlansSchema,
  getWorkoutPlanSchema,
  getActiveWorkoutPlanSchema,
  createWorkoutPlanSchema,
  updateWorkoutPlanSchema,
  deleteWorkoutPlanSchema,
]);

export type ManageWorkoutPlansInput = z.infer<typeof manageWorkoutPlansSchema>;

// Flat published schema (all fields optional) — real validation is the strict
// union above inside the handler.
export const manageWorkoutPlansInput = z.object({
  action: z.enum(WORKOUT_PLAN_ACTIONS).optional(),
  plan_id: z.union([z.string(), z.number()]).optional(),
  confirmed: z.boolean().optional(),
  plan_name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  schedule_type: z.enum(['sequential', 'weekly']).optional(),
  entry_mode: z.enum(['prompt', 'prefill']).optional(),
  is_active: z.boolean().optional(),
  start_date: dateSchema.nullable().optional(),
  end_date: dateSchema.nullable().optional(),
  date: dateSchema.optional(),
  sessions: workoutPlanSessionsInputSchema.optional(),
});
