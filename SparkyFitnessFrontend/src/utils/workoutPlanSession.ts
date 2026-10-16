import type {
  WorkoutPlanSession,
  WorkoutPlanTemplate,
  WorkoutPreset,
  WorkoutPresetExercise,
} from '@/types/workout';
import type { Exercise } from '@/types/exercises';
import { resolveWorkoutSessionTiming } from '@workspace/shared';

/** Resolve by UUID only. Labels, weekday, and standalone progression are not identity. */
export async function buildWorkoutPlanSessionPreset(
  plan: WorkoutPlanTemplate,
  sessionId: string,
  userId: string,
  fetchExercise: (id: string) => Promise<Exercise>
): Promise<WorkoutPreset> {
  const session: WorkoutPlanSession | undefined = plan.sessions.find(
    (item) => item.id === sessionId
  );
  if (!session)
    throw new Error(
      'The selected Workout Session is no longer available. Choose its exact replacement.'
    );
  const exercises: WorkoutPresetExercise[] = [];
  const assignments = [...session.assignments].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  for (const assignment of assignments) {
    if (assignment.preset_snapshot || assignment.workout_preset_id != null) {
      const snapshot = assignment.preset_snapshot;
      if (!snapshot)
        throw new Error(
          'This session is missing its frozen preset prescription. Reopen the plan to repair it.'
        );
      exercises.push(
        ...structuredClone(snapshot.exercises).map((ex) => ({
          ...ex,
          workout_plan_assignment_id: assignment.id ?? null,
        }))
      );
    } else if (assignment.exercise_id) {
      const exercise = await fetchExercise(assignment.exercise_id);
      exercises.push({
        id: String(assignment.id),
        exercise_id: assignment.exercise_id,
        exercise_name: assignment.exercise_name ?? exercise.name,
        exercise,
        category: assignment.category ?? exercise.category ?? undefined,
        modality: assignment.modality ?? exercise.modality,
        workout_plan_assignment_id: assignment.id ?? null,
        sets: structuredClone(assignment.sets),
      });
    }
  }
  if (exercises.length === 0)
    throw new Error(
      'No exercises are prescribed in the selected Workout Session.'
    );
  const timing = resolveWorkoutSessionTiming(
    assignments.flatMap((assignment) =>
      assignment.preset_snapshot ? [assignment.preset_snapshot] : []
    )
  );
  const snapshot =
    assignments.length === 1 ? assignments[0]?.preset_snapshot : null;
  return {
    id: `plan-${plan.id}-session-${session.id}`,
    user_id: userId,
    name: session.name,
    description: snapshot?.description ?? plan.description,
    workout_format: timing.workoutFormat,
    time_cap_seconds: timing.timeCapSeconds,
    workout_session_id: session.id,
    exercises,
  };
}
