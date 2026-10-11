import {
  selectDashboardWorkoutPlans,
  type ExerciseSessionResponse,
  type TrainingProgram,
} from '@workspace/shared';
import type {
  WorkoutPlanSession,
  WorkoutPlanTemplate,
} from '../../src/types/workoutPlans';
import {
  getWorkoutPlanCandidates,
  getDuePlanSessions,
  getLoggedAssignmentIds,
  scheduledWorkoutsForWatch,
} from '../../src/utils/workoutPlanSchedule';

const labels = {
  scheduledToday: 'Scheduled Today',
  sessionOf: (current: number, total: number) =>
    `Session ${current} of ${total}`,
};
const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
function session(id: string, assignmentId: number): WorkoutPlanSession {
  // Scheduling does not inspect unused audit/snapshot fields.
  return {
    id,
    name: 'A',
    day_of_week: 1,
    sort_order: assignmentId,
    assignments: [
      {
        id: assignmentId,
        workout_session_id: id,
        sort_order: 0,
        workout_preset_id: 42,
        sets: [],
      },
    ],
  } as unknown as WorkoutPlanSession;
}
const a = session(firstId, 1);
const b = session(secondId, 2);
function plan(
  overrides: Partial<WorkoutPlanTemplate> = {}
): WorkoutPlanTemplate {
  return {
    id: 1,
    user_id: 'user-1',
    plan_name: 'main',
    start_date: '2026-10-01',
    is_active: true,
    schedule_type: 'weekly',
    sessions: [a, b],
    next_session: a,
    next_assignments: [...a.assignments, ...b.assignments],
    ...overrides,
  } as WorkoutPlanTemplate;
}

it('offers both exact weekly sessions despite identical labels and library preset IDs', () => {
  const rows = [
    plan({ next_session: a, next_assignments: a.assignments }),
    plan({ next_session: b, next_assignments: b.assignments }),
  ];
  expect(
    rows.flatMap((row) => getDuePlanSessions(row)).map(({ id }) => id)
  ).toEqual([firstId, secondId]);
  expect(scheduledWorkoutsForWatch(rows, [], labels)).toEqual([
    {
      presetId: `session:${firstId}`,
      name: 'A',
      planName: 'main',
      caption: 'Scheduled Today',
    },
    {
      presetId: `session:${secondId}`,
      name: 'A',
      planName: 'main',
      caption: 'Scheduled Today',
    },
  ]);
});

it('offers only the exact current sequential session', () => {
  const sequential = plan({
    schedule_type: 'sequential',
    next_session: b,
    next_assignments: b.assignments,
    sequence_position: { current: 2, total: 2 },
  });
  expect(getDuePlanSessions(sequential)).toEqual([b]);
  expect(scheduledWorkoutsForWatch([sequential], [], labels)).toEqual([
    {
      presetId: `session:${secondId}`,
      name: 'A',
      planName: 'main',
      caption: 'Session 2 of 2',
    },
  ]);
});

it('does not suppress a second exact session when the first was completed', () => {
  const entries = [
    { id: 9, exercises: [{ workout_plan_assignment_id: 1 }] },
  ] as unknown as ExerciseSessionResponse[];
  expect(
    scheduledWorkoutsForWatch([plan()], entries, labels).map(
      ({ presetId }) => presetId
    )
  ).toEqual([`session:${secondId}`]);
});

it('keeps a partially logged session visible until every distinct assignment is linked', () => {
  const combined = {
    ...a,
    assignments: [
      a.assignments[0]!,
      { ...a.assignments[0]!, id: 3, sort_order: 1 },
    ],
  };
  const selected = plan({
    sessions: [combined],
    next_session: combined,
    next_assignments: combined.assignments,
  });
  const partial = [
    {
      exercises: [
        { workout_plan_assignment_id: 1, sets: [{ completed_at: null }] },
        { workout_plan_assignment_id: 1, sets: [{ completed_at: null }] },
      ],
    },
  ] as unknown as ExerciseSessionResponse[];
  expect(
    scheduledWorkoutsForWatch([selected], partial, labels).map(
      (row) => row.presetId
    )
  ).toEqual([`session:${firstId}`]);
  const all = [
    ...partial,
    {
      exercises: [
        { workout_plan_assignment_id: 3, sets: [{ completed_at: null }] },
      ],
    },
  ] as unknown as ExerciseSessionResponse[];
  expect(scheduledWorkoutsForWatch([selected], all, labels)).toEqual([]);
});

it('supports exact sessions containing individual exercises rather than library presets', () => {
  const single = {
    ...a,
    assignments: [
      { ...a.assignments[0]!, workout_preset_id: null, exercise_id: 'ex-1' },
    ],
  } as WorkoutPlanSession;
  expect(
    scheduledWorkoutsForWatch(
      [
        plan({
          sessions: [single],
          next_session: single,
          next_assignments: single.assignments,
        }),
      ],
      [],
      labels
    )
  ).toEqual([
    {
      presetId: `session:${firstId}`,
      name: 'A',
      planName: 'main',
      caption: 'Scheduled Today',
    },
  ]);
});

