import {
  compatiblePlanCreateSchema,
  compatiblePlanUpdateSchema,
  type CompatiblePlanCreate,
  type CompatiblePlanUpdate,
} from '../schemas/workoutPlanCompatibility.js';
import {
  type WorkoutPlanCreateRequest,
  type WorkoutPlanUpdateRequest,
  type WorkoutPlanBulkRequest,
  type WorkoutPlanBulkApplyRequest,
} from '@workspace/shared';
import workoutPlanTemplateRepository, {
  type WorkoutPlanTemplateRow,
} from '../models/workoutPlanTemplateRepository.js';
import { log } from '../config/logging.js';
import { HttpError } from '../utils/errors.js';
import { resolveTemplateStartDay } from '../utils/timezoneLoader.js';

export type {
  WorkoutPlanAssignmentSetInput,
  WorkoutPlanAssignmentInput,
  WorkoutPlanSessionInput,
} from '@workspace/shared';
export type CreateWorkoutPlanTemplateInput = WorkoutPlanCreateRequest;
export type UpdateWorkoutPlanTemplateInput = WorkoutPlanUpdateRequest;

async function createWorkoutPlanTemplate(
  userId: string,
  planData: CompatiblePlanCreate
) {
  const parsed = compatiblePlanCreateSchema.safeParse(planData);
  if (!parsed.success)
    throw Object.assign(new Error(parsed.error.message), { status: 400 });
  const input = parsed.data;
  const scheduleType = input.schedule_type ?? 'sequential';
  const today = await resolveTemplateStartDay(userId, input.currentClientDate);
  return withLegacyAssignments(
    await workoutPlanTemplateRepository.createWorkoutPlanTemplate(
      {
        ...input,
        start_date: input.start_date === undefined ? today : input.start_date,
        schedule_type: scheduleType,
        entry_mode:
          scheduleType === 'sequential'
            ? 'prompt'
            : (input.entry_mode ?? 'prompt'),
        user_id: userId,
      },
      today
    )
  );
}
async function getWorkoutPlanTemplatesByUserId(userId: string) {
  const plans =
    await workoutPlanTemplateRepository.getWorkoutPlanTemplatesByUserId(userId);
  return plans.map(withLegacyAssignments);
}
async function getWorkoutPlanTemplateById(
  userId: string,
  templateId: string | number
) {
  // Read access follows the existing shared library RLS boundary.
  const plan = await workoutPlanTemplateRepository.getWorkoutPlanTemplateById(
    templateId,
    userId
  );
  if (!plan)
    throw Object.assign(new Error('Workout plan template not found.'), {
      status: 404,
    });
  return withLegacyAssignments(plan);
}
async function updateWorkoutPlanTemplate(
  userId: string,
  templateId: string | number,
  updateData: CompatiblePlanUpdate
) {
  const parsed = compatiblePlanUpdateSchema.safeParse(updateData);
  if (!parsed.success)
    throw Object.assign(new Error(parsed.error.message), { status: 400 });
  const ownerId =
    await workoutPlanTemplateRepository.getWorkoutPlanTemplateOwnerId(
      templateId,
      userId
    );
  if (!ownerId)
    throw Object.assign(new Error('Workout plan template not found.'), {
      status: 404,
    });
  if (ownerId !== userId)
    throw Object.assign(
      new Error(
        'Forbidden: You do not have permission to update this workout plan template.'
      ),
      { status: 403 }
    );
  // Identity checks, disposable prefill cleanup and idempotent insertion
  // share one repository transaction.
  return withLegacyAssignments(
    await workoutPlanTemplateRepository.updateWorkoutPlanTemplate(
      templateId,
      userId,
      parsed.data,
      parsed.data.currentClientDate
    )
  );
}
async function deleteWorkoutPlanTemplate(
  userId: string,
  templateId: string | number
) {
  const ownerId =
    await workoutPlanTemplateRepository.getWorkoutPlanTemplateOwnerId(
      templateId,
      userId
    );
  if (!ownerId)
    throw Object.assign(new Error('Workout plan template not found.'), {
      status: 404,
    });
  if (ownerId !== userId)
    throw Object.assign(
      new Error(
        'Forbidden: You do not have permission to delete this workout plan template.'
      ),
      { status: 403 }
    );
  try {
    const deleted =
      await workoutPlanTemplateRepository.deleteWorkoutPlanTemplate(
        templateId,
        userId
      );
    if (!deleted) {
      throw new Error(
        'Workout plan template not found or could not be deleted.'
      );
    }
    log('info', `Workout plan template ${templateId} deleted successfully.`);
    return { message: 'Workout plan template deleted successfully.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(
      'error',
      `Error deleting workout plan template ${templateId} for user ${userId}: ${message}`,
      error
    );
    // Expected conflicts (e.g. a plan still used by a Training Program) carry
    // a client-safe message and status; anything else may be a raw database
    // error, so it is wrapped before it can reach the API response.
    if (error instanceof HttpError) throw error;
    throw new Error('Failed to delete workout plan template.', {
      cause: error,
    });
  }
}
function withLegacyAssignments(plan: WorkoutPlanTemplateRow) {
  let sessionIndex = 0;
  for (const session of plan.sessions) {
    if (session.assignments.length > 0) sessionIndex++;
    for (const assignment of session.assignments) {
      // Keep the session model authoritative while serving the upstream app.
      assignment.template_id = plan.id;
      assignment.day_of_week = session.day_of_week;
      assignment.session_index =
        plan.schedule_type === 'sequential' ? sessionIndex : null;
      assignment.session_name = session.name;
    }
  }
  plan.assignments = plan.sessions.flatMap((session) => session.assignments);
  plan.next_assignment = plan.next_assignments?.[0] ?? null;
  return plan;
}
async function getActiveWorkoutPlanForDate(userId: string, date: string) {
  const plans = await workoutPlanTemplateRepository.getActiveWorkoutPlanForDate(
    userId,
    date
  );
  return plans.map(withLegacyAssignments);
}
async function getBulkPrescriptionCandidates(
  userId: string,
  actor: string,
  planId: number,
  programId: string | null
) {
  return workoutPlanTemplateRepository.getBulkPrescriptionCandidates(
    userId,
    actor,
    planId,
    programId
  );
}
async function previewBulkPrescriptions(
  userId: string,
  actor: string,
  request: WorkoutPlanBulkRequest
) {
  return workoutPlanTemplateRepository.previewBulkPrescriptions(
    userId,
    actor,
    request
  );
}
async function applyBulkPrescriptions(
  userId: string,
  actor: string,
  request: WorkoutPlanBulkApplyRequest
) {
  return workoutPlanTemplateRepository.applyBulkPrescriptions(
    userId,
    actor,
    request
  );
}
export {
  createWorkoutPlanTemplate,
  getWorkoutPlanTemplatesByUserId,
  getWorkoutPlanTemplateById,
  updateWorkoutPlanTemplate,
  deleteWorkoutPlanTemplate,
  getActiveWorkoutPlanForDate,
  getBulkPrescriptionCandidates,
  previewBulkPrescriptions,
  applyBulkPrescriptions,
};
export default {
  createWorkoutPlanTemplate,
  getWorkoutPlanTemplatesByUserId,
  getWorkoutPlanTemplateById,
  updateWorkoutPlanTemplate,
  deleteWorkoutPlanTemplate,
  getActiveWorkoutPlanForDate,
  getBulkPrescriptionCandidates,
  previewBulkPrescriptions,
  applyBulkPrescriptions,
};
