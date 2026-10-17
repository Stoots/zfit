import { useQuery, useQueryClient } from '@tanstack/react-query';
import { exerciseByIdOptions } from './useExercises';
import { buildWorkoutPlanSessionPreset } from '@/utils/workoutPlanSession';
import type { WorkoutPlanSession, WorkoutPlanTemplate } from '@/types/workout';

export interface WorkoutSessionPreviewTarget {
  plan: WorkoutPlanTemplate;
  session: WorkoutPlanSession;
  userId: string;
}

export function useWorkoutSessionPreview(
  workout: WorkoutSessionPreviewTarget | undefined,
  enabled: boolean
) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: [
      'workoutPlanTemplates',
      'preview',
      workout?.userId,
      workout?.session.id,
      workout?.session.assignments,
    ],
    enabled: enabled && !!workout,
    retry: false,
    queryFn: async () => {
      if (
        !workout ||
        !workout.session.assignments.some((a) =>
          a.preset_snapshot
            ? a.preset_snapshot.exercises.length
            : a.exercise_id || a.workout_preset_id
        )
      )
        return null;
      return buildWorkoutPlanSessionPreset(
        workout.plan,
        workout.session.id,
        workout.userId,
        (id) => queryClient.fetchQuery(exerciseByIdOptions(id))
      );
    },
  });
}
