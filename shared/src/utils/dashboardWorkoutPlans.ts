import type { TrainingProgram } from "../schemas/api/TrainingPrograms.api.zod.ts";

type CandidateSession = {
  id: string;
  assignments: unknown[];
};
type CandidatePlan = {
  id: string | number;
  sessions: CandidateSession[];
};
type ProgramPreview<T extends CandidatePlan> = T & {
  training_program_session_id: string;
  next_session: T['sessions'][number];
  next_assignments: T['sessions'][number]['assignments'];
  sequence_position: null;
};

export interface DashboardWorkoutPlans<T extends CandidatePlan> {
  /** The earliest pending Program workout, with exact session binding. */
  programPlan: ProgramPreview<T> | undefined;
  /** Eligible plans not referenced by any Program, in their existing order. */
  standalonePlans: T[];
}

/** Split eligible plans into the next pending Program workout and standalone
 * plans. Effective dates and authored traversal order determine precedence.
 * Program-linked plans never appear as standalone plans, even when their
 * sessions are finished. */
export function selectDashboardWorkoutPlans<T extends CandidatePlan>(
  eligiblePlans: readonly T[],
  programs: readonly TrainingProgram[]
): DashboardWorkoutPlans<T> {
  const byId = new Map(eligiblePlans.map((plan) => [String(plan.id), plan]));
  const linkedIds = new Set<string>();
  let programPlan: ProgramPreview<T> | undefined;
  let nextDate: string | undefined;
  for (const program of programs) {
    for (const phase of program.phases) {
      for (const week of phase.weeks) {
        for (const planned of week.sessions) {
          const planId = String(planned.workout_plan_id);
          linkedIds.add(planId);
          const plan = byId.get(planId);
          const session = plan?.sessions.find(
            (item) => item.id === planned.workout_session_id
          );
          if (planned.status !== 'planned') continue;
          if (nextDate !== undefined && planned.effective_date >= nextDate)
            continue;
          nextDate = planned.effective_date;
          programPlan = undefined;
          if (!plan || !session) continue;
          programPlan = {
            ...plan,
            training_program_session_id: planned.id,
            next_session: session,
            next_assignments: session.assignments,
            sequence_position: null,
          };
        }
      }
    }
  }
  return {
    programPlan,
    standalonePlans: eligiblePlans.filter(
      (plan) => !linkedIds.has(String(plan.id))
    ),
  };
}
