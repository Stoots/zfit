import type {
  ExerciseEntrySetRequest,
  PresetSessionExerciseRequest,
  WorkoutPlanAssignmentSetInput,
} from '@workspace/shared';
import type { StartLiveWorkoutArgs } from '../hooks/useStartLiveWorkout';
import type { WorkoutPlanSession } from '../types/workoutPlans';
import { liveExerciseConfigFromPreset } from './workoutSession';

/** Copy prescriptions without inventing loads, defaults, or replacing nulls. */
function startSet(set: WorkoutPlanAssignmentSetInput): ExerciseEntrySetRequest {
  const effort = set as WorkoutPlanAssignmentSetInput & {
    rpe?: number | null;
    rir?: number | null;
  };
  return {
    set_number: set.set_number,
    set_type: set.set_type ?? null,
    reps: set.reps ?? null,
    weight: set.weight ?? null,
    duration: set.duration ?? null,
    distance: set.distance ?? null,
    rest_time: set.rest_time ?? null,
    notes: set.notes ?? null,
    rpe: effort.rpe ?? null,
    rir: effort.rir ?? null,
    completed_at: null,
  };
}

/** Exact session execution. Library presets are deliberately not inputs. */
export function buildWorkoutPlanSessionStart(
  session: WorkoutPlanSession
): StartLiveWorkoutArgs {
  const exercises: PresetSessionExerciseRequest[] = [];
  const exerciseConfigs: NonNullable<StartLiveWorkoutArgs['exerciseConfigs']> =
    [];
  const assignments = [...session.assignments].sort(
    (a, b) => a.sort_order - b.sort_order
  );
  for (const assignment of assignments) {
    if (assignment.workout_session_id !== session.id) {
      throw new Error(
        'Assignment does not belong to the selected workout session.'
      );
    }
    if (
      assignment.preset_snapshot != null ||
      assignment.workout_preset_id != null
    ) {
      const snapshot = assignment.preset_snapshot;
      if (
        !snapshot ||
        (assignment.workout_preset_id != null &&
          snapshot.id !== assignment.workout_preset_id)
      ) {
        throw new Error(
          'The selected workout session has no frozen preset prescription.'
        );
      }
      for (const exercise of snapshot.exercises) {
        exerciseConfigs.push(liveExerciseConfigFromPreset(exercise));
        exercises.push({
          exercise_id: exercise.exercise_id,
          sort_order: exercises.length,
          duration_minutes: 0,
          notes: typeof exercise.notes === 'string' ? exercise.notes : null,
          superset_group: exercise.superset_group ?? null,
          progression_mode: exercise.progression_mode ?? null,
          rep_goal: exercise.rep_goal ?? null,
          increment_type: exercise.increment_type ?? null,
          increment_value: exercise.increment_value ?? null,
          equipment_brand: exercise.equipment_brand ?? null,
          workout_plan_assignment_id: assignment.id,
          sets: exercise.sets.map(startSet),
        });
      }
    } else if (assignment.exercise_id != null) {
      exerciseConfigs.push(liveExerciseConfigFromPreset({}));
      exercises.push({
        exercise_id: assignment.exercise_id,
        sort_order: exercises.length,
        duration_minutes: 0,
        notes: null,
        superset_group: null,
        workout_plan_assignment_id: assignment.id,
        sets: assignment.sets.map(startSet),
      });
    }
  }
  const presetSnapshots = assignments.flatMap((assignment) =>
    assignment.preset_snapshot ? [assignment.preset_snapshot] : []
  );
  const onlyPreset = presetSnapshots[0];
  const sameFormat = presetSnapshots.every(
    (snapshot) => snapshot.workout_format === onlyPreset?.workout_format
  );
  const commonTimeCap = onlyPreset?.time_cap_seconds ?? null;
  const sameTimeCap = presetSnapshots.every(
    (snapshot) => (snapshot.time_cap_seconds ?? null) === commonTimeCap
  );
  return {
    workoutSessionId: session.id,
    name: session.name,
    exercises,
    exerciseConfigs,
    workoutPlanAssignmentId: assignments[0]?.id,
    workoutFormat: sameFormat
      ? (onlyPreset?.workout_format ?? 'standard')
      : 'standard',
    timeCapSeconds: sameFormat && sameTimeCap ? commonTimeCap : null,
  };
}
