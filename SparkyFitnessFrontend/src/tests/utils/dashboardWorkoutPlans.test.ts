import {
  selectDashboardWorkoutPlans,
  type TrainingProgram,
} from '@workspace/shared';
import type { WorkoutPlanTemplate } from '@/types/workout';

type Session =
  TrainingProgram['phases'][number]['weeks'][number]['sessions'][number];
const plan = (id: string): WorkoutPlanTemplate => ({
  id,
  user_id: 'athlete',
  plan_name: id,
});
const session = (
  planId: number,
  date: string,
  status: Session['status'] = 'planned',
  scheduledDate = date
): Session => ({
  id: `session-${planId}-${date}`,
  name: `Session ${planId}`,
  workout_plan_id: planId,
  workout_plan_name: String(planId),
  scheduled_date: scheduledDate,
  effective_date: date,
  status,
  sort_order: 0,
  outcome_at: null,
  completed_workout: null,
});
const ids = (
  result: ReturnType<typeof selectDashboardWorkoutPlans<WorkoutPlanTemplate>>
) => [
  ...(result.programPlan ? [result.programPlan.id] : []),
  ...result.standalonePlans.map((p) => p.id),
];
const program = (sessions: Session[]): TrainingProgram =>
  ({
    phases: [{ weeks: [{ sessions }] }],
  }) as TrainingProgram;

describe('dashboard next workout selection', () => {
  it('shows only the earliest program workout, not all plans or creation order', () => {
    const plans = ['1', '3', '5', '2', '4', '6'].map(plan);
    const programs = [
      program([
        session(1, '2026-10-15'),
        session(2, '2026-10-12'),
        session(3, '2026-10-17'),
        session(4, '2026-10-19'),
        session(5, '2026-10-20'),
        session(6, '2026-10-21'),
      ]),
    ];
    expect(ids(selectDashboardWorkoutPlans(plans, programs))).toEqual(['2']);
    expect(plans.map((p) => p.id)).toEqual(['1', '3', '5', '2', '4', '6']);
  });

  it('uses pending effective dates across programs, including auto-shifts and repeated plans', () => {
    const programs = [
      program([
        session(1, '2026-10-12', 'completed'),
        session(1, '2026-10-20'),
        session(2, '2026-10-17', 'planned', '2026-10-13'),
      ]),
      program([session(3, '2026-10-14', 'missed'), session(3, '2026-10-18')]),
    ];
    expect(
      ids(selectDashboardWorkoutPlans(['1', '2', '3'].map(plan), programs))
    ).toEqual(['2']);
  });

  it('keeps authored same-day precedence and unrelated plans in their existing order', () => {
    const plans = ['9', '1', '8', '2', '3'].map(plan);
    const programs = [
      program([session(2, '2026-10-12'), session(1, '2026-10-12')]),
      program([session(3, '2026-10-12')]),
    ];
    const result = selectDashboardWorkoutPlans(plans, programs);
    expect(result.programPlan?.id).toBe('2');
    expect(result.standalonePlans.map((p) => p.id)).toEqual(['9', '8']);
    expect(selectDashboardWorkoutPlans(plans, [])).toEqual({
      programPlan: undefined,
      standalonePlans: plans,
    });
  });

  it('does not treat finished program plans as standalone workouts', () => {
    const programs = [
      program([
        session(1, '2026-10-12', 'completed'),
        session(2, '2026-10-13', 'missed'),
      ]),
    ];
    expect(
      ids(selectDashboardWorkoutPlans(['1', '2', '9'].map(plan), programs))
    ).toEqual(['9']);
  });

  it('selects from eligible plans without inventing advancement or reactivating unavailable workouts', () => {
    const programs = [
      program([
        session(1, '2026-10-12'),
        session(2, '2026-10-13'),
        session(3, '2026-10-14'),
      ]),
    ];
    const eligible = [plan('3')];
    expect(selectDashboardWorkoutPlans(eligible, programs)).toEqual({
      programPlan: eligible[0],
      standalonePlans: [],
    });
    expect(selectDashboardWorkoutPlans([], programs)).toEqual({
      programPlan: undefined,
      standalonePlans: [],
    });
  });
});
