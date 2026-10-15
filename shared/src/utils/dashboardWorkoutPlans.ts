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
  next_session: T["sessions"][number];
  next_assignments: T["sessions"][number]["assignments"];
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
  programs: readonly TrainingProgram[],
): DashboardWorkoutPlans<T> {
  const selected = selectUpcomingDashboardWorkoutPlans(
    eligiblePlans,
    programs,
    1,
  );
  return {
    programPlan: selected.programPlans[0],
    standalonePlans: selected.standalonePlans,
  };
}

/** List upcoming Program sessions while preserving the single-preview selector
 * used by mobile and other callers. */
export function selectUpcomingDashboardWorkoutPlans<T extends CandidatePlan>(
  eligiblePlans: readonly T[],
  programs: readonly TrainingProgram[],
  limit: number,
): { programPlans: ProgramPreview<T>[]; standalonePlans: T[] } {
  const byId = new Map(eligiblePlans.map((plan) => [String(plan.id), plan]));
  const linkedIds = new Set<string>();
  const pending: TrainingProgram["phases"][number]["weeks"][number]["sessions"][number][] =
    [];
  for (const program of programs) {
    for (const phase of program.phases) {
      for (const week of phase.weeks) {
        for (const planned of week.sessions) {
          if (!planned.workout_session_id || planned.workout_plan_id === null)
            continue;
          const planId = String(planned.workout_plan_id);
          linkedIds.add(planId);
          if (planned.status === "planned") pending.push(planned);
        }
      }
    }
  }
  pending.sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  const programPlans: ProgramPreview<T>[] = [];
  for (const planned of pending) {
    if (programPlans.length >= limit) break;
    const plan = byId.get(String(planned.workout_plan_id));
    const session = plan?.sessions.find(
      (item) => item.id === planned.workout_session_id,
    );
    if (!plan || !session) {
      if (programPlans.length === 0) break;
      continue;
    }
    programPlans.push({
      ...plan,
      training_program_session_id: planned.id,
      next_session: session,
      next_assignments: session.assignments,
      sequence_position: null,
    });
  }
  return {
    programPlans,
    standalonePlans: eligiblePlans.filter(
      (plan) => !linkedIds.has(String(plan.id)),
    ),
  };
}
