import { randomUUID, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import express from 'express';
// @ts-expect-error TS7016 — supertest has no declarations in this package.
import request from 'supertest';
// @ts-expect-error TS7016 — cookie-parser has no declarations in this package.
import cookieParser from 'cookie-parser';
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import {
  trainingProgramSchema,
  type TrainingProgram,
  type TrainingProgramInput,
  workoutPlanResponseSchema,
  presetSessionResponseSchema,
  selectDashboardWorkoutPlans,
  type WorkoutPlanCreateRequest,
  type WorkoutPlanResponse,
} from '@workspace/shared';
import { getClient, getSystemClient, endPool } from '../db/poolManager.js';
import errorHandler from '../middleware/errorHandler.js';
import {
  databaseReachable,
  requireDatabaseInCI,
} from './databaseIntegrationGuard.js';

const skipEnvVar = 'SKIP_TRAINING_PROGRAM_DB';
const run = await databaseReachable(skipEnvVar);
requireDatabaseInCI(run, skipEnvVar, 'Training Program');

describe.runIf(run)('persisted authenticated Training Program APIs', () => {
  const app = express();
  let owner: string, other: string, ownerToken: string, otherToken: string;
  let outsider: string, outsiderToken: string;
  let planId: number, foreignPlanId: number;
  let workoutSessionId: string, foreignWorkoutSessionId: string;
  let program: TrainingProgram;
  const body = (): TrainingProgramInput => ({
    name: 'Race preparation',
    goal: 'Finish a 10 km race',
    start_date: '2026-10-25',
    end_date: '2026-11-07',
    schedule_type: 'fixed',
    phases: [
      {
        name: 'Base',
        goal: 'Build endurance',
        weeks: [
          {
            start_date: '2026-10-25',
            end_date: '2026-10-31',
            sessions: [
              {
                name: 'Easy run',
                scheduled_date: '2026-10-25',
                workout_session_id: workoutSessionId,
              },
              {
                name: 'Strength',
                scheduled_date: '2026-10-30',
                workout_session_id: workoutSessionId,
              },
            ],
          },
        ],
      },
      {
        name: 'Build',
        goal: 'Race pace',
        weeks: [
          {
            start_date: '2026-11-01',
            end_date: '2026-11-07',
            sessions: [
              {
                name: 'Tempo',
                scheduled_date: '2026-11-01',
                workout_session_id: workoutSessionId,
              },
            ],
          },
        ],
      },
    ],
  });
  function editable(saved: TrainingProgram): TrainingProgramInput {
    return {
      name: saved.name,
      goal: saved.goal,
      start_date: saved.start_date,
      end_date: saved.end_date,
      schedule_type: saved.schedule_type,
      auto_shift: saved.auto_shift,
      phases: saved.phases.map((phase) => ({
        id: phase.id,
        name: phase.name,
        goal: phase.goal,
        weeks: phase.weeks.map((week) => ({
          id: week.id,
          start_date: week.start_date,
          end_date: week.end_date,
          sessions: week.sessions.map((session) => ({
            id: session.id,
            name: session.name,
            scheduled_date: session.scheduled_date,
            workout_session_id: session.workout_session_id,
            is_optional: session.is_optional,
          })),
        })),
      })),
    };
  }
  const sessions = (saved: TrainingProgram) =>
    saved.phases.flatMap((phase) =>
      phase.weeks.flatMap((week) => week.sessions)
    );
  const reload = async (id = program.id) => {
    const response = await request(app)
      .get(`/api/training-programs/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(response.status).toBe(200);
    return trainingProgramSchema.parse(response.body);
  };
  const outcome = (
    sessionId: string,
    value: unknown,
    token = ownerToken,
    id = program.id
  ) =>
    request(app)
      .post(`/api/training-programs/${id}/sessions/${sessionId}/outcome`)
      .set('Authorization', `Bearer ${token}`)
      .send(value);
  const update = (input: TrainingProgramInput, id = program.id) =>
    request(app)
      .put(`/api/training-programs/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(input);
  async function diaryWorkout(type: 'preset' | 'individual', userId = owner) {
    const db = await getSystemClient();
    try {
      const result =
        type === 'preset'
          ? await db.query(
              "INSERT INTO exercise_preset_entries(user_id,name,entry_date,source) VALUES ($1,'Completed strength','2026-10-26','manual') RETURNING id",
              [userId]
            )
          : await db.query(
              "INSERT INTO exercise_entries(user_id,exercise_name,entry_date,duration_minutes,calories_burned,source) VALUES ($1,'Completed run','2026-10-26',30,200,'manual') RETURNING id",
              [userId]
            );
      return { type, id: result.rows[0].id };
    } finally {
      db.release();
    }
  }
  // Missed outcomes are only accepted on or before the athlete's today, so pin
  // the clock after every authored date used below. Only Date is mocked; it is
  // set before sign-up so the issued sessions are valid under it.
  const setToday = (day: string) => vi.setSystemTime(`${day}T12:00:00Z`);
  const DEFAULT_TODAY = '2028-06-01';
  const startSession = (id: string, entry_date: string, token = ownerToken) =>
    request(app)
      .post(`/api/workout-plan-templates/sessions/${id}/start`)
      .set('Authorization', `Bearer ${token}`)
      .send({ entry_date });
  async function createPlan(input: WorkoutPlanCreateRequest) {
    const response = await request(app)
      .post('/api/workout-plan-templates')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(input);
    expect(response.status).toBe(201);
    return workoutPlanResponseSchema.parse(response.body);
  }
  async function reloadPlan(id: number) {
    const response = await request(app)
      .get(`/api/workout-plan-templates/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(response.status).toBe(200);
    return workoutPlanResponseSchema.parse(response.body);
  }
  function planInput(saved: WorkoutPlanResponse): WorkoutPlanCreateRequest {
    return {
      plan_name: saved.plan_name,
      description: saved.description,
      start_date: saved.start_date,
      end_date: saved.end_date,
      is_active: saved.is_active ?? false,
      schedule_type: saved.schedule_type,
      entry_mode: saved.entry_mode,
      sessions: saved.sessions.map((session) => ({
        id: session.id,
        name: session.name,
        day_of_week: session.day_of_week,
        sort_order: session.sort_order,
        is_optional: session.is_optional,
        assignments: session.assignments.map((assignment) => ({
          id: assignment.id,
          exercise_id: assignment.exercise_id,
          workout_preset_id: assignment.workout_preset_id,
          sort_order: assignment.sort_order,
          sets: assignment.sets,
          ...(assignment.preset_snapshot
            ? { preset_snapshot: assignment.preset_snapshot }
            : {}),
        })),
      })),
    };
  }
  async function seedExercise() {
    const db = await getSystemClient();
    try {
      return (
        await db.query(
          `INSERT INTO exercises(name,category,user_id,is_custom,source)
         VALUES ('Dumbbell split squat','Strength',$1,true,'custom') RETURNING id`,
          [owner]
        )
      ).rows[0].id as string;
    } finally {
      db.release();
    }
  }
  async function diaryPrescription(assignmentId: number, entryDate: string) {
    const db = await getSystemClient();
    try {
      const result = await db.query(
        `SELECT to_jsonb(e) AS entry,
           COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.set_number)
             FROM exercise_entry_sets s WHERE s.exercise_entry_id = e.id),'[]'::jsonb) AS sets
         FROM exercise_entries e
         WHERE e.user_id = $1 AND e.workout_plan_assignment_id = $2 AND e.entry_date = $3
         ORDER BY e.id`,
        [owner, assignmentId, entryDate]
      );
      return result.rows;
    } finally {
      db.release();
    }
  }
  const prescribedSets = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      set_number: index + 1,
      set_type: 'working',
      reps: 8,
      weight: null,
      duration: null,
      distance: null,
      rest_time: 90,
      notes: '8 each side; RPE 7–8; leave 2 reps in reserve',
    }));
  async function assertWorkoutTiming(
    id: string,
    date: string,
    exerciseId: string,
    format: string,
    cap: number | null
  ) {
    const detail = await request(app)
      .get(`/api/exercise-preset-entries/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(detail.status).toBe(200);
    expect(presetSessionResponseSchema.parse(detail.body)).toMatchObject({
      workout_format: format,
      time_cap_seconds: cap,
    });
    for (const path of [
      `/api/v2/exercise-entries/by-date?selectedDate=${date}`,
      `/api/v2/exercise-entries/history?exerciseId=${exerciseId}&pageSize=100`,
    ]) {
      const response = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(response.status).toBe(200);
      const rows = Array.isArray(response.body)
        ? response.body
        : response.body.sessions;
      const grouped = presetSessionResponseSchema.parse(
        rows.find((item: { id: string }) => item.id === id)
      );
      expect(grouped).toMatchObject({
        workout_format: format,
        time_cap_seconds: cap,
      });
    }
  }
  beforeAll(async () => {
    setToday(DEFAULT_TODAY);
    // Load Better Auth only after the database probe: it eagerly validates the
    // migrated schema at import time, which cannot run on DB-less unit-test hosts.
    const { auth } = await import('../auth.js');
    const accounts = await Promise.all(
      ['owner', 'other', 'outsider'].map((name) =>
        auth.api.signUpEmail({
          body: {
            name,
            email: `training-program-${name}-${randomUUID()}@example.test`,
            password: randomBytes(24).toString('base64'),
          },
        })
      )
    );
    owner = accounts[0]!.user.id;
    ownerToken = accounts[0]!.token!;
    other = accounts[1]!.user.id;
    otherToken = accounts[1]!.token!;
    outsider = accounts[2]!.user.id;
    outsiderToken = accounts[2]!.token!;
    const db = await getSystemClient();
    try {
      // Only synthetic harness accounts: keep authentication valid while the
      // real-timer clock traverses future athlete-calendar/DST boundaries.
      await db.query(
        'UPDATE "session" SET expires_at = $2 WHERE user_id = ANY($1::uuid[])',
        [[owner, other, outsider], '2099-12-31T00:00:00Z']
      );
      planId = (
        await db.query(
          'INSERT INTO workout_plan_templates(user_id, plan_name, is_active) VALUES ($1,$2,false) RETURNING id',
          [owner, 'Existing standalone plan']
        )
      ).rows[0].id;
      foreignPlanId = (
        await db.query(
          'INSERT INTO workout_plan_templates(user_id, plan_name, is_active) VALUES ($1,$2,false) RETURNING id',
          [other, 'Other private plan']
        )
      ).rows[0].id;
      workoutSessionId = randomUUID();
      foreignWorkoutSessionId = randomUUID();
      await db.query(
        `INSERT INTO workout_plan_sessions(id, template_id, user_id, name, day_of_week, sort_order)
         VALUES ($1,$2,$3,'Standalone',null,0), ($4,$5,$6,'Private',null,0)`,
        [
          workoutSessionId,
          planId,
          owner,
          foreignWorkoutSessionId,
          foreignPlanId,
          other,
        ]
      );
      await db.query(
        `INSERT INTO family_access(owner_user_id, family_user_id, family_email, access_permissions, is_active, status)
        VALUES($1,$2,$3,'{"can_manage_diary":true,"can_view_exercise_library":true}',true,'active')`,
        [owner, other, accounts[1]!.user.email]
      );
    } finally {
      db.release();
    }
    const { default: routes } =
      await import('../routes/trainingProgramRoutes.js');
    const { default: workoutRoutes } =
      await import('../routes/workoutPlanTemplateRoutes.js');
    // These imports transitively load Better Auth's schema checks; defer them
    // until the disposable DB probe succeeds, as with the existing routers.
    const { default: completionRoutes } =
      await import('../routes/exercisePresetEntryRoutes.js');
    const { authenticate } = await import('../middleware/authMiddleware.js');
    const { default: diaryRoutes } =
      await import('../routes/exerciseEntryRoutes.js');
    const { router: historyRoutes } =
      await import('../routes/v2/exerciseEntryRoutes.js');
    app.use(express.json(), cookieParser());
    app.use('/api/training-programs', routes);
    app.use('/api/workout-plan-templates', workoutRoutes);
    app.use('/api/exercise-preset-entries', authenticate, completionRoutes);
    app.use('/api/exercise-entries', diaryRoutes);
    app.use('/api/v2/exercise-entries', authenticate, historyRoutes);
    app.use(errorHandler);
  }, 30000);
  beforeEach(async () => {
    const db = await getSystemClient();
    try {
      await db.query(
        'DELETE FROM training_programs WHERE user_id = ANY($1::uuid[])',
        [[owner, other]]
      );
    } finally {
      db.release();
    }
    const response = await request(app)
      .post('/api/training-programs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(body());
    expect(response.status).toBe(201);
    program = trainingProgramSchema.parse(response.body);
  });
  afterAll(async () => {
    vi.useRealTimers();
    const db = await getSystemClient();
    try {
      await db.query('BEGIN');
      const users = [[owner, other, outsider].filter(Boolean)];
      await db.query(
        'DELETE FROM training_programs WHERE user_id = ANY($1::uuid[])',
        users
      );
      // Diary assignment links are RESTRICT: remove logs before plans/library.
      await db.query(
        'DELETE FROM exercise_entries WHERE user_id = ANY($1::uuid[])',
        users
      );
      await db.query(
        'DELETE FROM exercise_preset_entries WHERE user_id = ANY($1::uuid[])',
        users
      );
      await db.query(
        'DELETE FROM workout_plan_templates WHERE user_id = ANY($1::uuid[])',
        users
      );
      await db.query(
        'DELETE FROM workout_presets WHERE user_id = ANY($1::uuid[])',
        users
      );
      await db.query(
        'DELETE FROM exercises WHERE user_id = ANY($1::uuid[])',
        users
      );
      await db.query(
        'DELETE FROM public."user" WHERE id = ANY($1::uuid[])',
        users
      );
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
    await endPool();
  });

  it('persists hierarchy, stable IDs, ordering, removals and fixed calendar dates through CRUD', async () => {
    const loaded = await request(app)
      .get(`/api/training-programs/${program.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(trainingProgramSchema.parse(loaded.body)).toEqual(program);
    expect(program.phases.map((phase) => phase.name)).toEqual([
      'Base',
      'Build',
    ]);
    expect(
      program.phases[0]!.weeks[0]!.sessions.map(
        (session) => session.scheduled_date
      )
    ).toEqual(['2026-10-25', '2026-10-30']);
    const input = editable(program);
    input.name = 'Revised goal';
    input.goal = 'Faster race';
    input.start_date = '2026-10-24';
    input.phases[0]!.weeks[0]!.sessions.reverse();
    input.phases[1]!.weeks = [];
    const updated = await request(app)
      .put(`/api/training-programs/${program.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(input);
    expect(updated.status).toBe(200);
    const saved = trainingProgramSchema.parse(updated.body);
    expect(saved.goal).toBe('Faster race');
    expect(
      saved.phases[0]!.weeks[0]!.sessions.map((session) => [
        session.id,
        session.sort_order,
        session.scheduled_date,
      ])
    ).toEqual([
      [program.phases[0]!.weeks[0]!.sessions[1]!.id, 0, '2026-10-30'],
      [program.phases[0]!.weeks[0]!.sessions[0]!.id, 1, '2026-10-25'],
    ]);
    const list = await request(app)
      .get('/api/training-programs')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(list.body).toEqual([saved]);
    const db = await getSystemClient();
    try {
      expect(
        (
          await db.query(
            'SELECT id FROM training_program_weeks WHERE id = $1',
            [program.phases[1]!.weeks[0]!.id]
          )
        ).rows
      ).toEqual([]);
    } finally {
      db.release();
    }
    expect(
      (
        await request(app)
          .delete(`/api/training-programs/${program.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
      ).status
    ).toBe(204);
    expect(
      (
        await request(app)
          .get(`/api/training-programs/${program.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
      ).status
    ).toBe(404);
    const check = await getSystemClient();
    try {
      for (const table of [
        'training_program_phases',
        'training_program_weeks',
        'training_program_sessions',
      ]) {
        expect(
          (
            await check.query(`SELECT id FROM ${table} WHERE program_id = $1`, [
              program.id,
            ])
          ).rows
        ).toEqual([]);
      }
      expect(
        (
          await check.query(
            'SELECT plan_name FROM workout_plan_templates WHERE id = $1',
            [planId]
          )
        ).rows
      ).toEqual([{ plan_name: 'Existing standalone plan' }]);
    } finally {
      check.release();
    }
  });

  it('defaults an omitted schedule type to fixed and never shifts dates on reload', async () => {
    const { schedule_type: _schedule, ...input } = body();
    const response = await request(app)
      .post('/api/training-programs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(input);
    expect(response.status).toBe(201);
    const saved = trainingProgramSchema.parse(response.body);
    expect(saved.schedule_type).toBe('fixed');
    const reload = await request(app)
      .get(`/api/training-programs/${saved.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(reload.body.phases[1].weeks[0].sessions[0].scheduled_date).toBe(
      '2026-11-01'
    );
  });

  it('requires real authentication and isolates every CRUD endpoint and delegated context', async () => {
    expect((await request(app).get('/api/training-programs')).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/training-programs')
          .set('Authorization', `Bearer ${otherToken}`)
      ).body
    ).toEqual([]);
    expect(
      (
        await request(app)
          .get(`/api/training-programs/${program.id}`)
          .set('Authorization', `Bearer ${otherToken}`)
      ).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .put(`/api/training-programs/${program.id}`)
          .set('Authorization', `Bearer ${otherToken}`)
          .send(body())
      ).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .delete(`/api/training-programs/${program.id}`)
          .set('Authorization', `Bearer ${otherToken}`)
      ).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .get('/api/training-programs')
          .set('Authorization', `Bearer ${otherToken}`)
          .set('x-on-behalf-of-user-id', owner)
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/training-programs')
          .set('Authorization', `Bearer ${otherToken}`)
          .set('Cookie', `sparky_active_user_id=${owner}`)
          .send(body())
      ).status
    ).toBe(403);
    const forged = { ...body(), user_id: other };
    expect(
      (
        await request(app)
          .post('/api/training-programs')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send(forged)
      ).status
    ).toBe(400);
    const original = await request(app)
      .get(`/api/training-programs/${program.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(original.body).toEqual(program);
  });

  it('rejects visible delegated Workout Plans and rolls back the whole edit', async () => {
    const input = editable(program);
    input.name = 'Must not persist';
    input.phases[0]!.weeks[0]!.sessions[0]!.workout_session_id =
      foreignWorkoutSessionId;
    expect(
      (
        await request(app)
          .put(`/api/training-programs/${program.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send(input)
      ).status
    ).toBe(400);
    const otherInput = body();
    otherInput.phases[0]!.weeks[0]!.sessions[0]!.workout_session_id =
      workoutSessionId;
    expect(
      (
        await request(app)
          .post('/api/training-programs')
          .set('Authorization', `Bearer ${otherToken}`)
          .send(otherInput)
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .get(`/api/training-programs/${program.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
      ).body
    ).toEqual(program);
  });

  it('rejects unknown, duplicate, foreign and reparented child IDs', async () => {
    const foreignBody = body();
    foreignBody.phases.forEach((phase) =>
      phase.weeks.forEach((week) =>
        week.sessions.forEach((session) => {
          session.workout_session_id = foreignWorkoutSessionId;
        })
      )
    );
    const response = await request(app)
      .post('/api/training-programs')
      .set('Authorization', `Bearer ${otherToken}`)
      .send(foreignBody);
    expect(response.status).toBe(201);
    const foreign = trainingProgramSchema.parse(response.body);
    for (const id of [
      randomUUID(),
      foreign.phases[0]!.weeks[0]!.sessions[0]!.id,
      program.phases[0]!.weeks[0]!.sessions[1]!.id,
    ]) {
      const input = editable(program);
      input.phases[0]!.weeks[0]!.sessions[0]!.id = id;
      expect(
        (
          await request(app)
            .put(`/api/training-programs/${program.id}`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send(input)
        ).status
      ).toBe(400);
    }
    const input = editable(program);
    const moved = input.phases[0]!.weeks[0]!.sessions.pop()!;
    moved.scheduled_date = '2026-11-02';
    input.phases[1]!.weeks[0]!.sessions.push(moved);
    expect(
      (
        await request(app)
          .put(`/api/training-programs/${program.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send(input)
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .get(`/api/training-programs/${program.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
      ).body
    ).toEqual(program);
  });

  it('rejects invalid calendars, inverted ranges, overlapping weeks and dates outside their week', async () => {
    const invalid = [
      { ...body(), start_date: '2026-02-30' },
      { ...body(), end_date: '2026-10-24' },
      { ...body(), schedule_type: 'auto_shift' },
    ];
    const outside = body();
    outside.phases[0]!.weeks[0]!.sessions[0]!.scheduled_date = '2026-11-01';
    invalid.push(outside);
    const overlapping = body();
    overlapping.phases[1]!.weeks[0]!.start_date = '2026-10-31';
    invalid.push(overlapping);
    const tooLong = body();
    tooLong.phases[0]!.weeks[0]!.end_date = '2026-11-01';
    invalid.push(tooLong);
    for (const input of invalid)
      expect(
        (
          await request(app)
            .post('/api/training-programs')
            .set('Authorization', `Bearer ${ownerToken}`)
            .send(input)
        ).status
      ).toBe(400);
  });

  it('enforces owner-only RLS for structure and sessions even with an owner active context', async () => {
    const client = await getClient(owner, other);
    try {
      for (const table of [
        'training_programs',
        'training_program_phases',
        'training_program_weeks',
        'training_program_sessions',
      ]) {
        expect(
          (
            await client.query(`SELECT id FROM ${table} WHERE user_id = $1`, [
              owner,
            ])
          ).rows
        ).toEqual([]);
        expect(
          (
            await client.query(
              `UPDATE ${table} SET updated_at = now() WHERE user_id = $1`,
              [owner]
            )
          ).rowCount
        ).toBe(0);
        expect(
          (
            await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [
              owner,
            ])
          ).rowCount
        ).toBe(0);
      }
      await expect(
        client.query(
          'INSERT INTO training_programs(user_id,name,goal,start_date,end_date) VALUES ($1,$2,$3,$4,$5)',
          [owner, 'Forged', 'Forged', '2026-10-25', '2026-10-31']
        )
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      client.release();
    }
  });

  it('blocks referenced Workout Plan deletion without altering sessions, and keeps unreferenced deletion working', async () => {
    const response = await request(app)
      .delete(`/api/workout-plan-templates/${planId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(response.status).toBe(409);
    expect(
      (
        await request(app)
          .get(`/api/training-programs/${program.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
      ).body
    ).toEqual(program);
    const db = await getSystemClient();
    let unusedId: number;
    try {
      unusedId = (
        await db.query(
          'INSERT INTO workout_plan_templates(user_id,plan_name,is_active) VALUES ($1,$2,false) RETURNING id',
          [owner, 'Unused']
        )
      ).rows[0].id;
    } finally {
      db.release();
    }
    expect(
      (
        await request(app)
          .delete(`/api/workout-plan-templates/${unusedId}`)
          .set('Authorization', `Bearer ${ownerToken}`)
      ).status
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/workout-plan-templates/${planId}`)
          .set('Authorization', `Bearer ${ownerToken}`)
      ).status
    ).toBe(200);
  });

  it('records fixed-date misses without shifting and retains them through aggregate edits', async () => {
    expect(program.auto_shift).toBe(false);
    const first = sessions(program)[0]!;
    const response = await outcome(first.id, { status: 'missed' });
    expect(response.status).toBe(200);
    const missed = trainingProgramSchema.parse(response.body);
    expect(
      sessions(missed).map((item) => [item.status, item.effective_date])
    ).toEqual([
      ['missed', '2026-10-25'],
      ['planned', '2026-10-30'],
      ['planned', '2026-11-01'],
    ]);
    expect(sessions(missed)[0]!.outcome_at).not.toBeNull();
    const edit = editable(missed);
    edit.phases[1]!.weeks[0]!.sessions[0]!.scheduled_date = '2026-11-03';
    expect((await update(edit)).status).toBe(200);
    const saved = await reload();
    expect(sessions(saved)[0]).toEqual(sessions(missed)[0]);
    expect(sessions(saved)[2]!.effective_date).toBe('2026-11-03');
  });

  it.each(['preset', 'individual'] as const)(
    'links an owner %s workout with durable completion history and idempotent retries',
    async (type) => {
      const workout = await diaryWorkout(type);
      const first = sessions(program)[0]!;
      const response = await outcome(first.id, {
        status: 'completed',
        workout,
      });
      expect(response.status).toBe(200);
      const saved = trainingProgramSchema.parse(response.body);
      const completed = sessions(saved)[0]!;
      expect(completed).toMatchObject({
        status: 'completed',
        effective_date: '2026-10-25',
        completed_workout: {
          ...workout,
          name: type === 'preset' ? 'Completed strength' : 'Completed run',
          entry_date: '2026-10-26',
        },
      });
      const retry = await outcome(first.id, { status: 'completed', workout });
      expect(retry.status).toBe(200);
      expect(retry.body).toEqual(saved);
      expect((await outcome(first.id, { status: 'missed' })).status).toBe(409);
      expect(
        (
          await outcome(sessions(program)[1]!.id, {
            status: 'completed',
            workout,
          })
        ).status
      ).toBe(409);
      const another = await request(app)
        .post('/api/training-programs')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(body());
      expect(
        (
          await outcome(
            sessions(another.body)[0]!.id,
            { status: 'completed', workout },
            ownerToken,
            another.body.id
          )
        ).status
      ).toBe(409);
      const db = await getSystemClient();
      try {
        const table =
          type === 'preset' ? 'exercise_preset_entries' : 'exercise_entries';
        const nameColumn = type === 'preset' ? 'name' : 'exercise_name';
        await db.query(
          `UPDATE ${table} SET ${nameColumn} = 'Renamed diary workout', entry_date = '2026-10-27' WHERE id = $1`,
          [workout.id]
        );
        await db.query(
          "UPDATE workout_plan_templates SET plan_name = 'Renamed plan' WHERE id = $1",
          [planId]
        );
        expect(sessions(await reload())[0]).toEqual(completed);
        await db.query(`DELETE FROM ${table} WHERE id = $1`, [workout.id]);
        expect(sessions(await reload())[0]).toEqual(completed);
        expect(
          (await outcome(first.id, { status: 'completed', workout })).status
        ).toBe(200);
      } finally {
        await db.query(
          "UPDATE workout_plan_templates SET plan_name = 'Existing standalone plan' WHERE id = $1",
          [planId]
        );
        db.release();
      }
    }
  );

  it('auto-shifts only later planned effective dates, cumulatively across repeated misses, keeping same-day and completed history', async () => {
    const edit = editable(program);
    edit.auto_shift = true;
    edit.phases[0]!.weeks[0]!.sessions.push({
      name: 'Same day',
      scheduled_date: '2026-10-25',
      workout_session_id: workoutSessionId,
    });
    edit.phases[1]!.weeks[0]!.sessions.push({
      name: 'Last day',
      scheduled_date: '2026-11-07',
      workout_session_id: workoutSessionId,
    });
    const response = await update(edit);
    expect(response.status).toBe(200);
    const original = trainingProgramSchema.parse(response.body);
    const [first, second, sameDay, completed, last] = sessions(original);
    const linked = await outcome(completed!.id, {
      status: 'completed',
      workout: await diaryWorkout('preset'),
    });
    expect(linked.status).toBe(200);
    const completion = sessions(linked.body)[3]!;
    const miss = await outcome(first!.id, { status: 'missed' });
    expect(miss.status).toBe(200);
    const shifted = trainingProgramSchema.parse(miss.body);
    expect(
      sessions(shifted).map((item) => [item.status, item.effective_date])
    ).toEqual([
      ['missed', '2026-10-25'],
      ['planned', '2026-10-31'],
      ['planned', '2026-10-25'],
      ['completed', '2026-11-01'],
      ['planned', '2026-11-08'],
    ]);
    expect(shifted.schedule_end_date).toBe('2026-11-08');
    expect(shifted.end_date).toBe('2026-11-07');
    expect(sessions(shifted)[3]).toEqual(completion);
    expect((await outcome(first!.id, { status: 'missed' })).body).toEqual(
      shifted
    );
    const secondMiss = await outcome(second!.id, { status: 'missed' });
    expect(secondMiss.status).toBe(200);
    const repeated = await reload();
    expect(sessions(repeated)[0]).toEqual(sessions(shifted)[0]);
    expect(sessions(repeated)[1]).toMatchObject({
      status: 'missed',
      effective_date: '2026-10-31',
      scheduled_date: '2026-10-30',
    });
    expect(sessions(repeated)[3]).toEqual(completion);
    expect(
      sessions(repeated).find((item) => item.id === last!.id)!.effective_date
    ).toBe('2026-11-09');
    expect(
      sessions(repeated).find((item) => item.id === sameDay!.id)!.effective_date
    ).toBe('2026-10-25');
  });

  it('preserves shifts on aggregate save, resets a deliberately changed planned date and toggles only subsequent misses', async () => {
    const edit = editable(program);
    edit.auto_shift = true;
    expect((await update(edit)).status).toBe(200);
    expect(
      (await outcome(sessions(program)[0]!.id, { status: 'missed' })).status
    ).toBe(200);
    const shifted = await reload();
    const unrelated = editable(shifted);
    unrelated.goal = 'Updated goal';
    expect((await update(unrelated)).status).toBe(200);
    expect(sessions(await reload()).map((item) => item.effective_date)).toEqual(
      ['2026-10-25', '2026-10-31', '2026-11-02']
    );
    unrelated.auto_shift = false;
    unrelated.phases[1]!.weeks[0]!.sessions[0]!.scheduled_date = '2026-11-04';
    expect((await update(unrelated)).status).toBe(200);
    expect(
      (await outcome(sessions(program)[1]!.id, { status: 'missed' })).status
    ).toBe(200);
    const fixed = await reload();
    expect(sessions(fixed)[2]!.effective_date).toBe('2026-11-04');
    const enable = editable(await reload());
    enable.auto_shift = true;
    expect((await update(enable)).status).toBe(200);
    expect(sessions(await reload()).map((item) => item.effective_date)).toEqual(
      ['2026-10-25', '2026-10-31', '2026-11-04']
    );
  });

  it.each(['missed', 'completed'] as const)(
    'rejects aggregate removal or rewrite of a %s session and its ancestors atomically',
    async (status) => {
      const first = sessions(program)[0]!;
      const value =
        status === 'missed'
          ? { status }
          : { status, workout: await diaryWorkout('individual') };
      expect((await outcome(first.id, value)).status).toBe(200);
      const saved = await reload();
      const invalid: TrainingProgramInput[] = [];
      const removeSession = editable(saved);
      removeSession.phases[0]!.weeks[0]!.sessions.shift();
      invalid.push(removeSession);
      const removeWeek = editable(saved);
      removeWeek.phases[0]!.weeks = [];
      invalid.push(removeWeek);
      const removePhase = editable(saved);
      removePhase.phases.shift();
      invalid.push(removePhase);
      for (const field of [
        'name',
        'scheduled_date',
        'workout_session_id',
      ] as const) {
        const changed = editable(saved);
        const item = changed.phases[0]!.weeks[0]!.sessions[0]!;
        if (field === 'name') item.name = 'Rewritten';
        if (field === 'scheduled_date') item.scheduled_date = '2026-10-26';
        if (field === 'workout_session_id')
          item.workout_session_id = foreignWorkoutSessionId;
        invalid.push(changed);
      }
      for (const input of invalid) {
        expect((await update(input)).status).toBe(409);
        expect(await reload()).toEqual(saved);
      }
    }
  );

  it('isolates outcomes, foreign diary links, delegated context and malformed requests', async () => {
    const first = sessions(program)[0]!;
    const url = `/api/training-programs/${program.id}/sessions/${first.id}/outcome`;
    expect(
      (await request(app).post(url).send({ status: 'missed' })).status
    ).toBe(401);
    expect(
      (await outcome(first.id, { status: 'missed' }, otherToken)).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(url)
          .set('Authorization', `Bearer ${otherToken}`)
          .set('x-on-behalf-of-user-id', owner)
          .send({ status: 'missed' })
      ).status
    ).toBe(403);
    for (const type of ['preset', 'individual'] as const) {
      expect(
        (
          await outcome(first.id, {
            status: 'completed',
            workout: await diaryWorkout(type, other),
          })
        ).status
      ).toBe(404);
      expect(
        (
          await outcome(first.id, {
            status: 'completed',
            workout: { type, id: randomUUID() },
          })
        ).status
      ).toBe(404);
    }
    expect((await outcome(randomUUID(), { status: 'missed' })).status).toBe(
      404
    );
    expect((await outcome('invalid', { status: 'missed' })).status).toBe(400);
    for (const invalid of [
      { status: 'planned' },
      { status: 'completed' },
      { status: 'missed', user_id: other },
      { status: 'completed', workout: { type: 'preset', id: 'invalid' } },
    ]) {
      expect((await outcome(first.id, invalid)).status).toBe(400);
    }
    expect(await reload()).toEqual(program);
  });

  it('rejects linking a grouped child as a standalone workout and enforces owner composite FKs', async () => {
    const parent = await diaryWorkout('preset');
    const child = await diaryWorkout('individual');
    const foreign = await diaryWorkout('individual', other);
    const db = await getSystemClient();
    try {
      await db.query(
        'UPDATE exercise_entries SET exercise_preset_entry_id = $1 WHERE id = $2',
        [parent.id, child.id]
      );
      expect(
        (
          await outcome(sessions(program)[0]!.id, {
            status: 'completed',
            workout: child,
          })
        ).status
      ).toBe(404);
      await expect(
        db.query(
          `UPDATE training_program_sessions SET status = 'completed', outcome_at = now(), workout_plan_name_snapshot = 'Plan',
         completed_workout = $2::jsonb, exercise_entry_id = $3 WHERE id = $1`,
          [
            sessions(program)[0]!.id,
            JSON.stringify({
              ...foreign,
              name: 'Foreign',
              entry_date: '2026-10-26',
            }),
            foreign.id,
          ]
        )
      ).rejects.toMatchObject({ code: '23503' });
    } finally {
      db.release();
    }
    expect(await reload()).toEqual(program);
  });

  it.each([
    ['2028-02-28', '2028-02-29', '2028-03-01'],
    ['2026-12-30', '2026-12-31', '2027-01-01'],
    ['2026-10-24', '2026-10-25', '2026-10-26'],
  ])(
    'uses calendar arithmetic from %s across a date boundary',
    async (start, future, expected) => {
      const input = body();
      input.start_date = start!;
      input.end_date = future!;
      input.auto_shift = true;
      input.phases = [
        {
          name: 'Boundary',
          goal: 'Calendar',
          weeks: [
            {
              start_date: start!,
              end_date: future!,
              sessions: [
                {
                  name: 'Miss',
                  scheduled_date: start!,
                  workout_session_id: workoutSessionId,
                },
                {
                  name: 'Future',
                  scheduled_date: future!,
                  workout_session_id: workoutSessionId,
                },
              ],
            },
          ],
        },
      ];
      const created = await request(app)
        .post('/api/training-programs')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(input);
      expect(created.status).toBe(201);
      const saved = trainingProgramSchema.parse(created.body);
      const missed = await outcome(
        sessions(saved)[0]!.id,
        { status: 'missed' },
        ownerToken,
        saved.id
      );
      expect(missed.status).toBe(200);
      const shifted = await reload(saved.id);
      expect(sessions(shifted)[1]).toMatchObject({
        scheduled_date: future,
        effective_date: expected,
      });
      expect(shifted.schedule_end_date).toBe(expected);
      expect(shifted.phases[0]!.weeks[0]!.end_date).toBe(future);
      expect((await update(editable(shifted), shifted.id)).status).toBe(200);
    }
  );

  it('rolls back a miss when auto-shift would exceed the supported calendar', async () => {
    const input = body();
    input.start_date = '2026-10-25';
    input.end_date = '9999-12-31';
    input.auto_shift = true;
    input.phases = [
      {
        name: 'Boundary',
        goal: 'Calendar',
        weeks: [
          {
            start_date: '2026-10-25',
            end_date: '2026-10-31',
            sessions: [
              {
                name: 'Miss',
                scheduled_date: input.start_date,
                workout_session_id: workoutSessionId,
              },
            ],
          },
          {
            start_date: '9999-12-25',
            end_date: '9999-12-31',
            sessions: [
              {
                name: 'Future',
                scheduled_date: input.end_date,
                workout_session_id: workoutSessionId,
              },
            ],
          },
        ],
      },
    ];
    const created = await request(app)
      .post('/api/training-programs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(input);
    expect(created.status).toBe(201);
    const saved = trainingProgramSchema.parse(created.body);
    expect(
      (
        await outcome(
          sessions(saved)[0]!.id,
          { status: 'missed' },
          ownerToken,
          saved.id
        )
      ).status
    ).toBe(409);
    expect(await reload(saved.id)).toEqual(saved);
  });

  describe("missed outcomes are bounded by the athlete's today", () => {
    it('rejects a missed outcome on a future session without shifting or recording anything', async () => {
      const edit = editable(program);
      edit.auto_shift = true;
      expect((await update(edit)).status).toBe(200);
      const before = await reload();
      setToday('2026-10-24');
      try {
        const response = await outcome(sessions(before)[0]!.id, {
          status: 'missed',
        });
        expect(response.status).toBe(409);
        expect(response.body.error).toMatch(/after today/);
      } finally {
        setToday(DEFAULT_TODAY);
      }
      expect(await reload()).toEqual(before);
    });

    it('accepts a missed outcome on the session day itself and after it', async () => {
      const [first, second] = sessions(program);
      setToday('2026-10-25');
      try {
        expect((await outcome(first!.id, { status: 'missed' })).status).toBe(
          200
        );
        expect((await outcome(second!.id, { status: 'missed' })).status).toBe(
          409
        );
      } finally {
        setToday(DEFAULT_TODAY);
      }
      expect((await outcome(second!.id, { status: 'missed' })).status).toBe(
        200
      );
    });

    it('evaluates today in the athlete timezone, not UTC', async () => {
      const db = await getSystemClient();
      try {
        await db.query(
          `INSERT INTO user_preferences(user_id, timezone) VALUES ($1, 'Pacific/Kiritimati')
           ON CONFLICT (user_id) DO UPDATE SET timezone = EXCLUDED.timezone`,
          [owner]
        );
      } finally {
        db.release();
      }
      // 2026-10-24T12:00Z is already 2026-10-25 (UTC+14) in Kiritimati.
      setToday('2026-10-24');
      try {
        const first = sessions(program)[0]!;
        expect((await outcome(first.id, { status: 'missed' })).status).toBe(
          200
        );
      } finally {
        setToday(DEFAULT_TODAY);
        const cleanup = await getSystemClient();
        try {
          await cleanup.query(
            'UPDATE user_preferences SET timezone = $2 WHERE user_id = $1',
            [owner, 'UTC']
          );
        } finally {
          cleanup.release();
        }
      }
    });

    it('does not require the date rule for completed outcomes', async () => {
      setToday('2026-10-24');
      try {
        const workout = await diaryWorkout('individual');
        expect(
          (
            await outcome(sessions(program)[0]!.id, {
              status: 'completed',
              workout,
            })
          ).status
        ).toBe(200);
      } finally {
        setToday(DEFAULT_TODAY);
      }
    });
  });

  it('serializes concurrent retry misses to one shift and competing completion links to one winner', async () => {
    const edit = editable(program);
    edit.auto_shift = true;
    expect((await update(edit)).status).toBe(200);
    const first = sessions(program)[0]!;
    const retries = await Promise.all([
      outcome(first.id, { status: 'missed' }),
      outcome(first.id, { status: 'missed' }),
    ]);
    expect(retries.map((item: { status: number }) => item.status)).toEqual([
      200, 200,
    ]);
    expect(sessions(await reload()).map((item) => item.effective_date)).toEqual(
      ['2026-10-25', '2026-10-31', '2026-11-02']
    );
    const workout = await diaryWorkout('preset');
    const competing = await Promise.all(
      sessions(program)
        .slice(1)
        .map((item) => outcome(item.id, { status: 'completed', workout }))
    );
    expect(
      competing.map((item: { status: number }) => item.status).sort()
    ).toEqual([200, 409]);
    expect(
      sessions(await reload())
        .filter((item) => item.status === 'completed')
        .map((item) => item.completed_workout?.id)
    ).toEqual([workout.id]);
  });
  it('binds repeated A labels to exact 2x8/3x8 prescriptions and isolates edits from other sessions and completed history', async () => {
    const exerciseId = await seedExercise();
    const plan = await createPlan({
      plan_name: 'Independently prescribed weeks',
      schedule_type: 'sequential',
      entry_mode: 'prompt',
      is_active: false,
      sessions: [2, 3].map((count, sort_order) => ({
        name: 'A',
        day_of_week: null,
        sort_order,
        assignments: [
          {
            exercise_id: exerciseId,
            sort_order: 0,
            sets: prescribedSets(count).map((set) => ({
              ...set,
              rpe: 7,
              rir: 2,
              rep_range: '8–10',
              per_side: true,
            })),
          },
        ],
      })),
    });
    const [a2, a3] = plan.sessions;
    expect(a2!.id).not.toBe(a3!.id);
    const reloadedPrescription = await reloadPlan(plan.id);
    expect(
      reloadedPrescription.sessions[0]!.assignments[0]!.sets
    ).toMatchObject(
      prescribedSets(2).map((set) => ({
        ...set,
        rpe: 7,
        rir: 2,
        rep_range: '8–10',
        per_side: true,
      }))
    );
    const input = editable(program);
    input.phases[0]!.weeks[0]!.sessions[0]!.workout_session_id = a2!.id;
    input.phases[1]!.weeks[0]!.sessions[0]!.workout_session_id = a3!.id;
    expect((await update(input)).status).toBe(200);
    const bound = await reload();
    expect(sessions(bound).map((item) => item.id)).toEqual(
      sessions(program).map((item) => item.id)
    );
    const first = sessions(bound)[0]!;
    const later = sessions(bound)[2]!;
    expect(first).toMatchObject({
      workout_session_id: a2!.id,
      workout_session_name: 'A',
      workout_plan_id: plan.id,
      workout_plan_name: plan.plan_name,
    });
    expect(later).toMatchObject({
      workout_session_id: a3!.id,
      workout_session_name: 'A',
      workout_plan_id: plan.id,
    });
    const laterStart = await startSession(
      later.workout_session_id,
      later.effective_date
    );
    const firstStart = await startSession(
      first.workout_session_id,
      first.effective_date
    );
    expect(laterStart.status).toBe(201);
    expect(firstStart.status).toBe(201);
    expect(laterStart.body).toMatchObject({
      workout_session_id: a3!.id,
      workout_session_name: 'A',
    });
    expect(firstStart.body).toMatchObject({
      workout_session_id: a2!.id,
      workout_session_name: 'A',
    });
    const firstWorkout = presetSessionResponseSchema.parse(
      firstStart.body.session
    );
    const laterWorkout = presetSessionResponseSchema.parse(
      laterStart.body.session
    );
    expect(firstWorkout.exercises).toHaveLength(1);
    expect(laterWorkout.exercises).toHaveLength(1);
    expect(firstWorkout.exercises[0]).toMatchObject({
      workout_plan_assignment_id: a2!.assignments[0]!.id,
      sets: prescribedSets(2),
    });
    expect(laterWorkout.exercises[0]).toMatchObject({
      workout_plan_assignment_id: a3!.assignments[0]!.id,
      sets: prescribedSets(3),
    });
    expect(
      firstWorkout.activity_details.find(
        (detail) => detail.detail_type === 'workout_plan_prescription'
      )?.detail_data
    ).toMatchObject({
      workout_session_id: a2!.id,
      assignments: [
        {
          sets: prescribedSets(2).map((set) => ({
            ...set,
            rpe: 7,
            rir: 2,
            rep_range: '8–10',
            per_side: true,
          })),
        },
      ],
    });
    const a2Diary = await diaryPrescription(
      a2!.assignments[0]!.id,
      first.effective_date
    );
    const a3Diary = await diaryPrescription(
      a3!.assignments[0]!.id,
      later.effective_date
    );
    expect(a2Diary).toHaveLength(1);
    expect(a3Diary).toHaveLength(1);
    expect(a2Diary[0].sets).toMatchObject(prescribedSets(2));
    expect(a3Diary[0].sets).toMatchObject(prescribedSets(3));
    expect(
      (
        await outcome(first.id, {
          status: 'completed',
          workout: { type: 'preset', id: firstWorkout.id },
        })
      ).status
    ).toBe(200);
    const completed = sessions(await reload())[0]!;
    const edit = planInput(await reloadPlan(plan.id));
    edit.sessions[0]!.assignments[0]!.sets = prescribedSets(4);
    const changed = await request(app)
      .put(`/api/workout-plan-templates/${plan.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(edit);
    expect(changed.status).toBe(200);
    const saved = await reloadPlan(plan.id);
    expect(saved.sessions[0]!.id).toBe(a2!.id);
    expect(saved.sessions[0]!.assignments[0]!.id).toBe(a2!.assignments[0]!.id);
    expect(saved.sessions[0]!.assignments[0]!.sets).toMatchObject(
      prescribedSets(4)
    );
    expect(saved.sessions[1]).toEqual(a3);
    expect(
      await diaryPrescription(a2!.assignments[0]!.id, first.effective_date)
    ).toEqual(a2Diary);
    expect(
      await diaryPrescription(a3!.assignments[0]!.id, later.effective_date)
    ).toEqual(a3Diary);
    expect(sessions(await reload())[0]).toEqual(completed);
    expect((await startSession(a2!.id, '2026-11-02')).status).toBe(201);
    expect(
      (await diaryPrescription(a2!.assignments[0]!.id, '2026-11-02'))[0].sets
    ).toMatchObject(prescribedSets(4));
  });

  it('rejects unknown, cross-owner and cross-plan session/assignment references without partial writes', async () => {
    const exerciseId = await seedExercise();
    const make = (name: string) =>
      createPlan({
        plan_name: name,
        schedule_type: 'sequential',
        is_active: false,
        sessions: [
          {
            name: 'A',
            day_of_week: null,
            sort_order: 0,
            assignments: [
              {
                exercise_id: exerciseId,
                sort_order: 0,
                sets: prescribedSets(2),
              },
            ],
          },
        ],
      });
    const left = await make('Left');
    const right = await make('Right');
    for (const id of [randomUUID(), foreignWorkoutSessionId]) {
      const input = editable(program);
      input.name = 'Atomic rejection';
      input.phases[0]!.weeks[0]!.sessions[0]!.workout_session_id = id;
      expect((await update(input)).status).toBe(400);
      expect(await reload()).toEqual(program);
      const before = await request(app)
        .get('/api/training-programs')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(
        (
          await request(app)
            .post('/api/training-programs')
            .set('Authorization', `Bearer ${ownerToken}`)
            .send(input)
        ).status
      ).toBe(400);
      expect(
        (
          await request(app)
            .get('/api/training-programs')
            .set('Authorization', `Bearer ${ownerToken}`)
        ).body
      ).toEqual(before.body);
    }
    for (const invalid of [
      { ...planInput(left), sessions: planInput(right).sessions },
      {
        ...planInput(left),
        sessions: [
          { ...planInput(left).sessions[0]!, id: foreignWorkoutSessionId },
        ],
      },
      {
        ...planInput(left),
        sessions: [
          {
            ...planInput(left).sessions[0]!,
            assignments: planInput(right).sessions[0]!.assignments,
          },
        ],
      },
    ]) {
      invalid.plan_name = 'Must roll back';
      const response = await request(app)
        .put(`/api/workout-plan-templates/${left.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(invalid);
      expect(response.status).toBe(400);
      expect(await reloadPlan(left.id)).toEqual(left);
      expect(await reloadPlan(right.id)).toEqual(right);
    }
    expect(
      (await startSession(left.sessions[0]!.id, '2026-10-25')).status
    ).toBe(201);
    const originalDiary = await diaryPrescription(
      left.sessions[0]!.assignments[0]!.id,
      '2026-10-25'
    );
    expect(originalDiary).toHaveLength(1);
    expect(originalDiary[0].sets).toMatchObject(prescribedSets(2));
    expect(
      (await startSession(left.sessions[0]!.id, '2026-10-25', outsiderToken))
        .status
    ).toBe(404);
    expect(
      await diaryPrescription(
        left.sessions[0]!.assignments[0]!.id,
        '2026-10-25'
      )
    ).toEqual(originalDiary);
    const sharedStart = await startSession(
      left.sessions[0]!.id,
      '2026-10-25',
      otherToken
    );
    expect(sharedStart.status).toBe(201);
    const sharedWorkout = presetSessionResponseSchema.parse(
      sharedStart.body.session
    );
    expect(sharedWorkout.exercises).toHaveLength(1);
    expect(sharedWorkout.exercises[0]).toMatchObject({
      workout_plan_assignment_id: left.sessions[0]!.assignments[0]!.id,
      sets: prescribedSets(2),
    });
    expect(
      await diaryPrescription(
        left.sessions[0]!.assignments[0]!.id,
        '2026-10-25'
      )
    ).toEqual(originalDiary);
    const sharedPersistence = await getSystemClient();
    try {
      expect(
        (
          await sharedPersistence.query(
            'SELECT user_id,workout_plan_assignment_id FROM exercise_entries WHERE exercise_preset_entry_id = $1',
            [sharedWorkout.id]
          )
        ).rows
      ).toEqual([
        {
          user_id: other,
          workout_plan_assignment_id: left.sessions[0]!.assignments[0]!.id,
        },
      ]);
      expect(
        (
          await sharedPersistence.query(
            'SELECT id FROM exercise_entries WHERE user_id = $1',
            [outsider]
          )
        ).rows
      ).toEqual([]);
      expect(
        (
          await sharedPersistence.query(
            'SELECT id FROM exercise_preset_entries WHERE user_id = $1',
            [outsider]
          )
        ).rows
      ).toEqual([]);
    } finally {
      sharedPersistence.release();
    }
    const sharedProgramInput = body();
    sharedProgramInput.phases.forEach((phase) =>
      phase.weeks.forEach((week) =>
        week.sessions.forEach((session) => {
          session.workout_session_id = left.sessions[0]!.id;
        })
      )
    );
    expect(
      (
        await request(app)
          .post('/api/training-programs')
          .set('Authorization', `Bearer ${otherToken}`)
          .send(sharedProgramInput)
      ).status
    ).toBe(400);
    expect(await reload()).toEqual(program);
    expect(
      (
        await request(app)
          .get('/api/training-programs')
          .set('Authorization', `Bearer ${otherToken}`)
      ).body
    ).toEqual([]);
    const ownerClient = await getClient(owner, owner);
    try {
      expect(
        (
          await ownerClient.query(
            'SELECT id FROM workout_plan_sessions WHERE id = $1',
            [foreignWorkoutSessionId]
          )
        ).rows
      ).toEqual([]);
    } finally {
      ownerClient.release();
    }
  });

  it.each(['weekly', 'sequential'] as const)(
    'executes frozen full preset prescriptions in a standalone %s plan after library mutation',
    async (schedule_type) => {
      const exerciseId = await seedExercise();
      const db = await getSystemClient();
      let presetId: number;
      try {
        presetId = (
          await db.query(
            `INSERT INTO workout_presets(user_id,name,description,workout_format)
         VALUES ($1,'Mutable library','Original library','standard') RETURNING id`,
            [owner]
          )
        ).rows[0].id;
      } finally {
        db.release();
      }
      const snapshot = {
        id: presetId!,
        name: 'Frozen unilateral strength',
        description: 'Keep local instructions',
        workout_format: 'emom' as const,
        time_cap_seconds: 600,
        exercises: [
          {
            id: 1,
            exercise_id: exerciseId,
            exercise_name: 'dumbbell split squat',
            category: 'Strength',
            modality: 'weight_reps' as const,
            image_url: null,
            sort_order: 0,
            superset_group: 1,
            progression_mode: 'manual' as const,
            rep_goal: null,
            increment_type: null,
            increment_value: null,
            equipment_brand: 'Dumbbells',
            ramp_increment: null,
            sets: [
              { ...prescribedSets(1)[0]!, id: 1 },
              {
                id: 2,
                set_number: 2,
                set_type: 'duration_distance',
                reps: null,
                weight: null,
                duration: 45,
                distance: 0.2,
                rest_time: 30,
                notes: '45 seconds each side; easy effort',
              },
            ].map((set) => ({
              ...set,
              rpe: 7,
              rir: 2,
              rep_range: '8–10',
              effort: 'Controlled; each side',
            })),
          },
        ],
      };
      const normalizedSnapshot = {
        ...snapshot,
        exercises: snapshot.exercises.map((exercise) => ({
          ...exercise,
          exercise_name:
            exercise.exercise_name.slice(0, 1).toUpperCase() +
            exercise.exercise_name.slice(1),
        })),
      };
      const plan = await createPlan({
        plan_name: `Standalone frozen ${schedule_type}`,
        schedule_type,
        entry_mode: 'prompt',
        is_active: false,
        sessions: [
          {
            name: 'A',
            day_of_week: schedule_type === 'weekly' ? 0 : null,
            sort_order: 0,
            assignments: [
              {
                workout_preset_id: presetId!,
                sort_order: 0,
                preset_snapshot: snapshot,
              },
            ],
          },
        ],
      });
      const mutate = await getSystemClient();
      try {
        await mutate.query(
          "UPDATE workout_presets SET name = 'Changed library', description = 'Changed', workout_format = 'tabata' WHERE id = $1",
          [presetId!]
        );
        await mutate.query(
          "UPDATE exercises SET name = 'Renamed live exercise' WHERE id = $1",
          [exerciseId]
        );
      } finally {
        mutate.release();
      }
      const loaded = await reloadPlan(plan.id);
      const assignment = loaded.sessions[0]!.assignments[0]!;
      expect(assignment.preset_snapshot).toEqual(normalizedSnapshot);
      expect(assignment.workout_preset_name).toBe(snapshot.name);
      expect(assignment.workout_preset_format).toBe(snapshot.workout_format);
      const started = await startSession(loaded.sessions[0]!.id, '2026-10-25');
      expect(started.status).toBe(201);
      const startedWorkout = presetSessionResponseSchema.parse(
        started.body.session
      );
      expect(started.body).toMatchObject({
        workout_session_id: loaded.sessions[0]!.id,
        workout_session_name: 'A',
      });
      expect(startedWorkout.name).toBe('A');
      expect(startedWorkout.exercises).toHaveLength(1);
      expect(startedWorkout.exercises[0]?.exercise_snapshot?.name).toBe(
        normalizedSnapshot.exercises[0]!.exercise_name
      );
      const frozenPrescription = startedWorkout.activity_details.find(
        (detail) => detail.detail_type === 'workout_plan_prescription'
      );
      expect(frozenPrescription?.detail_data).toMatchObject({
        workout_session_id: loaded.sessions[0]!.id,
        assignments: [{ preset_snapshot: normalizedSnapshot }],
      });
      const logged = await diaryPrescription(assignment.id, '2026-10-25');
      expect(logged).toHaveLength(1);
      expect(logged[0].entry.exercise_name).toBe(
        normalizedSnapshot.exercises[0]!.exercise_name
      );
      expect(logged[0].sets).toMatchObject(
        snapshot.exercises[0]!.sets.map(
          ({ id: _id, rep_range: _range, effort: _effort, ...set }) => set
        )
      );
      const history = await getSystemClient();
      try {
        const preset = await history.query(
          'SELECT name,workout_format FROM exercise_preset_entries WHERE id = $1',
          [startedWorkout.id]
        );
        expect(preset.rows).toEqual([
          { name: 'A', workout_format: snapshot.workout_format },
        ]);
        expect(
          (
            await history.query(
              'SELECT id FROM training_program_sessions WHERE workout_session_id = $1',
              [loaded.sessions[0]!.id]
            )
          ).rows
        ).toEqual([]);
      } finally {
        history.release();
      }
      const removeLibrary = await getSystemClient();
      try {
        await removeLibrary.query('DELETE FROM workout_presets WHERE id = $1', [
          presetId!,
        ]);
        expect(
          (
            await removeLibrary.query(
              'SELECT id FROM workout_presets WHERE id = $1',
              [presetId!]
            )
          ).rows
        ).toEqual([]);
      } finally {
        removeLibrary.release();
      }
      const orphaned = await reloadPlan(plan.id);
      expect(orphaned.sessions[0]!.assignments[0]!.id).toBe(assignment.id);
      expect(
        orphaned.sessions[0]!.assignments[0]!.workout_preset_id
      ).toBeNull();
      expect(orphaned.sessions[0]!.assignments[0]!.preset_snapshot).toEqual(
        normalizedSnapshot
      );
      const afterDelete = await startSession(
        orphaned.sessions[0]!.id,
        '2026-11-01'
      );
      expect(afterDelete.status).toBe(201);
      const afterDeleteWorkout = presetSessionResponseSchema.parse(
        afterDelete.body.session
      );
      expect(afterDelete.body).toMatchObject({
        workout_session_id: orphaned.sessions[0]!.id,
        workout_session_name: 'A',
      });
      expect(afterDeleteWorkout.exercises).toHaveLength(1);
      expect(afterDeleteWorkout.exercises[0]).toMatchObject({
        exercise_snapshot: {
          name: normalizedSnapshot.exercises[0]!.exercise_name,
        },
        workout_plan_assignment_id: assignment.id,
        sets: snapshot.exercises[0]!.sets.map(
          ({ id: _id, rep_range: _range, effort: _effort, ...set }) => set
        ),
      });
      expect(
        afterDeleteWorkout.activity_details.find(
          (detail) => detail.detail_type === 'workout_plan_prescription'
        )?.detail_data
      ).toMatchObject({
        assignments: [{ preset_snapshot: normalizedSnapshot }],
      });
      expect(await diaryPrescription(assignment.id, '2026-10-25')).toEqual(
        logged
      );
      const newHistory = await getSystemClient();
      try {
        expect(
          (
            await newHistory.query(
              'SELECT workout_format FROM exercise_preset_entries WHERE id = $1',
              [afterDeleteWorkout.id]
            )
          ).rows
        ).toEqual([{ workout_format: snapshot.workout_format }]);
      } finally {
        newHistory.release();
      }
    }
  );
  it.each(['weekly', 'sequential'] as const)(
    'selects standalone %s sessions by weekday or completed session order',
    async (schedule_type) => {
      const exerciseId = await seedExercise();
      const plan = await createPlan({
        plan_name: `Standalone progression ${schedule_type}`,
        schedule_type,
        is_active: true,
        entry_mode: 'prompt',
        start_date: '2026-10-25',
        end_date: '2026-11-07',
        sessions: [2, 3].map((count, sort_order) => ({
          name: 'A',
          day_of_week: schedule_type === 'weekly' ? sort_order : null,
          sort_order,
          assignments: [
            {
              exercise_id: exerciseId,
              sort_order: 0,
              sets: prescribedSets(count),
            },
          ],
        })),
      });
      const firstResponse = await request(app)
        .get('/api/workout-plan-templates/active/2026-10-25')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(firstResponse.status).toBe(200);
      const first = workoutPlanResponseSchema.parse(
        firstResponse.body.find((item: { id: number }) => item.id === plan.id)
      );
      expect(first.next_session?.id).toBe(plan.sessions[0]!.id);
      expect(first.next_assignments).toMatchObject(
        plan.sessions[0]!.assignments
      );
      // Upstream App Store v1.8.0 reads these legacy fields to show due plans.
      const legacyFirst = firstResponse.body.find(
        (item: { id: number }) => item.id === plan.id
      );
      expect(legacyFirst.assignments).toEqual([
        expect.objectContaining({
          id: plan.sessions[0]!.assignments[0]!.id,
          template_id: plan.id,
          day_of_week: schedule_type === 'weekly' ? 0 : null,
          session_index: schedule_type === 'sequential' ? 1 : null,
          session_name: 'A',
        }),
        expect.objectContaining({
          id: plan.sessions[1]!.assignments[0]!.id,
          template_id: plan.id,
          day_of_week: schedule_type === 'weekly' ? 1 : null,
          session_index: schedule_type === 'sequential' ? 2 : null,
          session_name: 'A',
        }),
      ]);
      expect(legacyFirst.next_assignment).toMatchObject({
        id: plan.sessions[0]!.assignments[0]!.id,
        session_index: schedule_type === 'sequential' ? 1 : null,
      });
      expect(legacyFirst.next_assignments[0]).toMatchObject(
        legacyFirst.next_assignment
      );
      expect(
        (await startSession(first.next_session!.id, '2026-10-25')).status
      ).toBe(201);
      const secondResponse = await request(app)
        .get(
          `/api/workout-plan-templates/active/${schedule_type === 'weekly' ? '2026-10-26' : '2026-10-25'}`
        )
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(secondResponse.status).toBe(200);
      const second = workoutPlanResponseSchema.parse(
        secondResponse.body.find((item: { id: number }) => item.id === plan.id)
      );
      expect(second.next_session?.id).toBe(plan.sessions[1]!.id);
      expect(second.next_assignments).toMatchObject(
        plan.sessions[1]!.assignments
      );
      if (schedule_type === 'sequential') {
        expect(second.sequence_position).toEqual({
          current: 2,
          total: 2,
          session_name: 'A',
        });
        expect(
          (await startSession(second.next_session!.id, '2026-10-26')).status
        ).toBe(201);
        const wrappedResponse = await request(app)
          .get('/api/workout-plan-templates/active/2026-10-27')
          .set('Authorization', `Bearer ${ownerToken}`);
        expect(wrappedResponse.status).toBe(200);
        const wrapped = workoutPlanResponseSchema.parse(
          wrappedResponse.body.find(
            (item: { id: number }) => item.id === plan.id
          )
        );
        expect(wrapped.next_session?.id).toBe(plan.sessions[0]!.id);
        expect(wrapped.sequence_position).toEqual({
          current: 1,
          total: 2,
          session_name: 'A',
        });
      } else {
        const restResponse = await request(app)
          .get('/api/workout-plan-templates/active/2026-10-27')
          .set('Authorization', `Bearer ${ownerToken}`);
        expect(restResponse.status).toBe(200);
        const rest = workoutPlanResponseSchema.parse(
          restResponse.body.find((item: { id: number }) => item.id === plan.id)
        );
        expect(rest.next_session).toBeNull();
        expect(rest.next_assignments).toEqual([]);
      }
    }
  );
  it('serves a single-session plan with the upstream App Store assignment contract', async () => {
    const exerciseId = await seedExercise();
    const plan = await createPlan({
      plan_name: 'Single workout',
      schedule_type: 'weekly',
      is_active: true,
      start_date: '2026-10-25',
      sessions: [
        {
          name: 'Sunday workout',
          day_of_week: 0,
          sort_order: 0,
          assignments: [
            { exercise_id: exerciseId, sort_order: 0, sets: prescribedSets(2) },
          ],
        },
      ],
    });
    const response = await request(app)
      .get('/api/workout-plan-templates/active/2026-10-25')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(response.status).toBe(200);
    const active = response.body.find(
      (item: { id: number }) => item.id === plan.id
    );
    expect(active.sessions).toHaveLength(1);
    expect(active.assignments).toHaveLength(1);
    expect(active.next_assignment).toMatchObject({
      id: plan.sessions[0]!.assignments[0]!.id,
      template_id: plan.id,
      day_of_week: 0,
      session_index: null,
      session_name: 'Sunday workout',
      sets: [
        expect.objectContaining({ reps: 8 }),
        expect.objectContaining({ reps: 8 }),
      ],
    });
    expect(active.next_assignments).toEqual([active.next_assignment]);
  });

  it('transactionally prefills only missing weekly diary entries while preserving incomplete snapshots and stable set IDs across repeated saves', async () => {
    setToday('2026-10-25');
    const exerciseId = await seedExercise();
    const additionalExerciseId = await seedExercise();
    const created = await createPlan({
      plan_name: 'Weekly transactional prefill',
      schedule_type: 'weekly',
      entry_mode: 'prefill',
      is_active: true,
      start_date: '2026-10-25',
      end_date: '2026-11-01',
      currentClientDate: '2026-10-25',
      sessions: [
        {
          name: 'A',
          day_of_week: 0,
          sort_order: 0,
          assignments: [
            { exercise_id: exerciseId, sort_order: 0, sets: prescribedSets(2) },
          ],
        },
      ],
    });
    const originalAssignment = created.sessions[0]!.assignments[0]!;
    const originalSetIds = originalAssignment.sets.map((set) => set.id);
    expect(originalSetIds).toHaveLength(2);
    expect(originalSetIds.every((id) => typeof id === 'number')).toBe(true);
    const firstDiary = await diaryPrescription(
      originalAssignment.id,
      '2026-10-25'
    );
    const nextDiary = await diaryPrescription(
      originalAssignment.id,
      '2026-11-01'
    );
    expect(firstDiary).toHaveLength(1);
    expect(nextDiary).toHaveLength(1);
    expect(firstDiary[0].sets).toMatchObject(prescribedSets(2));
    expect(nextDiary[0].sets).toMatchObject(prescribedSets(2));
    expect(
      firstDiary[0].sets.every(
        (set: { completed_at: string | null }) => set.completed_at === null
      )
    ).toBe(true);
    const edited = planInput(await reloadPlan(created.id));
    edited.currentClientDate = '2026-10-25';
    edited.end_date = '2026-11-08';
    // Omit set IDs deliberately: matching by set_number must preserve identity.
    edited.sessions[0]!.assignments[0]!.sets = prescribedSets(2).map((set) => ({
      ...set,
      reps: 10,
      distance: 0.15,
      rpe: 8,
      rir: 2,
      rep_range: '8–10',
      per_side: true,
      notes: '10 each side; future prescription only',
    }));
    edited.sessions[0]!.assignments.push({
      exercise_id: additionalExerciseId,
      sort_order: 1,
      sets: prescribedSets(3),
    });
    const savedResponse = await request(app)
      .put(`/api/workout-plan-templates/${created.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(edited);
    expect(savedResponse.status).toBe(200);
    const saved = await reloadPlan(created.id);
    const retained = saved.sessions[0]!.assignments[0]!;
    const added = saved.sessions[0]!.assignments[1]!;
    expect(saved.sessions[0]!.id).toBe(created.sessions[0]!.id);
    expect(retained.id).toBe(originalAssignment.id);
    expect(retained.sets.map((set) => set.id)).toEqual(originalSetIds);
    expect(retained.sets).toMatchObject(
      edited.sessions[0]!.assignments[0]!.sets!
    );
    expect(await diaryPrescription(retained.id, '2026-10-25')).toEqual(
      firstDiary
    );
    expect(await diaryPrescription(retained.id, '2026-11-01')).toEqual(
      nextDiary
    );
    const missingDate = await diaryPrescription(retained.id, '2026-11-08');
    expect(missingDate).toHaveLength(1);
    expect(missingDate[0].sets).toMatchObject(
      prescribedSets(2).map((set) => ({
        ...set,
        reps: 10,
        distance: 0.15,
        rpe: 8,
        rir: 2,
        notes: '10 each side; future prescription only',
      }))
    );
    const addedDates = [];
    for (const date of ['2026-10-25', '2026-11-01', '2026-11-08']) {
      const entries = await diaryPrescription(added.id, date);
      expect(entries).toHaveLength(1);
      expect(entries[0].sets).toMatchObject(prescribedSets(3));
      addedDates.push(entries);
    }
    const repeat = planInput(saved);
    repeat.currentClientDate = '2026-10-25';
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(
        (
          await request(app)
            .put(`/api/workout-plan-templates/${created.id}`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send(repeat)
        ).status
      ).toBe(200);
      expect((await reloadPlan(created.id)).sessions).toEqual(saved.sessions);
      expect(await diaryPrescription(retained.id, '2026-10-25')).toEqual(
        firstDiary
      );
      expect(await diaryPrescription(retained.id, '2026-11-01')).toEqual(
        nextDiary
      );
      expect(await diaryPrescription(retained.id, '2026-11-08')).toEqual(
        missingDate
      );
      for (const [index, date] of [
        '2026-10-25',
        '2026-11-01',
        '2026-11-08',
      ].entries()) {
        expect(await diaryPrescription(added.id, date)).toEqual(
          addedDates[index]
        );
      }
    }
    const beforeFailure = await reloadPlan(created.id);
    const rejected = planInput(beforeFailure);
    rejected.currentClientDate = '2026-10-25';
    rejected.plan_name = 'Must not persist';
    rejected.end_date = '2026-11-15';
    rejected.sessions[0]!.assignments[0]!.sets = prescribedSets(4);
    rejected.sessions.push({
      id: foreignWorkoutSessionId,
      name: 'Invalid foreign session',
      day_of_week: 0,
      sort_order: 1,
      assignments: [
        { exercise_id: exerciseId, sort_order: 0, sets: prescribedSets(1) },
      ],
    });
    const failedResponse = await request(app)
      .put(`/api/workout-plan-templates/${created.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(rejected);
    expect(failedResponse.status).toBe(400);
    expect(await reloadPlan(created.id)).toEqual(beforeFailure);
    expect(await diaryPrescription(retained.id, '2026-10-25')).toEqual(
      firstDiary
    );
    expect(await diaryPrescription(retained.id, '2026-11-01')).toEqual(
      nextDiary
    );
    expect(await diaryPrescription(retained.id, '2026-11-08')).toEqual(
      missingDate
    );
    expect(await diaryPrescription(retained.id, '2026-11-15')).toEqual([]);
    expect(await diaryPrescription(added.id, '2026-11-15')).toEqual([]);
    for (const [index, date] of [
      '2026-10-25',
      '2026-11-01',
      '2026-11-08',
    ].entries()) {
      expect(await diaryPrescription(added.id, date)).toEqual(
        addedDates[index]
      );
    }
  });
  it.each(['incomplete', 'completed'] as const)(
    'protects assignment/session history and deletes only eligible plans (%s diary history)',
    async (status) => {
      setToday('2026-10-25');
      const exerciseId = await seedExercise();
      const plan = await createPlan({
        plan_name: `Protected ${status} history`,
        schedule_type: 'weekly',
        entry_mode: 'prefill',
        is_active: true,
        start_date: '2026-10-25',
        end_date: '2026-10-25',
        currentClientDate: '2026-10-25',
        sessions: [
          {
            name: 'A',
            day_of_week: 0,
            sort_order: 0,
            assignments: [
              {
                exercise_id: exerciseId,
                sort_order: 0,
                sets: prescribedSets(2),
              },
            ],
          },
        ],
      });
      const assignment = plan.sessions[0]!.assignments[0]!;
      const diary = await diaryPrescription(assignment.id, '2026-10-25');
      expect(diary).toHaveLength(1);
      expect(diary[0].entry.workout_plan_assignment_id).toBe(assignment.id);
      expect(diary[0].sets).toMatchObject(prescribedSets(2));
      if (status === 'completed') {
        const bind = editable(program);
        bind.phases[0]!.weeks[0]!.sessions[0]!.workout_session_id =
          plan.sessions[0]!.id;
        expect((await update(bind)).status).toBe(200);
        const first = sessions(await reload())[0]!;
        const workout = diary[0].entry.exercise_preset_entry_id
          ? { type: 'preset', id: diary[0].entry.exercise_preset_entry_id }
          : { type: 'individual', id: diary[0].entry.id };
        expect(
          (await outcome(first.id, { status: 'completed', workout })).status
        ).toBe(200);
      }
      const savedProgram = await reload();
      const savedPlan = await reloadPlan(plan.id);
      const removeAssignment = planInput(savedPlan);
      removeAssignment.currentClientDate = '2026-10-25';
      removeAssignment.plan_name = 'Assignment removal must roll back';
      removeAssignment.sessions[0]!.assignments = [];
      const removeSession = planInput(savedPlan);
      removeSession.currentClientDate = '2026-10-25';
      removeSession.plan_name = 'Session removal must roll back';
      removeSession.sessions = [];
      for (const input of [removeAssignment, removeSession]) {
        const rejected = await request(app)
          .put(`/api/workout-plan-templates/${plan.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send(input);
        expect(rejected.status).toBe(409);
        expect(await reloadPlan(plan.id)).toEqual(savedPlan);
        expect(await reload()).toEqual(savedProgram);
        expect(await diaryPrescription(assignment.id, '2026-10-25')).toEqual(
          diary
        );
      }
      const deleted = await request(app)
        .delete(`/api/workout-plan-templates/${plan.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      const shouldDeletePlan = status === 'incomplete';
      expect(deleted.status).toBe(shouldDeletePlan ? 200 : 409);
      expect(await reload()).toEqual(savedProgram);
      if (shouldDeletePlan) {
        const missingPlan = await request(app)
          .get(`/api/workout-plan-templates/${plan.id}`)
          .set('Authorization', `Bearer ${ownerToken}`);
        expect(missingPlan.status).toBe(404);
        expect(await diaryPrescription(assignment.id, '2026-10-25')).toEqual(
          []
        );
      } else {
        expect(await reloadPlan(plan.id)).toEqual(savedPlan);
        expect(await diaryPrescription(assignment.id, '2026-10-25')).toEqual(
          diary
        );
      }
      const db = await getSystemClient();
      try {
        expect(
          (
            await db.query(
              'SELECT workout_plan_assignment_id FROM exercise_entries WHERE id = $1',
              [diary[0].entry.id]
            )
          ).rows
        ).toEqual(
          shouldDeletePlan
            ? []
            : [{ workout_plan_assignment_id: assignment.id }]
        );
        expect(
          (
            await db.query(
              'SELECT id FROM workout_plan_template_assignments WHERE id = $1',
              [assignment.id]
            )
          ).rows
        ).toEqual(shouldDeletePlan ? [] : [{ id: assignment.id }]);
      } finally {
        db.release();
      }
    }
  );
  it.each(['weekly', 'sequential'] as const)(
    'requires all diary-linked assignment IDs for %s completion and counts preset children as one assignment without requiring completed sets',
    async (schedule_type) => {
      const exerciseId = await seedExercise();
      const secondExerciseId = await seedExercise();
      const db = await getSystemClient();
      let presetId: number;
      try {
        presetId = (
          await db.query(
            "INSERT INTO workout_presets(user_id,name,description) VALUES ($1,'Two-child preset','Completion identity fixture') RETURNING id",
            [owner]
          )
        ).rows[0].id;
      } finally {
        db.release();
      }
      const plan = await createPlan({
        plan_name: `All assignment completion ${schedule_type}`,
        schedule_type,
        is_active: true,
        entry_mode: 'prompt',
        start_date: '2026-10-25',
        end_date: '2026-10-25',
        sessions: [
          {
            name: 'A',
            day_of_week: schedule_type === 'weekly' ? 0 : null,
            sort_order: 0,
            assignments: [
              {
                workout_preset_id: presetId!,
                sort_order: 0,
                preset_snapshot: {
                  id: presetId!,
                  name: 'Two-child preset',
                  description: 'Completion identity fixture',
                  workout_format: 'standard',
                  exercises: [exerciseId, secondExerciseId].map(
                    (id, index) => ({
                      id: index + 1,
                      exercise_id: id,
                      exercise_name: `Prescribed movement ${index + 1}`,
                      category: 'Strength',
                      image_url: null,
                      superset_group: null,
                      sets: prescribedSets(1),
                    })
                  ),
                },
              },
              {
                exercise_id: exerciseId,
                sort_order: 1,
                sets: prescribedSets(1),
              },
            ],
          },
          {
            name: 'B',
            day_of_week: schedule_type === 'weekly' ? 0 : null,
            sort_order: 1,
            assignments: [
              {
                exercise_id: secondExerciseId,
                sort_order: 0,
                sets: prescribedSets(1),
              },
            ],
          },
        ],
      });
      const first = plan.sessions[0]!;
      const presetAssignment = first.assignments[0]!;
      const individualAssignment = first.assignments[1]!;
      async function activeSession() {
        const response = await request(app)
          .get('/api/workout-plan-templates/active/2026-10-25')
          .set('Authorization', `Bearer ${ownerToken}`);
        expect(response.status).toBe(200);
        return workoutPlanResponseSchema.parse(
          response.body.find((item: { id: number }) => item.id === plan.id)
        );
      }
      expect((await activeSession()).next_session?.id).toBe(first.id);
      const history = await getSystemClient();
      try {
        const parent = (
          await history.query(
            "INSERT INTO exercise_preset_entries(user_id,name,entry_date,source) VALUES ($1,'Partially logged A','2026-10-25','Workout Plan') RETURNING id",
            [owner]
          )
        ).rows[0].id;
        for (const [index, exercise] of [
          exerciseId,
          secondExerciseId,
        ].entries()) {
          const child = (
            await history.query(
              `INSERT INTO exercise_entries(user_id,exercise_id,exercise_name,entry_date,duration_minutes,calories_burned,source,workout_plan_assignment_id,exercise_preset_entry_id)
           VALUES ($1,$2,$3,'2026-10-25',0,0,'Workout Plan',$4,$5) RETURNING id`,
              [
                owner,
                exercise,
                `Prescribed movement ${index + 1}`,
                presetAssignment.id,
                parent,
              ]
            )
          ).rows[0].id;
          await history.query(
            'INSERT INTO exercise_entry_sets(exercise_entry_id,set_number,reps,completed_at) VALUES ($1,1,8,null)',
            [child]
          );
          // One or two children both link only the preset assignment. Neither
          // can stand in for the still-missing individual assignment.
          const partial = await activeSession();
          expect(partial.next_session?.id).toBe(first.id);
          expect(
            partial.next_assignments?.map((assignment) => assignment.id)
          ).toEqual([presetAssignment.id, individualAssignment.id]);
        }
        expect(
          (
            await history.query(
              'SELECT COUNT(DISTINCT workout_plan_assignment_id)::int AS assignments, COUNT(*)::int AS children FROM exercise_entries WHERE user_id = $1 AND workout_plan_assignment_id = $2',
              [owner, presetAssignment.id]
            )
          ).rows
        ).toEqual([{ assignments: 1, children: 2 }]);
        const last = (
          await history.query(
            `INSERT INTO exercise_entries(user_id,exercise_id,exercise_name,entry_date,duration_minutes,calories_burned,source,workout_plan_assignment_id)
         VALUES ($1,$2,'Individual prescription','2026-10-25',0,0,'Workout Plan',$3) RETURNING id`,
            [owner, exerciseId, individualAssignment.id]
          )
        ).rows[0].id;
        await history.query(
          'INSERT INTO exercise_entry_sets(exercise_entry_id,set_number,reps,completed_at) VALUES ($1,1,8,null)',
          [last]
        );
        expect(
          (
            await history.query(
              `SELECT s.completed_at FROM exercise_entry_sets s JOIN exercise_entries e ON e.id = s.exercise_entry_id
         WHERE e.user_id = $1 AND e.workout_plan_assignment_id = ANY($2::int[])`,
              [owner, [presetAssignment.id, individualAssignment.id]]
            )
          ).rows
        ).toEqual([
          { completed_at: null },
          { completed_at: null },
          { completed_at: null },
        ]);
        const complete = await activeSession();
        expect(complete.next_session?.id).toBe(plan.sessions[1]!.id);
        expect(complete.next_assignments).toEqual(
          plan.sessions[1]!.assignments.map((assignment) =>
            expect.objectContaining({
              ...assignment,
              template_id: plan.id,
              day_of_week: plan.sessions[1]!.day_of_week,
              session_index: schedule_type === 'sequential' ? 2 : null,
              session_name: 'B',
            })
          )
        );
        if (schedule_type === 'sequential')
          expect(complete.sequence_position).toEqual({
            current: 2,
            total: 2,
            session_name: 'B',
          });
      } finally {
        history.release();
      }
    }
  );
  it('advances once for a started multi-child preset assignment and wraps only after starting the second sequential session', async () => {
    const exerciseId = await seedExercise();
    const secondExerciseId = await seedExercise();
    const seed = await getSystemClient();
    let presetId: number;
    try {
      presetId = (
        await seed.query(
          "INSERT INTO workout_presets(user_id,name,description) VALUES ($1,'Sequential two-child preset','One assignment occurrence') RETURNING id",
          [owner]
        )
      ).rows[0].id;
    } finally {
      seed.release();
    }
    const plan = await createPlan({
      plan_name: 'Sequential preset occurrence',
      schedule_type: 'sequential',
      entry_mode: 'prompt',
      is_active: true,
      start_date: '2026-10-25',
      end_date: '2026-11-07',
      sessions: [
        {
          name: 'A',
          day_of_week: null,
          sort_order: 0,
          assignments: [
            {
              workout_preset_id: presetId!,
              sort_order: 0,
              preset_snapshot: {
                id: presetId!,
                name: 'Sequential two-child preset',
                description: 'One assignment occurrence',
                workout_format: 'standard',
                exercises: [exerciseId, secondExerciseId].map((id, index) => ({
                  id: index + 1,
                  exercise_id: id,
                  exercise_name: `Frozen movement ${index + 1}`,
                  category: 'Strength',
                  image_url: null,
                  superset_group: null,
                  sets: prescribedSets(1),
                })),
              },
            },
          ],
        },
        {
          name: 'B',
          day_of_week: null,
          sort_order: 1,
          assignments: [
            { exercise_id: exerciseId, sort_order: 0, sets: prescribedSets(3) },
          ],
        },
      ],
    });
    const firstStart = await startSession(plan.sessions[0]!.id, '2026-10-25');
    expect(firstStart.status).toBe(201);
    const firstWorkout = presetSessionResponseSchema.parse(
      firstStart.body.session
    );
    expect(firstWorkout.exercises).toHaveLength(2);
    expect(
      firstWorkout.exercises.map(
        (exercise) => exercise.workout_plan_assignment_id
      )
    ).toEqual([
      plan.sessions[0]!.assignments[0]!.id,
      plan.sessions[0]!.assignments[0]!.id,
    ]);
    const firstDiary = await diaryPrescription(
      plan.sessions[0]!.assignments[0]!.id,
      '2026-10-25'
    );
    expect(firstDiary).toHaveLength(2);
    for (const child of firstDiary)
      expect(child.sets).toMatchObject([
        { set_number: 1, reps: 8, completed_at: null },
      ]);
    const nextResponse = await request(app)
      .get('/api/workout-plan-templates/active/2026-10-25')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(nextResponse.status).toBe(200);
    const next = workoutPlanResponseSchema.parse(
      nextResponse.body.find((item: { id: number }) => item.id === plan.id)
    );
    expect(next.next_session?.id).toBe(plan.sessions[1]!.id);
    expect(next.sequence_position).toEqual({
      current: 2,
      total: 2,
      session_name: 'B',
    });
    const secondStart = await startSession(next.next_session!.id, '2026-10-26');
    expect(secondStart.status).toBe(201);
    const secondWorkout = presetSessionResponseSchema.parse(
      secondStart.body.session
    );
    expect(secondWorkout.exercises).toHaveLength(1);
    expect(secondWorkout.exercises[0]).toMatchObject({
      workout_plan_assignment_id: plan.sessions[1]!.assignments[0]!.id,
      sets: prescribedSets(3),
    });
    const secondDiary = await diaryPrescription(
      plan.sessions[1]!.assignments[0]!.id,
      '2026-10-26'
    );
    expect(secondDiary).toHaveLength(1);
    expect(
      secondDiary[0].sets.every(
        (set: { completed_at: string | null }) => set.completed_at === null
      )
    ).toBe(true);
    const wrappedResponse = await request(app)
      .get('/api/workout-plan-templates/active/2026-10-26')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(wrappedResponse.status).toBe(200);
    const wrapped = workoutPlanResponseSchema.parse(
      wrappedResponse.body.find((item: { id: number }) => item.id === plan.id)
    );
    expect(wrapped.next_session?.id).toBe(plan.sessions[0]!.id);
    expect(wrapped.sequence_position).toEqual({
      current: 1,
      total: 2,
      session_name: 'A',
    });
    expect(
      await diaryPrescription(
        plan.sessions[0]!.assignments[0]!.id,
        '2026-10-25'
      )
    ).toEqual(firstDiary);
    expect(
      await diaryPrescription(
        plan.sessions[1]!.assignments[0]!.id,
        '2026-10-26'
      )
    ).toEqual(secondDiary);
  });
  it('freezes exact prescription identity on generic workout completion while keeping performed results and rejecting foreign or mixed links atomically', async () => {
    const exerciseId = await seedExercise();
    const secondExerciseId = await seedExercise();
    const db = await getSystemClient();
    let presetId: number;
    try {
      presetId = (
        await db.query(
          "INSERT INTO workout_presets(user_id,name,description,workout_format) VALUES ($1,'Generic completion library','Mutable library','standard') RETURNING id",
          [owner]
        )
      ).rows[0].id;
    } finally {
      db.release();
    }
    const snapshot = {
      id: presetId!,
      name: 'Authored frozen prescription',
      description: 'Not performed results',
      workout_format: 'emom' as const,
      exercises: [exerciseId, secondExerciseId].map((id, index) => ({
        id: index + 1,
        exercise_id: id,
        exercise_name: `Frozen original movement ${index + 1}`,
        category: 'Strength',
        image_url: null,
        superset_group: null,
        sets: prescribedSets(1).map((set) => ({
          ...set,
          rpe: 7,
          rir: 2,
          rep_range: '8–10',
          per_side: true,
        })),
      })),
    };
    const plan = await createPlan({
      plan_name: 'Generic completion contract',
      schedule_type: 'sequential',
      is_active: false,
      sessions: [
        {
          name: 'A',
          day_of_week: null,
          sort_order: 0,
          assignments: [
            {
              workout_preset_id: presetId!,
              sort_order: 0,
              preset_snapshot: snapshot,
            },
          ],
        },
        {
          name: 'B',
          day_of_week: null,
          sort_order: 1,
          assignments: [
            { exercise_id: exerciseId, sort_order: 0, sets: prescribedSets(3) },
          ],
        },
      ],
    });
    const assignment = plan.sessions[0]!.assignments[0]!;
    const performed = {
      workout_preset_id: null,
      entry_date: '2026-10-25',
      name: 'A',
      source: 'Workout Plan',
      exercises: [exerciseId, secondExerciseId].map((id, sort_order) => ({
        exercise_id: id,
        sort_order,
        duration_minutes: 0,
        workout_plan_assignment_id: assignment.id,
        sets: prescribedSets(1).map((set) => ({
          ...set,
          reps: 9,
          rpe: 8,
          rir: 1,
          notes: 'Performed 9 each side',
        })),
      })),
    };
    const createdResponse = await request(app)
      .post('/api/exercise-preset-entries')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(performed);
    expect(createdResponse.status).toBe(201);
    const completed = presetSessionResponseSchema.parse(createdResponse.body);
    expect(completed.exercises).toHaveLength(2);
    const originalPrescription = completed.activity_details.find(
      (detail) => detail.detail_type === 'workout_plan_prescription'
    )?.detail_data;
    expect(originalPrescription).toMatchObject({
      workout_session_id: plan.sessions[0]!.id,
      workout_session_name: 'A',
      assignments: [{ id: assignment.id, preset_snapshot: snapshot }],
    });
    for (const [index, exercise] of completed.exercises.entries()) {
      expect(exercise.exercise_snapshot?.name).toBe(
        snapshot.exercises[index]!.exercise_name
      );
      expect(exercise.workout_plan_assignment_id).toBe(assignment.id);
      expect(exercise.sets).toMatchObject(performed.exercises[index]!.sets);
    }
    const originalDiary = await diaryPrescription(assignment.id, '2026-10-25');
    const sharedCompletionResponse = await request(app)
      .post('/api/exercise-preset-entries')
      .set('Authorization', `Bearer ${otherToken}`)
      .send(performed);
    expect(sharedCompletionResponse.status).toBe(201);
    const sharedCompletion = presetSessionResponseSchema.parse(
      sharedCompletionResponse.body
    );
    expect(sharedCompletion.exercises).toHaveLength(2);
    expect(
      sharedCompletion.activity_details.find(
        (detail) => detail.detail_type === 'workout_plan_prescription'
      )?.detail_data
    ).toMatchObject({
      workout_session_id: plan.sessions[0]!.id,
      assignments: [{ id: assignment.id, preset_snapshot: snapshot }],
    });
    for (const [index, exercise] of sharedCompletion.exercises.entries())
      expect(exercise.sets).toMatchObject(performed.exercises[index]!.sets);
    expect(await diaryPrescription(assignment.id, '2026-10-25')).toEqual(
      originalDiary
    );
    const sharedDiary = await getSystemClient();
    try {
      expect(
        (
          await sharedDiary.query(
            'SELECT user_id,workout_plan_assignment_id FROM exercise_entries WHERE exercise_preset_entry_id = $1 ORDER BY sort_order',
            [sharedCompletion.id]
          )
        ).rows
      ).toEqual([
        { user_id: other, workout_plan_assignment_id: assignment.id },
        { user_id: other, workout_plan_assignment_id: assignment.id },
      ]);
    } finally {
      sharedDiary.release();
    }
    const changeLibrary = await getSystemClient();
    try {
      await changeLibrary.query(
        "UPDATE workout_presets SET name = 'Library changed after completion', workout_format = 'tabata' WHERE id = $1",
        [presetId!]
      );
      await changeLibrary.query(
        "UPDATE exercises SET name = 'Changed live exercise' WHERE id = ANY($1::uuid[])",
        [[exerciseId, secondExerciseId]]
      );
    } finally {
      changeLibrary.release();
    }
    const editedPlan = planInput(await reloadPlan(plan.id));
    editedPlan.sessions[0]!.assignments[0]!.preset_snapshot = {
      ...snapshot,
      name: 'Future local prescription',
      description: 'Changed after completion',
      exercises: snapshot.exercises.map((exercise) => ({
        ...exercise,
        exercise_name: 'Future local movement',
        sets: exercise.sets.map((set) => ({
          ...set,
          reps: 12,
          rep_range: '12–15',
        })),
      })),
    };
    expect(
      (
        await request(app)
          .put(`/api/workout-plan-templates/${plan.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send(editedPlan)
      ).status
    ).toBe(200);
    for (const activity_details of [
      [],
      [
        {
          provider_name: 'SparkyFitness',
          detail_type: 'wod_score',
          detail_data: {
            workout_format: 'emom',
            score_type: 'completion',
            status: 'rx',
            elapsed_seconds: 120,
          },
        },
      ],
    ]) {
      const updatedResponse = await request(app)
        .put(`/api/exercise-preset-entries/${completed.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ activity_details });
      expect(updatedResponse.status).toBe(200);
      const updated = presetSessionResponseSchema.parse(updatedResponse.body);
      expect(
        updated.activity_details.find(
          (detail) => detail.detail_type === 'workout_plan_prescription'
        )?.detail_data
      ).toEqual(originalPrescription);
      expect(updated.exercises).toEqual(completed.exercises);
      expect(await diaryPrescription(assignment.id, '2026-10-25')).toEqual(
        originalDiary
      );
    }
    const reloadedResponse = await request(app)
      .get(`/api/exercise-preset-entries/${completed.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(reloadedResponse.status).toBe(200);
    const reloadedWorkout = presetSessionResponseSchema.parse(
      reloadedResponse.body
    );
    expect(
      reloadedWorkout.activity_details.find(
        (detail) => detail.detail_type === 'workout_plan_prescription'
      )?.detail_data
    ).toEqual(originalPrescription);
    expect(reloadedWorkout.exercises).toEqual(completed.exercises);
    const check = await getSystemClient();
    try {
      const before = (
        await check.query(
          `SELECT (SELECT COUNT(*)::int FROM exercise_entries WHERE user_id = ANY($1::uuid[])) AS exercises,
                (SELECT COUNT(*)::int FROM exercise_preset_entries WHERE user_id = ANY($1::uuid[])) AS workouts`,
          [[owner, other, outsider]]
        )
      ).rows;
      for (const [token, input] of [
        [outsiderToken, performed],
        [
          ownerToken,
          {
            ...performed,
            exercises: [
              performed.exercises[0]!,
              {
                ...performed.exercises[1]!,
                exercise_id: exerciseId,
                workout_plan_assignment_id:
                  plan.sessions[1]!.assignments[0]!.id,
              },
            ],
          },
        ],
      ] as const) {
        const denied = await request(app)
          .post('/api/exercise-preset-entries')
          .set('Authorization', `Bearer ${token}`)
          .send(input);
        expect(denied.status).toBe(404);
        expect(
          (
            await check.query(
              `SELECT (SELECT COUNT(*)::int FROM exercise_entries WHERE user_id = ANY($1::uuid[])) AS exercises,
                  (SELECT COUNT(*)::int FROM exercise_preset_entries WHERE user_id = ANY($1::uuid[])) AS workouts`,
              [[owner, other, outsider]]
            )
          ).rows
        ).toEqual(before);
        expect(await diaryPrescription(assignment.id, '2026-10-25')).toEqual(
          originalDiary
        );
      }
    } finally {
      check.release();
    }
  });
  it.each([
    {
      label: 'shared timing',
      secondFormat: 'emom' as const,
      secondCap: 600,
      expectedFormat: 'emom',
      expectedCap: 600,
    },
    {
      label: 'mixed formats',
      secondFormat: 'tabata' as const,
      secondCap: 90,
      expectedFormat: 'standard',
      expectedCap: null,
    },
    {
      label: 'mixed caps',
      secondFormat: 'emom' as const,
      secondCap: 90,
      expectedFormat: 'emom',
      expectedCap: null,
    },
  ])(
    'round-trips authoritative frozen aggregate $label through exact/generic start and every grouped read',
    async ({ label, secondFormat, secondCap, expectedFormat, expectedCap }) => {
      const exerciseId = await seedExercise();
      const secondExerciseId = await seedExercise();
      const seed: PoolClient = await getSystemClient();
      let presetIds: number[];
      try {
        presetIds = (
          await seed.query<{ id: number }>(
            `INSERT INTO workout_presets(user_id,name,description,workout_format,time_cap_seconds)
         VALUES ($1,'Mutable first','Live library','tabata',90), ($1,'Mutable second','Live library','tabata',90) RETURNING id`,
            [owner]
          )
        ).rows.map((row) => row.id);
      } finally {
        seed.release();
      }
      const snapshots = [exerciseId, secondExerciseId].map((id, index) => ({
        id: presetIds![index]!,
        name: `Frozen ${index + 1}`,
        description: 'Local timing prescription',
        workout_format: index === 0 ? ('emom' as const) : secondFormat,
        time_cap_seconds: index === 0 ? 600 : secondCap,
        exercises: [
          {
            id: index + 1,
            exercise_id: id,
            exercise_name: `Frozen timed movement ${index + 1}`,
            category: 'Strength',
            image_url: null,
            superset_group: null,
            sets: prescribedSets(1),
          },
        ],
      }));
      const plan = await createPlan({
        plan_name: `Timing aggregation ${label}`,
        schedule_type: 'sequential',
        is_active: false,
        sessions: [
          {
            name: 'A',
            day_of_week: null,
            sort_order: 0,
            assignments: snapshots.map((snapshot, sort_order) => ({
              workout_preset_id: snapshot.id,
              sort_order,
              preset_snapshot: snapshot,
            })),
          },
        ],
      });
      const exactResponse = await startSession(
        plan.sessions[0]!.id,
        '2026-10-25'
      );
      expect(exactResponse.status).toBe(201);
      const exact = presetSessionResponseSchema.parse(
        exactResponse.body.session
      );
      expect(exact).toMatchObject({
        workout_format: expectedFormat,
        time_cap_seconds: expectedCap,
      });
      const performed = {
        workout_preset_id: null,
        name: 'A',
        entry_date: '2026-10-26',
        source: 'Workout Plan',
        exercises: [exerciseId, secondExerciseId].map((id, index) => ({
          exercise_id: id,
          sort_order: index,
          duration_minutes: 0,
          workout_plan_assignment_id: plan.sessions[0]!.assignments[index]!.id,
          sets: prescribedSets(1).map((set) => ({ ...set, reps: 9 })),
        })),
      };
      const genericResponse = await request(app)
        .post('/api/exercise-preset-entries')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(performed);
      expect(genericResponse.status).toBe(201);
      const generic = presetSessionResponseSchema.parse(genericResponse.body);
      expect(generic).toMatchObject({
        workout_format: expectedFormat,
        time_cap_seconds: expectedCap,
      });
      const originalPrescription = generic.activity_details.find(
        (detail) => detail.detail_type === 'workout_plan_prescription'
      )?.detail_data;
      expect(originalPrescription).toMatchObject({
        assignments: snapshots.map((snapshot) => ({
          preset_snapshot: snapshot,
        })),
      });
      const mutation = await getSystemClient();
      try {
        await mutation.query(
          "UPDATE workout_presets SET workout_format = 'for_time', time_cap_seconds = 30 WHERE id = ANY($1::int[])",
          [presetIds!]
        );
        await mutation.query(
          'DELETE FROM workout_presets WHERE id = ANY($1::int[])',
          [presetIds!]
        );
      } finally {
        mutation.release();
      }
      await assertWorkoutTiming(
        exact.id,
        '2026-10-25',
        exerciseId,
        expectedFormat,
        expectedCap
      );
      await assertWorkoutTiming(
        generic.id,
        '2026-10-26',
        exerciseId,
        expectedFormat,
        expectedCap
      );
      for (const patch of [
        { notes: 'Header only' },
        { activity_details: [] },
      ]) {
        const updated = await request(app)
          .put(`/api/exercise-preset-entries/${generic.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send(patch);
        expect(updated.status).toBe(200);
        const saved = presetSessionResponseSchema.parse(updated.body);
        expect(saved).toMatchObject({
          workout_format: expectedFormat,
          time_cap_seconds: expectedCap,
        });
        expect(saved.exercises).toEqual(generic.exercises);
        expect(
          saved.activity_details.find(
            (detail) => detail.detail_type === 'workout_plan_prescription'
          )?.detail_data
        ).toEqual(originalPrescription);
        await assertWorkoutTiming(
          generic.id,
          '2026-10-26',
          exerciseId,
          expectedFormat,
          expectedCap
        );
      }
      const deletedSourceStart = await startSession(
        plan.sessions[0]!.id,
        '2026-11-01'
      );
      expect(deletedSourceStart.status).toBe(201);
      const afterDelete = presetSessionResponseSchema.parse(
        deletedSourceStart.body.session
      );
      expect(afterDelete).toMatchObject({
        workout_format: expectedFormat,
        time_cap_seconds: expectedCap,
      });
      await assertWorkoutTiming(
        afterDelete.id,
        '2026-11-01',
        exerciseId,
        expectedFormat,
        expectedCap
      );
    }
  );
  it('preserves explicit generic timing over library changes and distinguishes omitted updates from clearing the cap', async () => {
    const exerciseId = await seedExercise();
    const seed: PoolClient = await getSystemClient();
    let presetIds: number[];
    try {
      presetIds = (
        await seed.query<{ id: number }>(
          `INSERT INTO workout_presets(user_id,name,description,workout_format,time_cap_seconds)
         VALUES ($1,'Original live preset','Mutable','tabata',90),($1,'Replacement live preset','Mutable','for_time',30) RETURNING id`,
          [owner]
        )
      ).rows.map((row) => row.id);
    } finally {
      seed.release();
    }
    const response = await request(app)
      .post('/api/exercise-preset-entries')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        workout_preset_id: presetIds![0],
        name: 'Explicit diary timing',
        entry_date: '2026-10-25',
        workout_format: 'emom',
        time_cap_seconds: 600,
        exercises: [
          {
            exercise_id: exerciseId,
            sort_order: 0,
            duration_minutes: 0,
            sets: prescribedSets(1),
          },
        ],
      });
    expect(response.status).toBe(201);
    const original = presetSessionResponseSchema.parse(response.body);
    expect(original).toMatchObject({
      workout_format: 'emom',
      time_cap_seconds: 600,
    });
    const explicitlyNullResponse = await request(app)
      .post('/api/exercise-preset-entries')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        workout_preset_id: presetIds![0],
        name: 'Explicit uncapped diary',
        entry_date: '2026-10-26',
        workout_format: 'emom',
        time_cap_seconds: null,
        exercises: [
          {
            exercise_id: exerciseId,
            sort_order: 0,
            duration_minutes: 0,
            sets: prescribedSets(1),
          },
        ],
      });
    expect(explicitlyNullResponse.status).toBe(201);
    const uncapped = presetSessionResponseSchema.parse(
      explicitlyNullResponse.body
    );
    expect(uncapped).toMatchObject({
      workout_format: 'emom',
      time_cap_seconds: null,
    });
    const change = await getSystemClient();
    try {
      await change.query(
        "UPDATE workout_presets SET workout_format = 'tabata', time_cap_seconds = 15 WHERE id = $1",
        [presetIds![0]]
      );
      // Simulate an independently changed library link: header updates must
      // preserve stored timing rather than refresh from the newly linked preset.
      await change.query(
        'UPDATE exercise_preset_entries SET workout_preset_id = $1 WHERE id = $2',
        [presetIds![1], original.id]
      );
    } finally {
      change.release();
    }
    for (const patch of [
      { notes: 'Unrelated header edit' },
      {
        activity_details: [
          {
            provider_name: 'SparkyFitness',
            detail_type: 'wod_score',
            detail_data: {
              workout_format: 'tabata',
              time_cap_seconds: 90,
              score_type: 'completion',
              status: 'rx',
            },
          },
        ],
      },
    ]) {
      const saved = await request(app)
        .put(`/api/exercise-preset-entries/${original.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(patch);
      expect(saved.status).toBe(200);
      expect(presetSessionResponseSchema.parse(saved.body)).toMatchObject({
        workout_format: 'emom',
        time_cap_seconds: 600,
      });
    }
    await assertWorkoutTiming(
      original.id,
      '2026-10-25',
      exerciseId,
      'emom',
      600
    );
    const changedFormat = await request(app)
      .put(`/api/exercise-preset-entries/${original.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ workout_format: 'for_time' });
    expect(changedFormat.status).toBe(200);
    expect(presetSessionResponseSchema.parse(changedFormat.body)).toMatchObject(
      { workout_format: 'for_time', time_cap_seconds: 600 }
    );
    const changedCap = await request(app)
      .put(`/api/exercise-preset-entries/${original.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ time_cap_seconds: 480 });
    expect(changedCap.status).toBe(200);
    expect(presetSessionResponseSchema.parse(changedCap.body)).toMatchObject({
      workout_format: 'for_time',
      time_cap_seconds: 480,
    });
    await assertWorkoutTiming(
      original.id,
      '2026-10-25',
      exerciseId,
      'for_time',
      480
    );
    const cleared = await request(app)
      .put(`/api/exercise-preset-entries/${original.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ time_cap_seconds: null });
    expect(cleared.status).toBe(200);
    const clearedWorkout = presetSessionResponseSchema.parse(cleared.body);
    expect(clearedWorkout).toMatchObject({
      workout_format: 'for_time',
      time_cap_seconds: null,
    });
    expect(clearedWorkout.exercises).toEqual(original.exercises);
    const remove = await getSystemClient();
    try {
      await remove.query(
        'DELETE FROM workout_presets WHERE id = ANY($1::int[])',
        [presetIds!]
      );
    } finally {
      remove.release();
    }
    await assertWorkoutTiming(
      original.id,
      '2026-10-25',
      exerciseId,
      'for_time',
      null
    );
    await assertWorkoutTiming(
      uncapped.id,
      '2026-10-26',
      exerciseId,
      'emom',
      null
    );
  });
  describe('optional Workout Session outcomes', () => {
    beforeEach(async () => {
      const db = await getSystemClient();
      try {
        await db.query(
          `INSERT INTO user_preferences(user_id, timezone) VALUES ($1, 'America/New_York')
           ON CONFLICT (user_id) DO UPDATE SET timezone = EXCLUDED.timezone`,
          [owner]
        );
      } finally {
        db.release();
      }
      vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    async function schedule(
      dates: string[],
      optional: boolean[],
      autoShift = false,
      sessionId = workoutSessionId
    ) {
      const input = body();
      input.start_date = dates[0]!;
      input.end_date = dates.at(-1)!;
      input.auto_shift = autoShift;
      input.phases = [
        {
          name: 'Optional progression',
          goal: 'Keep required progression independent of accessory work',
          weeks: [
            {
              start_date: input.start_date,
              end_date: input.end_date,
              sessions: dates.map((date, index) => ({
                name: index === 0 ? 'C strength' : 'Conditioning',
                scheduled_date: date,
                workout_session_id: sessionId,
                is_optional: optional[index]!,
              })),
            },
          ],
        },
      ];
      const response = await request(app)
        .post('/api/training-programs')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(input);
      expect(response.status).toBe(201);
      program = trainingProgramSchema.parse(response.body);
      return program;
    }

    async function persistedSchedule(): Promise<
      {
        id: string;
        scheduled_date: string;
        effective_date: string;
        is_optional: boolean;
        status: string;
        outcome_at: Date | null;
        exercise_entry_id: string | null;
        exercise_preset_entry_id: string | null;
      }[]
    > {
      const db = await getSystemClient();
      try {
        return (
          await db.query(
            `SELECT id, scheduled_date::text, effective_date::text, is_optional, status,
             outcome_at, exercise_entry_id, exercise_preset_entry_id
           FROM training_program_sessions WHERE program_id = $1 ORDER BY id`,
            [program.id]
          )
        ).rows;
      } finally {
        db.release();
      }
    }

    it.each([
      [
        'athlete midnight',
        '2026-10-25',
        '2026-10-26T03:59:59.999Z',
        '2026-10-26T04:00:00.000Z',
      ],
      [
        'spring DST 23-hour day',
        '2027-03-14',
        '2027-03-15T03:59:59.999Z',
        '2027-03-15T04:00:00.000Z',
      ],
      [
        'fall DST 25-hour day',
        '2026-11-01',
        '2026-11-02T04:59:59.999Z',
        '2026-11-02T05:00:00.000Z',
      ],
    ])(
      'omits only after %s in the athlete timezone without app-open effects',
      async (_label, date, before, boundary) => {
        vi.setSystemTime(new Date(before));
        await schedule([date!], [true], true);
        expect(sessions(program)[0]).toMatchObject({
          is_optional: true,
          status: 'planned',
          outcome_at: null,
        });
        const stored = await persistedSchedule();
        expect(sessions(await reload())[0]!.status).toBe('planned');
        vi.setSystemTime(new Date(boundary));
        const omitted = await reload();
        expect(sessions(omitted)[0]).toMatchObject({
          status: 'omitted',
          is_optional: true,
          scheduled_date: date,
          effective_date: date,
          outcome_at: boundary,
        });
        vi.setSystemTime(new Date(Date.parse(boundary!) + 3 * 86400000));
        const later = await reload();
        expect(later).toEqual(omitted);
        expect((await update(editable(later))).status).toBe(200);
        expect(sessions(await reload())).toEqual(sessions(omitted));
        expect(await persistedSchedule()).toEqual(stored);
      }
    );

    it('uses UTC fallback without an athlete timezone preference', async () => {
      const db = await getSystemClient();
      try {
        await db.query('DELETE FROM user_preferences WHERE user_id = $1', [
          owner,
        ]);
      } finally {
        db.release();
      }
      vi.setSystemTime(new Date('2026-10-25T23:59:59.999Z'));
      await schedule(['2026-10-25'], [true]);
      expect(sessions(program)[0]!.status).toBe('planned');
      vi.setSystemTime(new Date('2026-10-26T00:00:00.000Z'));
      expect(sessions(await reload())[0]).toMatchObject({
        status: 'omitted',
        outcome_at: '2026-10-26T00:00:00.000Z',
      });
      expect((await persistedSchedule())[0]).toMatchObject({
        status: 'planned',
        outcome_at: null,
        effective_date: '2026-10-25',
      });
    });

    it('persists explicit optionality, inherits only on creation and preserves existing overrides', async () => {
      const plan = await createPlan({
        plan_name: 'Structured optionality',
        schedule_type: 'sequential',
        entry_mode: 'prompt',
        sessions: [
          {
            name: 'C',
            day_of_week: null,
            sort_order: 0,
            is_optional: true,
            assignments: [],
          },
          {
            name: 'Optional in name only',
            day_of_week: null,
            sort_order: 1,
            assignments: [],
          },
        ],
      });
      expect(
        (await reloadPlan(plan.id)).sessions.map((item) => item.is_optional)
      ).toEqual([true, false]);
      const input = body();
      const original = input.phases[0]!.weeks[0]!.sessions[0]!;
      original.workout_session_id = plan.sessions[0]!.id;
      input.phases[0]!.weeks[0]!.sessions.push({
        ...original,
        name: 'Explicit required',
        is_optional: false,
      });
      input.phases[0]!.weeks[0]!.sessions[1]!.workout_session_id =
        plan.sessions[1]!.id;
      const response = await request(app)
        .post('/api/training-programs')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(input);
      expect(response.status).toBe(201);
      program = trainingProgramSchema.parse(response.body);
      expect(sessions(program).map((item) => item.is_optional)).toEqual([
        true,
        false,
        false,
        false,
      ]);
      const edit = editable(program);
      delete edit.phases[0]!.weeks[0]!.sessions[0]!.is_optional;
      edit.phases[0]!.weeks[0]!.sessions[0]!.workout_session_id =
        plan.sessions[1]!.id;
      edit.phases[0]!.weeks[0]!.sessions[1]!.is_optional = true;
      expect((await update(edit)).status).toBe(200);
      const saved = await reload();
      expect(sessions(saved).map((item) => item.is_optional)).toEqual([
        true,
        true,
        false,
        false,
      ]);
      expect(
        (await persistedSchedule())
          .map((item) => item.is_optional)
          .filter(Boolean)
      ).toHaveLength(2);
      expect(
        (await outcome(sessions(saved)[0]!.id, { status: 'missed' })).status
      ).toBe(409);
    });

    it('keeps same-day optional strength before conditioning and skips omitted history without shifts or required misses', async () => {
      await schedule(
        ['2026-10-25', '2026-10-25', '2026-10-30'],
        [true, false, false],
        true
      );
      const cards = () => [
        { id: planId, sessions: [{ id: workoutSessionId, assignments: [] }] },
      ];
      expect(
        selectDashboardWorkoutPlans(cards(), [program]).programPlan
          ?.training_program_session_id
      ).toBe(sessions(program)[0]!.id);
      const stored = await persistedSchedule();
      vi.setSystemTime(new Date('2026-10-26T04:00:00Z'));
      const loaded = await reload();
      expect(
        sessions(loaded).map((item) => [item.status, item.effective_date])
      ).toEqual([
        ['omitted', '2026-10-25'],
        ['planned', '2026-10-25'],
        ['planned', '2026-10-30'],
      ]);
      expect(
        selectDashboardWorkoutPlans(cards(), [loaded]).programPlan
          ?.training_program_session_id
      ).toBe(sessions(loaded)[1]!.id);
      expect(
        (await outcome(sessions(loaded)[0]!.id, { status: 'missed' })).status
      ).toBe(409);
      expect(await persistedSchedule()).toEqual(stored);
      expect(loaded.schedule_end_date).toBe('2026-10-30');
    });

    it('uses effective dates after required misses and excludes expired optional workouts from later required shifts', async () => {
      await schedule(
        ['2026-10-25', '2026-10-26', '2026-10-28', '2026-10-29'],
        [false, true, false, false],
        true
      );
      expect(
        (await outcome(sessions(program)[0]!.id, { status: 'missed' })).status
      ).toBe(200);
      vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
      const shifted = await reload();
      expect(sessions(shifted)[1]).toMatchObject({
        scheduled_date: '2026-10-26',
        effective_date: '2026-10-27',
        status: 'planned',
      });
      vi.setSystemTime(new Date('2026-10-28T04:00:00Z'));
      expect(sessions(await reload())[1]!.status).toBe('omitted');
      vi.setSystemTime(new Date('2026-10-29T04:00:00Z'));
      expect(
        (await outcome(sessions(shifted)[2]!.id, { status: 'missed' })).status
      ).toBe(200);
      const final = await reload();
      expect(
        sessions(final).map((item) => [item.status, item.effective_date])
      ).toEqual([
        ['missed', '2026-10-25'],
        ['omitted', '2026-10-27'],
        ['missed', '2026-10-29'],
        ['planned', '2026-10-31'],
      ]);
      expect(
        (await persistedSchedule()).find(
          (item) => item.id === sessions(final)[1]!.id
        )
      ).toMatchObject({
        status: 'planned',
        effective_date: '2026-10-27',
        is_optional: true,
      });
    });

    it('does not shift an optional session already omitted before a late required miss', async () => {
      await schedule(
        ['2026-10-25', '2026-10-27', '2026-10-30'],
        [false, true, false],
        true
      );
      vi.setSystemTime(new Date('2026-10-28T04:00:00Z'));
      const before = await reload();
      const [missed, omitted, future] = sessions(before);
      expect([missed!.status, omitted!.status, future!.status]).toEqual([
        'planned',
        'omitted',
        'planned',
      ]);

      expect((await outcome(missed!.id, { status: 'missed' })).status).toBe(
        200
      );
      const after = await reload();
      expect(
        sessions(after).map((session) => [
          session.status,
          session.effective_date,
        ])
      ).toEqual([
        ['missed', '2026-10-25'],
        ['omitted', '2026-10-27'],
        ['planned', '2026-10-31'],
      ]);
      expect(
        (await persistedSchedule()).find(
          (session) => session.id === omitted!.id
        )
      ).toMatchObject({
        is_optional: true,
        status: 'planned',
        effective_date: '2026-10-27',
        outcome_at: null,
      });
    });

    it('retains authored deload absence across omission reads and aggregate updates', async () => {
      const input = body();
      input.phases[0]!.weeks[0]!.sessions[0]!.is_optional = true;
      expect((await update(input)).status).toBe(200);
      vi.setSystemTime(new Date('2026-11-08T05:00:00Z'));
      const saved = await reload();
      const identities = sessions(saved).map((item) => item.id);
      expect(saved.phases[1]!.weeks[0]!.sessions).toHaveLength(1);
      expect(saved.phases[1]!.weeks[0]!.sessions[0]!.is_optional).toBe(false);
      for (let repeat = 0; repeat < 2; repeat++) {
        expect((await update(editable(await reload()))).status).toBe(200);
        expect(sessions(await reload()).map((item) => item.id)).toEqual(
          identities
        );
      }
      expect(await persistedSchedule()).toHaveLength(3);
    });

    it.each(['preset', 'individual'] as const)(
      'late-links an omitted optional %s workout once and rejects other users, delegates and reused links',
      async (type) => {
        await schedule(['2026-10-25', '2026-10-30'], [true, false], true);
        vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
        const first = sessions(await reload())[0]!;
        expect(first.status).toBe('omitted');
        const workout = await diaryWorkout(type);
        expect(
          (
            await outcome(
              first.id,
              { status: 'completed', workout },
              outsiderToken
            )
          ).status
        ).toBe(404);
        expect(
          (
            await request(app)
              .post(
                `/api/training-programs/${program.id}/sessions/${first.id}/outcome`
              )
              .set('Authorization', `Bearer ${otherToken}`)
              .set('x-on-behalf-of-user-id', owner)
              .send({ status: 'completed', workout })
          ).status
        ).toBe(403);
        expect(
          (
            await outcome(first.id, {
              status: 'completed',
              workout: await diaryWorkout(type, other),
            })
          ).status
        ).toBe(404);
        expect(sessions(await reload())[0]).toEqual(first);
        const linked = await outcome(first.id, {
          status: 'completed',
          workout,
        });
        expect(linked.status).toBe(200);
        const saved = trainingProgramSchema.parse(linked.body);
        expect(sessions(saved)[0]).toMatchObject({
          status: 'completed',
          is_optional: true,
          completed_workout: workout,
        });
        expect(
          (await outcome(first.id, { status: 'completed', workout })).body
        ).toEqual(saved);
        expect(
          (
            await outcome(sessions(saved)[1]!.id, {
              status: 'completed',
              workout,
            })
          ).status
        ).toBe(409);
        expect(
          (
            await outcome(first.id, {
              status: 'completed',
              workout: await diaryWorkout(type),
            })
          ).status
        ).toBe(409);
        expect((await outcome(first.id, { status: 'missed' })).status).toBe(
          409
        );
        const persisted = (await persistedSchedule()).find(
          (item) => item.id === first.id
        );
        expect(persisted).toMatchObject({
          status: 'completed',
          [type === 'preset'
            ? 'exercise_preset_entry_id'
            : 'exercise_entry_id']: workout.id,
        });
        expect(sessions(await reload())[1]!.effective_date).toBe('2026-10-30');
      }
    );

    it('keeps required outcomes final and frozen late-completion prescriptions independent of library edits', async () => {
      const exerciseId = await seedExercise();
      const plan = await createPlan({
        plan_name: 'Optional historical prescription',
        schedule_type: 'sequential',
        entry_mode: 'prompt',
        sessions: [
          {
            name: 'C',
            day_of_week: null,
            sort_order: 0,
            is_optional: true,
            assignments: [
              {
                exercise_id: exerciseId,
                sort_order: 0,
                sets: prescribedSets(2),
              },
            ],
          },
        ],
      });
      await schedule(
        ['2026-10-25', '2026-10-26', '2026-10-30'],
        [true, false, false],
        false,
        plan.sessions[0]!.id
      );
      const first = sessions(program)[0]!;
      const started = await startSession(
        first.workout_session_id,
        first.effective_date
      );
      expect(started.status).toBe(201);
      const diary = presetSessionResponseSchema.parse(started.body.session);
      const historical = await diaryPrescription(
        plan.sessions[0]!.assignments[0]!.id,
        first.effective_date
      );
      vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
      expect(sessions(await reload())[0]!.status).toBe('omitted');
      expect(
        (
          await outcome(first.id, {
            status: 'completed',
            workout: { type: 'preset', id: diary.id },
          })
        ).status
      ).toBe(200);
      const requiredMiss = sessions(program)[1]!;
      const requiredComplete = sessions(program)[2]!;
      expect(
        (await outcome(requiredMiss.id, { status: 'missed' })).status
      ).toBe(200);
      const workout = await diaryWorkout('individual');
      expect(
        (await outcome(requiredComplete.id, { status: 'completed', workout }))
          .status
      ).toBe(200);
      expect(
        (
          await outcome(requiredMiss.id, {
            status: 'completed',
            workout: await diaryWorkout('individual'),
          })
        ).status
      ).toBe(409);
      expect(
        (await outcome(requiredComplete.id, { status: 'missed' })).status
      ).toBe(409);
      const saved = await reload();
      const edit = planInput(await reloadPlan(plan.id));
      edit.sessions[0]!.assignments[0]!.sets = prescribedSets(4);
      expect(
        (
          await request(app)
            .put(`/api/workout-plan-templates/${plan.id}`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send(edit)
        ).status
      ).toBe(200);
      expect(
        await diaryPrescription(
          plan.sessions[0]!.assignments[0]!.id,
          first.effective_date
        )
      ).toEqual(historical);
      const diaryHistory = await request(app)
        .get(`/api/exercise-preset-entries/${diary.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(diaryHistory.status).toBe(200);
      expect(
        presetSessionResponseSchema.parse(diaryHistory.body).activity_details
      ).toEqual(diary.activity_details);
      expect(await reload()).toEqual(saved);
      const rewrite = editable(saved);
      rewrite.phases[0]!.weeks[0]!.sessions[1]!.is_optional = true;
      expect((await update(rewrite)).status).toBe(409);
      expect(await reload()).toEqual(saved);
    });
  });
});