it('reads numeric assignment identity from both session and exercise diary links', () => {
  const entries = [
    { id: 1, workout_plan_assignment_id: 7 },
    { id: 2, exercises: [{ workout_plan_assignment_id: 8 }] },
  ] as unknown as ExerciseSessionResponse[];
  expect([...getLoggedAssignmentIds(entries)].sort()).toEqual(['7', '8']);
});

it('relays the exact Program session rather than standalone current progression', () => {
  // Only scheduling relationships are needed to exercise the shared selector.
  const programs = [
    {
      phases: [
        {
          weeks: [
            {
              sessions: [
                {
                  workout_plan_id: 1,
                  workout_session_id: secondId,
                  effective_date: '2026-10-12',
                  status: 'planned',
                },
              ],
            },
          ],
        },
      ],
    },
  ] as unknown as TrainingProgram[];
  const selected = selectDashboardWorkoutPlans(
    [
      plan({
        schedule_type: 'sequential',
        next_session: a,
        next_assignments: a.assignments,
      }),
    ],
    programs
  );
  const dashboardPlans = [
    ...(selected.programPlan ? [selected.programPlan] : []),
    ...selected.standalonePlans,
  ];
  expect(
    scheduledWorkoutsForWatch(dashboardPlans, [], labels).map(
      ({ presetId }) => presetId
    )
  ).toEqual([`session:${secondId}`]);
});

it('sends only the fixed earliest same-day Program session token', () => {
  const programs = [
    {
      phases: [
        {
          weeks: [
            {
              sessions: [
                {
                  workout_plan_id: 1,
                  workout_session_id: secondId,
                  effective_date: '2026-10-12',
                  status: 'planned',
                  sort_order: 0,
                },
                {
                  workout_plan_id: 1,
                  workout_session_id: firstId,
                  effective_date: '2026-10-12',
                  status: 'planned',
                  sort_order: 1,
                },
                {
                  workout_plan_id: 1,
                  workout_session_id: firstId,
                  effective_date: '2026-10-19',
                  status: 'planned',
                  sort_order: 0,
                },
              ],
            },
          ],
        },
      ],
    },
  ] as unknown as TrainingProgram[];
  const selected = selectDashboardWorkoutPlans(
    [plan({ is_active: false })],
    programs
  );
  const dashboardPlans = [
    ...(selected.programPlan ? [selected.programPlan] : []),
    ...selected.standalonePlans,
  ];
  expect(
    scheduledWorkoutsForWatch(dashboardPlans, [], labels).map(
      ({ presetId }) => presetId
    )
  ).toEqual([`session:${secondId}`]);
});

it('includes only owner-consistent inactive Program-bound library plans and preserves active progression', () => {
  const active = plan({
    id: 10,
    next_session: b,
    next_assignments: b.assignments,
  });
  const inactive = plan({ id: 20, is_active: false });
  const otherOwner = plan({ id: 30, user_id: 'other-owner', is_active: false });
  const unrelated = plan({
    id: 40,
    is_active: false,
    sessions: [{ ...a, id: '33333333-3333-4333-8333-333333333333' }],
  });
  const staleLibraryActive = {
    ...active,
    next_session: a,
    next_assignments: a.assignments,
  };
  const programs = [
    {
      user_id: 'user-1',
      phases: [
        {
          weeks: [
            {
              sessions: [
                {
                  workout_plan_id: inactive.id,
                  workout_session_id: firstId,
                  effective_date: '2026-10-12',
                  status: 'planned',
                },
              ],
            },
          ],
        },
      ],
    },
  ] as unknown as TrainingProgram[];
  const candidates = getWorkoutPlanCandidates(
    [active],
    [staleLibraryActive, inactive, otherOwner, unrelated],
    programs
  );
  expect(candidates.map(({ id }) => id)).toEqual([10, 20]);
  expect(candidates[0]?.next_session?.id).toBe(secondId);
  expect(
    candidates[0]?.next_assignments?.map((assignment) => assignment.id)
  ).toEqual([2]);
});

it('suppresses completed earliest Program sessions without promoting a later Program date', () => {
  const programs = [
    {
      phases: [
        {
          weeks: [
            {
              sessions: [
                {
                  workout_plan_id: 1,
                  workout_session_id: firstId,
                  effective_date: '2026-10-12',
                  status: 'planned',
                },
                {
                  workout_plan_id: 1,
                  workout_session_id: secondId,
                  effective_date: '2026-10-19',
                  status: 'planned',
                },
              ],
            },
          ],
        },
      ],
    },
  ] as unknown as TrainingProgram[];
  const selected = selectDashboardWorkoutPlans([plan()], programs);
  const dashboardPlans = [
    ...(selected.programPlan ? [selected.programPlan] : []),
    ...selected.standalonePlans,
  ];
  const entries = [
    { id: 9, exercises: [{ workout_plan_assignment_id: 1 }] },
  ] as unknown as ExerciseSessionResponse[];
  expect(scheduledWorkoutsForWatch(dashboardPlans, entries, labels)).toEqual([]);
});
