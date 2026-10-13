import type {
  WorkoutPlanAssignmentResponse,
  WorkoutPlanResponse,
  WorkoutPlanSessionResponse,
} from '@workspace/shared';

export type WorkoutPlanScheduleType = WorkoutPlanResponse['schedule_type'];
export type WorkoutPlanAssignment = WorkoutPlanAssignmentResponse;
export type WorkoutPlanSession = WorkoutPlanSessionResponse;
export type WorkoutPlanTemplate = WorkoutPlanResponse;
