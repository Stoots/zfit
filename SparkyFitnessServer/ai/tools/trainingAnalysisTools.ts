import { tool, type Tool } from 'ai';
import { z } from 'zod';
import {
  trainingAnalysisScopeSchema,
  type TrainingAnalysisScope,
} from '@workspace/shared';
import { getTrainingPrograms } from '../../models/trainingProgramRepository.js';
import workoutPlanTemplateRepository from '../../models/workoutPlanTemplateRepository.js';
import {
  readTrainingHealth,
  readTrainingAttempts,
} from '../../models/trainingAnalysisRepository.js';
import { ERRORS } from './errors.js';

export function buildTrainingAnalysisTools(
  userId: string,
  input: TrainingAnalysisScope
): Record<string, Tool> {
  const scope = trainingAnalysisScopeSchema.parse(input);
  const tools: Record<string, Tool> = {};
  if (scope.health_metrics.length)
    tools.sparky_read_training_health = tool({
      description:
        'Read only the Apple Health metrics and dates selected for this question. No syncing or changes. Units are included; missing records mean unavailable data.',
      inputSchema: z.strictObject({}),
      execute: async () => {
        try {
          return JSON.stringify(await readTrainingHealth(userId, scope));
        } catch (error) {
          return ERRORS.DB_ERROR(error);
        }
      },
    });
  if (scope.programs)
    tools.sparky_read_training_programs = tool({
      description:
        'Read selected Program history and exact Workout Session prescriptions. Omitted means an expired optional session, not a missed required session. Prescriptions describe the current reusable session, not necessarily what was performed. No changes.',
      inputSchema: z.strictObject({}),
      execute: async () => {
        try {
          const programs = await getTrainingPrograms(userId, scope.program_id);
          const rows = [];
          const plans = new Map<
            number,
            Awaited<
              ReturnType<
                typeof workoutPlanTemplateRepository.getWorkoutPlanTemplateById
              >
            >
          >();
          for (const program of programs) {
            for (const phase of program.phases) {
              for (const week of phase.weeks) {
                for (const session of week.sessions) {
                  if (
                    session.effective_date < scope.start_date ||
                    session.effective_date > scope.end_date
                  )
                    continue;
                  if (rows.length >= 500)
                    return JSON.stringify({ sessions: rows, truncated: true });
                  if (
                    session.workout_plan_id &&
                    !plans.has(session.workout_plan_id)
                  ) {
                    plans.set(
                      session.workout_plan_id,
                      await workoutPlanTemplateRepository.getWorkoutPlanTemplateById(
                        session.workout_plan_id,
                        userId
                      )
                    );
                  }
                  const prescription = session.workout_plan_id
                    ? plans
                        .get(session.workout_plan_id)
                        ?.sessions?.find(
                          (s) => s.id === session.workout_session_id
                        )
                    : undefined;
                  const attempt = session.completed_test_attempt;
                  const discloseAttemptResults =
                    attempt &&
                    scope.test_types.some(
                      (type) => type === attempt.test_type
                    ) &&
                    attempt.attempt_date >= scope.start_date &&
                    attempt.attempt_date <= scope.end_date;
                  rows.push({
                    program: {
                      id: program.id,
                      name: program.name,
                      goal: program.goal,
                    },
                    phase: { id: phase.id, name: phase.name, goal: phase.goal },
                    week_id: week.id,
                    id: session.id,
                    name: session.name,
                    scheduled_date: session.scheduled_date,
                    effective_date: session.effective_date,
                    status: session.status,
                    is_optional: session.is_optional,
                    outcome_at: session.outcome_at,
                    sort_order: session.sort_order,
                    workout_plan_id: session.workout_plan_id,
                    workout_plan_name: session.workout_plan_name,
                    workout_session_id: session.workout_session_id,
                    workout_session_name: session.workout_session_name,
                    cardio_test_type: session.cardio_test_type,
                    completed_workout: session.completed_workout,
                    completed_test_attempt: attempt
                      ? {
                          id: attempt.id,
                          test_type: attempt.test_type,
                          attempt_date: attempt.attempt_date,
                          ...(discloseAttemptResults
                            ? { results: attempt.results }
                            : {}),
                        }
                      : null,
                    prescription: prescription ?? null,
                  });
                }
              }
            }
          }
          return JSON.stringify({ sessions: rows, truncated: false });
        } catch (error) {
          return ERRORS.DB_ERROR(error);
        }
      },
    });
  if (scope.test_types.length)
    tools.sparky_read_cardio_tests = tool({
      description:
        'Read selected canonical Cardio Test Attempts (Cooper, sprint, 30-second power, ramp), dates, protocol results and optional Planned Session links. No changes.',
      inputSchema: z.strictObject({}),
      execute: async () => {
        try {
          return JSON.stringify(await readTrainingAttempts(userId, scope));
        } catch (error) {
          return ERRORS.DB_ERROR(error);
        }
      },
    });
  return tools;
}
