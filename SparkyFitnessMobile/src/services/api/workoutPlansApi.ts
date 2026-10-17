import type {
  WorkoutPlanCreateRequest,
  WorkoutPlanSessionInput,
  PresetSessionResponse,
} from '@workspace/shared';
import { apiFetch } from './apiClient';
import type { WorkoutPlanTemplate } from '../../types/workoutPlans';
import { fetchTrainingPrograms } from './trainingProgramsApi';
import { getWorkoutPlanCandidates } from '../../utils/workoutPlanSchedule';
import type { SaveWorkoutPlanPayload } from '../../types/workoutPlans';

const SERVICE_NAME = 'Workout Plans API';

export const fetchActiveWorkoutPlans = async (
  date: string
): Promise<WorkoutPlanTemplate[]> => {
  const response = await apiFetch<WorkoutPlanTemplate[]>({
    endpoint: `/api/workout-plan-templates/active/${date}`,
    serviceName: SERVICE_NAME,
    operation: 'fetch active workout plans',
  });
  return response;
};

/** Fresh exact candidates for queued watch starts, including inactive bindings. */
export const fetchWorkoutPlanCandidates = async (date: string) => {
  const [activePlans, libraryPlans, programs] = await Promise.all([
    fetchActiveWorkoutPlans(date),
    fetchWorkoutPlans(),
    fetchTrainingPrograms(),
  ]);
  return getWorkoutPlanCandidates(activePlans, libraryPlans, programs);
};

/** Server materializes only this UUID's local prescriptions in one transaction. */
export const startWorkoutPlanSession = async (
  workoutSessionId: string,
  entryDate: string
): Promise<PresetSessionResponse> => {
  const response = await apiFetch<{
    workout_session_id: string;
    workout_session_name: string;
    session: PresetSessionResponse;
  }>({
    endpoint: `/api/workout-plan-templates/sessions/${encodeURIComponent(workoutSessionId)}/start`,
    method: 'POST',
    body: { entry_date: entryDate },
    serviceName: 'Workout Plans API',
    operation: 'start exact workout session',
  });
  return response.session;
};

export const fetchWorkoutPlans = async (): Promise<WorkoutPlanTemplate[]> => {
  const response = await apiFetch<WorkoutPlanTemplate[] | null>({
    endpoint: '/api/workout-plan-templates',
    serviceName: SERVICE_NAME,
    operation: 'fetch workout plans',
  });
  return (response ?? []).map(withLegacyAssignments);
};

/** Keep the native flat form compatible with the server's exact session contract. */
export function withLegacyAssignments(
  plan: WorkoutPlanTemplate
): WorkoutPlanTemplate {
  return {
    ...plan,
    assignments: plan.sessions.flatMap((session, index) =>
      session.assignments.map((assignment) => ({
        ...assignment,
        day_of_week: session.day_of_week,
        session_index: plan.schedule_type === 'sequential' ? index + 1 : null,
        session_name: session.name,
      }))
    ),
  };
}

export function sessionPlanPayload(
  payload: SaveWorkoutPlanPayload,
  existing?: WorkoutPlanTemplate
): WorkoutPlanCreateRequest {
  const { assignments, ...fields } = payload;
  const sessions = new Map<string, WorkoutPlanSessionInput>();
  for (const assignment of assignments) {
    const oldSession = existing?.sessions.find((session) =>
      session.assignments.some((saved) => saved.id === Number(assignment.id))
    );
    const key =
      oldSession?.id ??
      String(
        payload.schedule_type === 'weekly'
          ? assignment.day_of_week
          : assignment.session_index
      );
    let session = sessions.get(key);
    if (!session) {
      session = {
        id: oldSession?.id,
        name:
          assignment.session_name ||
          oldSession?.name ||
          `Session ${sessions.size + 1}`,
        day_of_week:
          payload.schedule_type === 'weekly' ? assignment.day_of_week : null,
        sort_order: sessions.size,
        is_optional: oldSession?.is_optional ?? false,
        assignments: [],
      };
      sessions.set(key, session);
    }
    const oldAssignment = oldSession?.assignments.find(
      (saved) => saved.id === Number(assignment.id)
    );
    session.assignments.push({
      id: assignment.id ? Number(assignment.id) : undefined,
      exercise_id: assignment.exercise_id,
      workout_preset_id: assignment.workout_preset_id
        ? Number(assignment.workout_preset_id)
        : undefined,
      preset_snapshot: oldAssignment?.preset_snapshot ?? undefined,
      sort_order: session.assignments.length,
      sets: assignment.sets.map((set) => ({ ...set })),
    });
  }
  // Empty saved sessions have stable identities and may be bound to Programs.
  for (const session of existing?.sessions ?? []) {
    if (!session.assignments.length && !sessions.has(session.id))
      sessions.set(session.id, { ...session, assignments: [] });
  }
  return { ...fields, sessions: [...sessions.values()] };
}

export const createWorkoutPlan = async (
  payload: SaveWorkoutPlanPayload,
  currentClientDate: string
): Promise<WorkoutPlanTemplate> =>
  withLegacyAssignments(
    await apiFetch<WorkoutPlanTemplate>({
      endpoint: '/api/workout-plan-templates',
      serviceName: SERVICE_NAME,
      operation: 'create workout plan',
      method: 'POST',
      body: { ...sessionPlanPayload(payload), currentClientDate },
    })
  );

export const updateWorkoutPlan = async (
  id: string,
  payload: SaveWorkoutPlanPayload,
  currentClientDate: string
): Promise<WorkoutPlanTemplate> => {
  const existing = await apiFetch<WorkoutPlanTemplate>({
    endpoint: `/api/workout-plan-templates/${id}`,
    serviceName: SERVICE_NAME,
    operation: 'read workout plan sessions',
  });
  return withLegacyAssignments(
    await apiFetch<WorkoutPlanTemplate>({
      endpoint: `/api/workout-plan-templates/${id}`,
      serviceName: SERVICE_NAME,
      operation: 'update workout plan',
      method: 'PUT',
      body: { ...sessionPlanPayload(payload, existing), currentClientDate },
    })
  );
};

export const deleteWorkoutPlan = async (id: string): Promise<void> =>
  apiFetch<void>({
    endpoint: `/api/workout-plan-templates/${id}`,
    serviceName: SERVICE_NAME,
    operation: 'delete workout plan',
    method: 'DELETE',
  });
