import { z } from "zod";

const attemptDateSchema = z.iso.date();
export const cardioTestProtocols = {
  cooper_run: { duration_seconds: 720 },
  sprint_6s: { efforts: 5, effort_seconds: 6, rest_seconds: 54 },
  power_30s: { efforts: 2, effort_seconds: 30, rest_seconds: 60 },
  ramp: { initial_watts: 100, increment_watts_per_minute: 20 },
} as const;
export const cooperRunAttemptInputSchema = z.strictObject({
  attempt_date: attemptDateSchema,
  distance_meters: z.number().positive(),
  planned_session_id: z.uuid().nullable().optional(),
});
export type CooperRunAttemptInput = z.infer<typeof cooperRunAttemptInputSchema>;

export const cooperRunAttemptSchema = z.strictObject({
  id: z.uuid(),
  user_id: z.uuid(),
  test_type: z.literal("cooper_run"),
  attempt_date: attemptDateSchema,
  distance_meters: z.number().positive(),
  planned_session_id: z.uuid().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type CooperRunAttempt = z.infer<typeof cooperRunAttemptSchema>;

const watts = z.number().finite().nonnegative();
export const sprintResultsSchema = z.strictObject({
  peak_watts: z.tuple([watts, watts, watts, watts, watts]),
});
const thirtySecondEffort = z
  .strictObject({
    peak_watts: watts,
    average_watts: watts,
  })
  .refine((effort) => effort.average_watts <= effort.peak_watts, {
    message: "Average watts cannot exceed peak watts.",
    path: ["average_watts"],
  });
export const thirtySecondResultsSchema = z.strictObject({
  efforts: z.tuple([thirtySecondEffort, thirtySecondEffort]),
});
export const rampResultsSchema = z.strictObject({
  maximum_watts: watts,
  peak_heart_rate: z.number().int().positive(),
  one_minute_heart_rate: z.number().int().positive(),
});

export const cardioTestAttemptInputSchema = z.discriminatedUnion("test_type", [
  z.strictObject({
    test_type: z.literal("sprint_6s"),
    attempt_date: attemptDateSchema,
    results: sprintResultsSchema,
    planned_session_id: z.uuid().nullable().optional(),
  }),
  z.strictObject({
    test_type: z.literal("power_30s"),
    attempt_date: attemptDateSchema,
    results: thirtySecondResultsSchema,
    planned_session_id: z.uuid().nullable().optional(),
  }),
  z.strictObject({
    test_type: z.literal("ramp"),
    attempt_date: attemptDateSchema,
    results: rampResultsSchema,
    planned_session_id: z.uuid().nullable().optional(),
  }),
]);
export type CardioTestAttemptInput = z.infer<
  typeof cardioTestAttemptInputSchema
>;
const responseFields = {
  id: z.uuid(),
  user_id: z.uuid(),
  planned_session_id: z.uuid().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
};
export const cardioTestAttemptSchema = z.discriminatedUnion("test_type", [
  cardioTestAttemptInputSchema.options[0].extend(responseFields),
  cardioTestAttemptInputSchema.options[1].extend(responseFields),
  cardioTestAttemptInputSchema.options[2].extend(responseFields),
]);
export type CardioTestAttempt = z.infer<typeof cardioTestAttemptSchema>;

export function powerTestInput(
  protocol: "sprint_6s" | "power_30s",
  attempt_date: string,
  values: readonly number[],
): CardioTestAttemptInput {
  return protocol === "sprint_6s"
    ? {
        test_type: protocol,
        attempt_date,
        results: {
          peak_watts: [
            values[0]!,
            values[1]!,
            values[2]!,
            values[3]!,
            values[4]!,
          ],
        },
      }
    : {
        test_type: protocol,
        attempt_date,
        results: {
          efforts: [
            { peak_watts: values[0]!, average_watts: values[1]! },
            { peak_watts: values[2]!, average_watts: values[3]! },
          ],
        },
      };
}

export function powerTestValues(attempt: CardioTestAttempt): number[] {
  if (attempt.test_type === "sprint_6s") return attempt.results.peak_watts;
  if (attempt.test_type === "power_30s")
    return attempt.results.efforts.flatMap((effort) => [
      effort.peak_watts,
      effort.average_watts,
    ]);
  throw new Error("Expected a power Test Attempt");
}

export function sprintPowerResults(peaks: readonly number[]) {
  const maximum_watts = Math.max(...peaks);
  const drop_off_watts = maximum_watts - Math.min(...peaks);
  return {
    maximum_watts,
    drop_off_watts,
    drop_off_percent:
      maximum_watts === 0 ? 0 : (drop_off_watts / maximum_watts) * 100,
  };
}
