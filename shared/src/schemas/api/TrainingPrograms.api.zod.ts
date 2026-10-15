import { z } from "zod";
import { cardioTestTypeSchema } from "../database/CardioTestAttempts.zod.ts";

const title = z.string().trim().min(1).max(200);
const goal = z.string().trim().min(1).max(2000);
const day = z.iso
  .date()
  .refine(
    (value) => value >= "0001-01-01",
    "Dates must be between 0001-01-01 and 9999-12-31.",
  );
const childId = z.uuid().optional();

const sessionFields = {
  id: childId,
  name: title,
  scheduled_date: day,
  is_optional: z.boolean().optional(),
};
const sessionInput = z
  .strictObject({
    ...sessionFields,
    workout_session_id: z.uuid().nullable().optional(),
    cardio_test_type: cardioTestTypeSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      Boolean(value.workout_session_id) !== Boolean(value.cardio_test_type),
    "Choose either an exact Workout Session or a Cardio Test protocol.",
  );
const weekInput = z.strictObject({
  id: childId,
  start_date: day,
  end_date: day,
  sessions: z.array(sessionInput).max(50),
});
const phaseInput = z.strictObject({
  id: childId,
  name: title,
  goal,
  weeks: z.array(weekInput).max(104),
});
const programInput = z.strictObject({
  name: title,
  goal,
  start_date: day,
  end_date: day,
  schedule_type: z.literal("fixed").default("fixed"),
  auto_shift: z.boolean().default(false),
  phases: z.array(phaseInput).max(24),
});

export const trainingProgramInputSchema = programInput.superRefine(
  (program, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    if (program.end_date < program.start_date) {
      issue(
        ["end_date"],
        "Program end date must be on or after its start date.",
      );
    }
    const ids = new Set<string>();
    let previousEnd = "";
    let totalSessions = 0;
    const unique = (id: string | undefined, path: (string | number)[]) => {
      if (!id) return;
      if (ids.has(id))
        issue(path, "Each phase, week and session ID must be unique.");
      ids.add(id);
    };
    program.phases.forEach((phase, p) => {
      unique(phase.id, ["phases", p, "id"]);
      phase.weeks.forEach((week, w) => {
        const path = ["phases", p, "weeks", w];
        unique(week.id, [...path, "id"]);
        const days =
          (Date.parse(week.end_date) - Date.parse(week.start_date)) / 86400000;
        if (days < 0 || days > 6)
          issue(
            [...path, "end_date"],
            "A week must span between one and seven days.",
          );
        if (
          week.start_date < program.start_date ||
          week.end_date > program.end_date
        ) {
          issue(
            [...path, "start_date"],
            "Week dates must be within the Program date range.",
          );
        }
        if (week.start_date <= previousEnd) {
          issue(
            [...path, "start_date"],
            "Weeks must be ordered by date and must not overlap.",
          );
        }
        previousEnd = week.end_date;
        totalSessions += week.sessions.length;
        week.sessions.forEach((session, s) => {
          unique(session.id, [...path, "sessions", s, "id"]);
          if (
            session.scheduled_date < week.start_date ||
            session.scheduled_date > week.end_date
          ) {
            issue(
              [...path, "sessions", s, "scheduled_date"],
              "Session date must be within its week.",
            );
          }
        });
      });
    });
    if (totalSessions > 1000)
      issue(["phases"], "A Program can contain at most 1000 Planned Sessions.");
  },
);

export const trainingProgramWorkoutSchema = z.strictObject({
  type: z.enum(["preset", "individual"]),
  id: z.uuid(),
  name: z.string(),
  entry_date: day,
});
export const trainingProgramOutcomeInputSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({ status: z.literal("missed") }),
    z.strictObject({
      status: z.literal("completed"),
      workout: trainingProgramWorkoutSchema.pick({ type: true, id: true }),
    }),
  ],
);
export type TrainingProgramOutcomeInput = z.infer<
  typeof trainingProgramOutcomeInputSchema
>;
export const trainingProgramCompletionInputSchema = z.strictObject({
  entry_date: day,
});
export type TrainingProgramCompletionInput = z.infer<
  typeof trainingProgramCompletionInputSchema
>;

const sessionCommon = {
  id: z.uuid(),
  is_optional: z.boolean(),
  sort_order: z.number().int().nonnegative(),
  effective_date: day,
  status: z.enum(["planned", "completed", "missed", "omitted"]),
  outcome_at: z.iso.datetime().nullable(),
};
const session = z
  .object({
    ...sessionFields,
    ...sessionCommon,
    workout_session_id: z.uuid().nullable(),
    workout_session_name: z.string().nullable(),
    workout_plan_id: z.number().int().positive().nullable(),
    workout_plan_name: z.string().nullable(),
    cardio_test_type: z.string().min(1).nullable(),
    completed_workout: trainingProgramWorkoutSchema.nullable(),
    completed_test_attempt: z
      .object({
        id: z.uuid(),
        test_type: z.string(),
        attempt_date: day,
        results: z.record(z.string(), z.unknown()),
      })
      .nullable(),
  })
  .strip();
const week = weekInput
  .extend({
    id: z.uuid(),
    sort_order: z.number().int().nonnegative(),
    sessions: z.array(session),
  })
  .strip();
const phase = phaseInput
  .extend({
    id: z.uuid(),
    sort_order: z.number().int().nonnegative(),
    weeks: z.array(week),
  })
  .strip();
export const trainingProgramSchema = programInput
  .extend({
    id: z.uuid(),
    user_id: z.string(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
    schedule_end_date: day,
    phases: z.array(phase),
  })
  .strip();
export type TrainingProgramInput = z.input<typeof trainingProgramInputSchema>;
export type TrainingProgram = z.infer<typeof trainingProgramSchema>;
