import { apiCall } from '@/api/api';
import {
  workoutPlanCreateRequestSchema,
  workoutPlanUpdateRequestSchema,
} from '@workspace/shared';
import type { WorkoutPlanDraft, WorkoutPlanTemplate } from '@/types/workout';

// Persisted integers survive edits; client-only DnD IDs are not API identities.
function planPayload(plan: Partial<WorkoutPlanDraft>) {
  return {
    plan_name: plan.plan_name,
    description: plan.description,
    start_date: plan.start_date,
    end_date: plan.end_date,
    is_active: plan.is_active,
    schedule_type: plan.schedule_type,
    entry_mode: plan.entry_mode,
    sessions: plan.sessions?.map((session) => ({
      id: session.id,
      name: session.name,
      day_of_week: session.day_of_week,
      sort_order: session.sort_order,
      assignments: session.assignments.map((a) => ({
        id:
          a.id != null && /^\d+$/.test(String(a.id)) ? Number(a.id) : undefined,
        exercise_id: a.exercise_id,
        workout_preset_id:
          a.workout_preset_id != null ? Number(a.workout_preset_id) : undefined,
        sort_order: a.sort_order,
        sets: a.sets.map((set) => ({
          ...set,
          id:
            set.id != null && /^\d+$/.test(String(set.id))
              ? Number(set.id)
              : undefined,
        })),
        preset_snapshot: a.preset_snapshot
          ? {
              ...a.preset_snapshot,
              id: Number(a.preset_snapshot.id),
              description: a.preset_snapshot.description ?? null,
              workout_format: a.preset_snapshot.workout_format ?? 'standard',
              exercises: a.preset_snapshot.exercises.map((ex) => ({
                ...ex,
                id:
                  ex.id != null && /^\d+$/.test(String(ex.id))
                    ? Number(ex.id)
                    : undefined,
                image_url: ex.image_url ?? null,
                category: ex.category ?? null,
                superset_group: ex.superset_group ?? null,
                sets: ex.sets.map((set) => ({
                  ...set,
                  id:
                    set.id != null && /^\d+$/.test(String(set.id))
                      ? Number(set.id)
                      : undefined,
                })),
              })),
            }
          : undefined,
      })),
    })),
  };
}

export const getWorkoutPlanTemplates = async (): Promise<
  WorkoutPlanTemplate[]
> => {
  const data: WorkoutPlanTemplate[] = await apiCall('/workout-plan-templates', {
    method: 'GET',
  });
  return data.map((plan) => ({ ...plan, id: String(plan.id) }));
};

export const createWorkoutPlanTemplate = async (
  planData: WorkoutPlanDraft
): Promise<WorkoutPlanTemplate> => {
  const plan: WorkoutPlanTemplate = await apiCall('/workout-plan-templates', {
    method: 'POST',
    body: JSON.stringify(
      workoutPlanCreateRequestSchema.parse(planPayload(planData))
    ),
  });
  return { ...plan, id: String(plan.id) };
};

export const updateWorkoutPlanTemplate = async (
  id: string,
  planData: Partial<WorkoutPlanDraft>
): Promise<WorkoutPlanTemplate> => {
  const plan: WorkoutPlanTemplate = await apiCall(
    `/workout-plan-templates/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(
        workoutPlanUpdateRequestSchema.parse(planPayload(planData))
      ),
    }
  );
  return { ...plan, id: String(plan.id) };
};

export const deleteWorkoutPlanTemplate = async (
  id: string
): Promise<{ message: string }> =>
  apiCall(`/workout-plan-templates/${id}`, { method: 'DELETE' });

export const getActiveWorkoutPlans = async (
  date: string
): Promise<WorkoutPlanTemplate[]> => {
  const data: WorkoutPlanTemplate[] = await apiCall(
    `/workout-plan-templates/active/${date}`,
    { method: 'GET' }
  );
  return data.map((plan) => ({ ...plan, id: String(plan.id) }));
};
