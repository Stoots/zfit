import type { WorkoutFormat } from "../schemas/api/WorkoutPresets.api.zod.ts";

/** One session timer can represent frozen presets only when they agree. */
export function resolveWorkoutSessionTiming(
  snapshots: ReadonlyArray<{
    workout_format?: WorkoutFormat;
    time_cap_seconds?: number | null;
  }>,
): { workoutFormat: WorkoutFormat; timeCapSeconds: number | null } {
  const first = snapshots[0];
  const sameFormat = snapshots.every(
    (snapshot) => snapshot.workout_format === first?.workout_format,
  );
  const commonTimeCap = first?.time_cap_seconds ?? null;
  const sameTimeCap = snapshots.every(
    (snapshot) => (snapshot.time_cap_seconds ?? null) === commonTimeCap,
  );
  return {
    workoutFormat: sameFormat
      ? (first?.workout_format ?? "standard")
      : "standard",
    timeCapSeconds: sameFormat && sameTimeCap ? commonTimeCap : null,
  };
}
