import type { TrainingProgram } from "../schemas/api/TrainingPrograms.api.zod.ts";

export interface DashboardWorkoutPlans<T> {
  /** The plan behind the next pending Program session, if any is eligible. */
  programPlan: T | undefined;
  /** Eligible plans not referenced by any Program, in their existing order. */
  standalonePlans: T[];
}

/** Split already-eligible active plans into one next Program workout and the
 * standalone plans. Effective dates and authored traversal order determine
 * Program precedence; callers retain responsibility for progression and diary
 * completion filtering. Program-linked plans never appear as standalone plans,
 * even when their Program sessions are finished. */
export function selectDashboardWorkoutPlans<T extends { id: string | number }>(
  eligiblePlans: readonly T[],
  programs: readonly TrainingProgram[],
): DashboardWorkoutPlans<T> {
  const byId = new Map(eligiblePlans.map((plan) => [String(plan.id), plan]));
  const linkedIds = new Set<string>();
  let programPlan: T | undefined;
  let nextDate: string | undefined;
  for (const program of programs) {
    for (const phase of program.phases) {
      for (const week of phase.weeks) {
        for (const session of week.sessions) {
          const id = String(session.workout_plan_id);
          linkedIds.add(id);
          const plan = byId.get(id);
          if (
            plan &&
            session.status === "planned" &&
            (nextDate === undefined || session.effective_date < nextDate)
          ) {
            programPlan = plan;
            nextDate = session.effective_date;
          }
        }
      }
    }
  }
  return {
    programPlan,
    standalonePlans: eligiblePlans.filter(
      (plan) => !linkedIds.has(String(plan.id)),
    ),
  };
}
