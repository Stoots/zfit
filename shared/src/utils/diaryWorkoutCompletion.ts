interface DiaryExercise {
  is_weekly_prefill?: boolean;
  duration_minutes: number;
  sets: {
    completed_at?: string | Date | null;
    reps?: number | null;
    duration?: number | null;
    distance?: number | null;
  }[];
}

/** Manual/imported sets need work values; untouched prescriptions need a logged set. */
export function canLinkDiaryWorkout(
  workout:
    | ({ type: "individual" } & DiaryExercise)
    | { type: "preset"; exercises: DiaryExercise[] },
): boolean {
  const exercises = workout.type === "preset" ? workout.exercises : [workout];
  return exercises.some(
    (exercise) =>
      exercise.sets.some(
        (set) =>
          Boolean(set.completed_at) ||
          (!exercise.is_weekly_prefill &&
            ((set.reps ?? 0) > 0 ||
              (set.duration ?? 0) > 0 ||
              (set.distance ?? 0) > 0)),
      ) ||
      (workout.type === "individual" &&
        !exercise.is_weekly_prefill &&
        exercise.duration_minutes > 0),
  );
}
