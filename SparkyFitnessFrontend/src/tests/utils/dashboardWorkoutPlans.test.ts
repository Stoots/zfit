import {
  selectDashboardWorkoutPlans,
  selectUpcomingDashboardWorkoutPlans,
  type TrainingProgram,
} from '@workspace/shared';
import type { WorkoutPlanTemplate } from '@/types/workout';

type Session =
  TrainingProgram['phases'][number]['weeks'][number]['sessions'][number];
const plan = (id: string): WorkoutPlanTemplate => ({
  id,
  user_id: 'athlete',
  plan_name: id,
  sessions: [
    {
      id: `workout-${id}`,
      name: 'A',
      day_of_week: null,
      is_optional: false,
      sort_order: 0,
      assignments: [
        {
          id: Number(id) * 10,
          exercise_id: 'exercise',
          sets: [
            { set_number: 1, reps: 8 },
            { set_number: 2, reps: 8 },
          ],
        },
      ],
    },
    {
      id: `later-${id}`,
      name: 'A',
      day_of_week: null,
      is_optional: false,
      sort_order: 1,
      assignments: [
        {
          id: Number(id) * 10 + 1,
          exercise_id: 'exercise',
          sets: [
            { set_number: 1, reps: 8 },
            { set_number: 2, reps: 8 },
            { set_number: 3, reps: 8 },
          ],
        },
      ],
    },
  ],
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
  workout_session_id: `workout-${planId}`,
  workout_session_name: 'A',
  cardio_test_type: null,
  is_optional: false,
  scheduled_date: scheduledDate,
  effective_date: date,
  status,
  sort_order: 0,
  outcome_at: null,
  completed_workout: null,
  completed_test_attempt: null,
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
  it('lists up to three pending sessions by effective date and authored order', () => {
    const selected = selectUpcomingDashboardWorkoutPlans(
      ['1', '2', '3', '4'].map(plan),
      [
        program([
          session(1, '2026-10-16'),
          session(2, '2026-10-15'),
          session(3, '2026-10-15'),
          session(4, '2026-10-17'),
        ]),
      ],
      3
    );
    expect(selected.programPlans.map((item) => item.id)).toEqual([
      '2',
      '3',
      '1',
    ]);
  });
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

  it('offers same-day optional sessions in authored order and skips omitted optionals', () => {
    const plans = ['1', '2'].map(plan);
    const sameDayOptional = {
      ...session(2, '2026-10-12'),
      is_optional: true,
    };
    const sameDay = selectDashboardWorkoutPlans(plans, [
      program([sameDayOptional, session(1, '2026-10-12')]),
    ]);
    expect(sameDay.programPlan?.id).toBe('2');
    expect(sameDay.programPlan?.training_program_session_id).toBe(
      sameDayOptional.id
    );

    const omitted = {
      ...session(2, '2026-10-10', 'omitted'),
      is_optional: true,
    };
    const afterOmission = selectDashboardWorkoutPlans(plans, [
      program([omitted, session(1, '2026-10-12')]),
    ]);
    expect(afterOmission.programPlan?.id).toBe('1');
  });

  it('keeps unrelated plans in their existing order', () => {
    const plans = ['9', '1', '8', '2', '3'].map(plan);
    const result = selectDashboardWorkoutPlans(plans, [
      program([session(2, '2026-10-12'), session(1, '2026-10-12')]),
      program([session(3, '2026-10-12')]),
    ]);
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

  it('clears a later preview when an earlier planned binding is unavailable', () => {
    const later = session(2, '2026-10-13');
    const missingPlan = session(1, '2026-10-12');
    const missingSession = {
      ...session(1, '2026-10-12'),
      workout_session_id: 'missing',
    };

    expect(
      selectDashboardWorkoutPlans([plan('2')], [program([later, missingPlan])])
        .programPlan
    ).toBeUndefined();
    expect(
      selectDashboardWorkoutPlans(
        [plan('1'), plan('2')],
        [program([later, missingSession])]
      ).programPlan
    ).toBeUndefined();
  });
  it('does not advance to a later Program date when the earliest binding is unavailable', () => {
    const programs = [
      program([
        session(1, '2026-10-12'),
        session(2, '2026-10-13'),
        session(3, '2026-10-14'),
      ]),
    ];
    const eligible = [plan('3')];
    const selected = selectDashboardWorkoutPlans(eligible, programs);
    expect(selected.programPlan).toBeUndefined();
    expect(selected.standalonePlans).toEqual([]);
    expect(selectDashboardWorkoutPlans([], programs)).toEqual({
      programPlan: undefined,
      standalonePlans: [],
    });
  });

  it('shows one exact Program session and keeps standalone plans separate', () => {
    const inactive = { ...plan('1'), is_active: false, next_session: null };
    const standalone = { ...plan('9'), is_active: true };
    const first = session(1, '2026-10-12');
    const later = {
      ...session(1, '2026-10-12'),
      id: 'planned-later',
      workout_session_id: 'later-1',
    };
    const selected = selectDashboardWorkoutPlans(
      [inactive, standalone],
      [program([first, later])]
    );

    expect(selected.programPlan?.id).toBe('1');
    expect(selected.programPlan?.training_program_session_id).toBe(first.id);
    expect(selected.programPlan?.next_session?.id).toBe('workout-1');
    expect(
      selected.programPlan?.next_assignments?.[0]?.sets.map((s) => s.reps)
    ).toEqual([8, 8]);
    expect(selected.standalonePlans.map((item) => item.id)).toEqual(['9']);
    expect(inactive.next_session).toBeNull();
  });

  it('does not advance past a missing earliest Program binding', () => {
    const source = plan('1');
    source.next_session = source.sessions[0];
    const later = plan('2');
    const unavailable = {
      ...session(1, '2026-10-12'),
      workout_session_id: 'missing',
    };
    const nextProgramSession = session(2, '2026-10-13');

    expect(
      selectDashboardWorkoutPlans(
        [source, later],
        [program([unavailable, nextProgramSession])]
      )
    ).toEqual({ programPlan: undefined, standalonePlans: [] });
  });
});
