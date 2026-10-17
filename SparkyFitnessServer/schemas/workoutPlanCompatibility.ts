import { z } from 'zod';
import {
  workoutPlanCreateRequestSchema,
  workoutPlanUpdateRequestSchema,
  workoutPlanAssignmentSetInputSchema,
} from '@workspace/shared';

// Upstream's editor sends database integer IDs as strings.
const integerId = z.union([
  z.number().int().positive(),
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().positive()),
]);
const assignment = z
  .strictObject({
    id: integerId.optional(),
    workout_preset_id: integerId.nullable().optional(),
    exercise_id: z.uuid().nullable().optional(),
    day_of_week: z.number().int().min(0).max(6).nullable(),
    session_index: z.number().int().positive().nullable(),
    session_name: z.string().trim().min(1).max(200).nullable(),
    sort_order: z.number().int().nonnegative(),
    sets: z.array(workoutPlanAssignmentSetInputSchema).optional(),
  })
  .refine(
    (row) => Boolean(row.exercise_id) !== Boolean(row.workout_preset_id),
    {
      message: 'Select exactly one exercise or preset.',
    }
  );
const { sessions: _sessions, ...fields } = workoutPlanCreateRequestSchema.shape;
const legacyCreate = z.strictObject({
  ...fields,
  assignments: z.array(assignment),
});
function validateIdentities(
  plan: { assignments: LegacyPlanAssignments },
  ctx: z.RefinementCtx
) {
  const ids = new Set<number>();
  for (const [index, assignment] of plan.assignments.entries()) {
    if (assignment.id !== undefined && ids.has(assignment.id))
      ctx.addIssue({
        code: 'custom',
        path: ['assignments', index, 'id'],
        message: 'Assignment IDs must be unique.',
      });
    if (assignment.id !== undefined) ids.add(assignment.id);
    const numbers = assignment.sets?.map((set) => set.set_number) ?? [];
    if (new Set(numbers).size !== numbers.length)
      ctx.addIssue({
        code: 'custom',
        path: ['assignments', index, 'sets'],
        message: 'Set numbers must be unique.',
      });
  }
}
const legacyUpdate = legacyCreate
  .partial()
  .required({ assignments: true })
  .superRefine(validateIdentities);
export const compatiblePlanCreateSchema = z.union([
  workoutPlanCreateRequestSchema,
  legacyCreate.superRefine(validateIdentities),
]);
export const compatiblePlanUpdateSchema = z.union([
  workoutPlanUpdateRequestSchema,
  legacyUpdate,
]);
export type CompatiblePlanCreate = z.input<typeof compatiblePlanCreateSchema>;
export type CompatiblePlanUpdate = z.input<typeof compatiblePlanUpdateSchema>;
export type LegacyPlanAssignments = z.output<
  typeof legacyCreate
>['assignments'];
