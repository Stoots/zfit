import type {
  ExerciseSessionResponse,
  TrainingProgram,
} from '@workspace/shared';
import type {
  WorkoutPlanSession,
  WorkoutPlanTemplate,
} from '../types/workoutPlans';

/** Program bindings also remain startable when the reusable plan is inactive. */
export function getWorkoutPlanCandidates(
  activePlans: readonly WorkoutPlanTemplate[],
  libraryPlans: readonly WorkoutPlanTemplate[],
  programs: readonly TrainingProgram[]
): WorkoutPlanTemplate[] {
  const candidates = new Map(activePlans.map((plan) => [plan.id, plan]));
  const ownerBySession = new Map<string, string>();
  for (const program of programs) {
    for (const phase of program.phases) {
      for (const week of phase.weeks) {
        for (const planned of week.sessions) {
          ownerBySession.set(planned.workout_session_id, program.user_id);
        }
      }
    }
  }
  for (const plan of libraryPlans) {
    if (
      !candidates.has(plan.id) &&
      plan.sessions.some(
        (session) => ownerBySession.get(session.id) === plan.user_id
      )
    ) {
      candidates.set(plan.id, plan);
    }
  }
  return [...candidates.values()];
}

/** Assignment identity survives session labels, preset edits and diary reloads. */
export function getLoggedAssignmentIds(
  exerciseEntries: readonly ExerciseSessionResponse[]
): Set<string> {
  const ids = new Set<string>();
  for (const session of exerciseEntries) {
    if (
      'workout_plan_assignment_id' in session &&
      session.workout_plan_assignment_id != null
    ) {
      ids.add(String(session.workout_plan_assignment_id));
    }
    if ('exercises' in session) {
      for (const exercise of session.exercises) {
        if (exercise.workout_plan_assignment_id != null) {
          ids.add(String(exercise.workout_plan_assignment_id));
        }
      }
    }
  }
  return ids;
}

/** A session is logged only after every assignment has a diary link. */
export function getUncompletedActivePlans(
  plans: readonly WorkoutPlanTemplate[],
  loggedAssignmentIds: ReadonlySet<string>
): WorkoutPlanTemplate[] {
  return plans.flatMap((plan) => {
    const sessions = plan.sessions.filter(
      (session) =>
        !session.assignments.every((assignment) =>
          loggedAssignmentIds.has(String(assignment.id))
        )
    );
    if (sessions.length === 0) return [];
    const eligibleIds = new Set(sessions.map((session) => session.id));
    const nextAssignments = (plan.next_assignments ?? []).filter((assignment) =>
      eligibleIds.has(assignment.workout_session_id)
    );
    const nextSession =
      plan.next_session && eligibleIds.has(plan.next_session.id)
        ? plan.next_session
        : (sessions.find((session) =>
            nextAssignments.some(
              (assignment) => assignment.workout_session_id === session.id
            )
          ) ?? null);
    return [
      {
        ...plan,
        sessions,
        next_session: nextSession,
        next_assignments: nextAssignments,
      },
    ];
  });
}

/** The server's explicit due identities, never inferred from weekday/name/preset. */
export function getDuePlanSessions(
  plan: WorkoutPlanTemplate
): WorkoutPlanSession[] {
  const dueIds = new Set(
    (plan.next_assignments ?? []).map(
      (assignment) => assignment.workout_session_id
    )
  );
  if (plan.next_session) dueIds.add(plan.next_session.id);
  return plan.sessions
    .filter((session) => dueIds.has(session.id))
    .map((session) =>
      plan.next_session?.id === session.id ? plan.next_session : session
    );
}

export interface WatchScheduledWorkout {
  /** Opaque session UUID token carried by the existing native string protocol. */
  presetId: string;
  name: string;
  planName: string;
  caption: string;
}

export interface ScheduledWorkoutLabels {
  scheduledToday: string;
  optional?: string;
  sessionOf: (current: number, total: number) => string;
}

export function scheduledWorkoutsForWatch(
  plans: readonly WorkoutPlanTemplate[],
  exerciseEntries: readonly ExerciseSessionResponse[],
  labels: ScheduledWorkoutLabels
): WatchScheduledWorkout[] {
  const result: WatchScheduledWorkout[] = [];
  const seen = new Set<string>();
  for (const plan of getUncompletedActivePlans(
    plans,
    getLoggedAssignmentIds(exerciseEntries)
  )) {
    for (const session of getDuePlanSessions(plan)) {
      if (session.assignments.length === 0 || seen.has(session.id)) continue;
      seen.add(session.id);
      result.push({
        presetId: `session:${session.id}`,
        name: session.name,
        planName: plan.plan_name,
        caption: [
          session.is_optional ? (labels.optional ?? 'Optional') : null,
          plan.schedule_type === 'sequential'
            ? labels.sessionOf(
                plan.sequence_position?.current ?? 1,
                plan.sequence_position?.total ?? plan.sessions.length
              )
            : labels.scheduledToday,
        ]
          .filter(Boolean)
          .join(' · '),
      });
    }
  }
  return result;
}
