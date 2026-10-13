import type { PresetSessionResponse } from '@workspace/shared';
import { apiFetch } from './apiClient';
import type { WorkoutPlanTemplate } from '../../types/workoutPlans';
import { fetchTrainingPrograms } from './trainingProgramsApi';
import { getWorkoutPlanCandidates } from '../../utils/workoutPlanSchedule';

export const fetchActiveWorkoutPlans = async (
  date: string
): Promise<WorkoutPlanTemplate[]> => {
  const response = await apiFetch<WorkoutPlanTemplate[]>({
    endpoint: `/api/workout-plan-templates/active/${date}`,
    serviceName: 'Workout Plans API',
    operation: 'fetch active workout plans',
  });
  return response;
};

export const fetchWorkoutPlans = (): Promise<WorkoutPlanTemplate[]> =>
  apiFetch<WorkoutPlanTemplate[]>({
    endpoint: '/api/workout-plan-templates',
    serviceName: 'Workout Plans API',
    operation: 'fetch workout plan library',
  });

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
