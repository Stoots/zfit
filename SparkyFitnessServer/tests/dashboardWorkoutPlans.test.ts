import { describe, expect, it } from 'vitest';
import {
  selectDashboardWorkoutPlans,
  trainingProgramSchema,
} from '@workspace/shared';

const sessionA = '00000000-0000-4000-8000-000000000001';
const sessionB = '00000000-0000-4000-8000-000000000002';
const missingSession = '00000000-0000-4000-8000-000000000003';
const plan = {
  id: 10,
  is_active: false,
  sessions: [
    {
      id: sessionA,
      name: 'A',
      is_optional: true,
      assignments: [
        {
          id: 101,
          sets: [
            { set_number: 1, reps: 8 },
            { set_number: 2, reps: 8 },
          ],
        },
      ],
    },
    {
      id: sessionB,
      name: 'A',
      is_optional: false,
      assignments: [
        {
          id: 102,
          sets: [
            { set_number: 1, reps: 8 },
            { set_number: 2, reps: 8 },
            { set_number: 3, reps: 8 },
          ],
        },
      ],
    },
  ],
  next_session: {
    id: missingSession,
    name: 'Unrelated live progression',
    assignments: [],
  },
  next_assignments: [],
};
const standalone = {
  id: 20,
  is_active: true,
  sessions: [],
  next_session: null,
  next_assignments: [],
};
function program(
  sessions: {
    workout_session_id: string;
    effective_date: string;
    status?: 'planned' | 'missed' | 'omitted';
    is_optional?: boolean;
  }[]
) {
  return trainingProgramSchema.parse({
    id: '00000000-0000-4000-8000-000000000010',
    user_id: 'owner',
    name: 'Program',
    goal: 'Strength',
    start_date: '2026-10-11',
    end_date: '2026-10-17',
    schedule_end_date: '2026-10-17',
    schedule_type: 'fixed',
    auto_shift: false,
    created_at: '2026-10-11T00:00:00Z',
    updated_at: '2026-10-11T00:00:00Z',
    phases: [
      {
        id: '00000000-0000-4000-8000-000000000020',
        name: 'Phase',
        goal: 'Strength',
        sort_order: 0,
        weeks: [
          {
            id: '00000000-0000-4000-8000-000000000030',
            start_date: '2026-10-11',
            end_date: '2026-10-17',
            sort_order: 0,
            sessions: sessions.map((session, index) => ({
              id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
              name: 'A',
              scheduled_date: session.effective_date,
              effective_date: session.effective_date,
              workout_session_id: session.workout_session_id,
              workout_session_name: 'A',
              workout_plan_id: 10,
              workout_plan_name: 'Plan',
              sort_order: index,
              status: session.status ?? 'planned',
              is_optional: session.is_optional ?? false,
              outcome_at:
                session.status === 'missed' || session.status === 'omitted'
                  ? '2026-10-11T12:00:00Z'
                  : null,
              completed_workout: null,
            })),
          },
        ],
      },
    ],
  });
}

describe('Program dashboard session binding', () => {
  it('shows one exact Program preview and keeps standalone plans separate', () => {
    const cards = selectDashboardWorkoutPlans(
      [plan, standalone],
      [
        program([
          { workout_session_id: sessionB, effective_date: '2026-10-11' },
          { workout_session_id: sessionA, effective_date: '2026-10-11' },
        ]),
      ]
    );
    expect(cards.programPlan).toMatchObject({
      id: 10,
      training_program_session_id: '00000000-0000-4000-8000-000000000100',
      next_session: { id: sessionB },
      next_assignments: [
        {
          id: 102,
          sets: [
            { set_number: 1, reps: 8 },
            { set_number: 2, reps: 8 },
            { set_number: 3, reps: 8 },
          ],
        },
      ],
    });
    expect(cards.standalonePlans.map((card) => card.id)).toEqual([20]);
  });

  it('selects only the earliest pending effective date, even when a later workout is encountered first', () => {
    const cards = selectDashboardWorkoutPlans(
      [plan, standalone],
      [
        program([
          { workout_session_id: sessionB, effective_date: '2026-10-14' },
          {
            workout_session_id: sessionB,
            effective_date: '2026-10-11',
            status: 'missed',
          },
          { workout_session_id: sessionA, effective_date: '2026-10-12' },
        ]),
      ]
    );
    expect(cards.programPlan).toMatchObject({
      id: 10,
      next_session: { id: sessionA },
    });
    expect(cards.standalonePlans.map((card) => card.id)).toEqual([20]);
  });

  it('offers a planned optional session in authored same-day order', () => {
    const authored = program([
      {
        workout_session_id: sessionA,
        effective_date: '2026-10-11',
        is_optional: true,
      },
      { workout_session_id: sessionB, effective_date: '2026-10-11' },
    ]);
    const [optional, required] = authored.phases[0]!.weeks[0]!.sessions;
    const selected = selectDashboardWorkoutPlans(
      [plan, standalone],
      [authored]
    );

    expect(selected.programPlan).toMatchObject({
      training_program_session_id: optional!.id,
      next_session: { id: sessionA },
    });
    expect(selected.programPlan?.training_program_session_id).not.toBe(
      required!.id
    );
  });

  it('skips an omitted optional session and selects the next required exact binding', () => {
    const authored = program([
      {
        workout_session_id: sessionB,
        effective_date: '2026-10-11',
        is_optional: true,
        status: 'omitted',
      },
      { workout_session_id: sessionA, effective_date: '2026-10-12' },
    ]);
    const selected = selectDashboardWorkoutPlans(
      [plan, standalone],
      [authored]
    );

    expect(selected.programPlan?.next_session.id).toBe(sessionA);
    expect(selected.standalonePlans.map((item) => item.id)).toEqual([20]);
  });

  it('never substitutes the current or first session for an unresolved exact Program binding', () => {
    const cards = selectDashboardWorkoutPlans(
      [plan, standalone],
      [
        program([
          { workout_session_id: missingSession, effective_date: '2026-10-11' },
        ]),
      ]
    );
    expect(cards).toEqual({
      programPlan: undefined,
      standalonePlans: [standalone],
    });
  });
});
