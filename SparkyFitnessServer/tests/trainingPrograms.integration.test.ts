import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import express from 'express';
// @ts-expect-error TS7016 — supertest has no declarations in this package.
import request from 'supertest';
// @ts-expect-error TS7016 — cookie-parser has no declarations in this package.
import cookieParser from 'cookie-parser';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import {
  trainingProgramSchema,
  type TrainingProgram,
  type TrainingProgramInput,
} from '@workspace/shared';
import { getClient, getSystemClient, endPool } from '../db/poolManager.js';
import errorHandler from '../middleware/errorHandler.js';

async function databaseReachable() {
  if (
    !process.env.SPARKY_FITNESS_APP_DB_USER ||
    process.env.SKIP_TRAINING_PROGRAM_DB === '1'
  )
    return false;
  const probe = new pg.Client({
    host: process.env.SPARKY_FITNESS_DB_HOST,
    port: Number(process.env.SPARKY_FITNESS_DB_PORT) || 5432,
    database: process.env.SPARKY_FITNESS_DB_NAME,
    user: process.env.SPARKY_FITNESS_APP_DB_USER,
    password: process.env.SPARKY_FITNESS_APP_DB_PASSWORD,
    connectionTimeoutMillis: 2000,
  });
  try {
    await probe.connect();
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}
const run = await databaseReachable();

describe.runIf(run)('persisted authenticated Training Program APIs', () => {
  const app = express();
  let owner: string, other: string, ownerToken: string, otherToken: string;
  let planId: number, foreignPlanId: number;
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
                workout_plan_id: planId,
              },
              {
                name: 'Strength',
                scheduled_date: '2026-10-30',
                workout_plan_id: planId,
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
                workout_plan_id: planId,
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
            workout_plan_id: session.workout_plan_id,
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
  beforeAll(async () => {
    // Load Better Auth only after the database probe: it eagerly validates the
    // migrated schema at import time, which cannot run on DB-less unit-test hosts.
    const { auth } = await import('../auth.js');
    const accounts = await Promise.all(
      ['owner', 'other'].map((name) =>
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
    const db = await getSystemClient();
    try {
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
    app.use(express.json(), cookieParser());
    app.use('/api/training-programs', routes);
    app.use('/api/workout-plan-templates', workoutRoutes);
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
    const db = await getSystemClient();
    try {
      await db.query('DELETE FROM public."user" WHERE id = ANY($1::uuid[])', [
        [owner, other].filter(Boolean),
      ]);
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
    input.phases[0]!.weeks[0]!.sessions[0]!.workout_plan_id = foreignPlanId;
    expect(
      (
        await request(app)
          .put(`/api/training-programs/${program.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send(input)
      ).status
    ).toBe(400);
    const otherInput = body();
    otherInput.phases[0]!.weeks[0]!.sessions[0]!.workout_plan_id = planId;
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
          session.workout_plan_id = foreignPlanId;
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
      workout_plan_id: planId,
    });
    edit.phases[1]!.weeks[0]!.sessions.push({
      name: 'Last day',
      scheduled_date: '2026-11-07',
      workout_plan_id: planId,
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
        'workout_plan_id',
      ] as const) {
        const changed = editable(saved);
        const item = changed.phases[0]!.weeks[0]!.sessions[0]!;
        if (field === 'name') item.name = 'Rewritten';
        if (field === 'scheduled_date') item.scheduled_date = '2026-10-26';
        if (field === 'workout_plan_id') item.workout_plan_id = foreignPlanId;
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
                  workout_plan_id: planId,
                },
                {
                  name: 'Future',
                  scheduled_date: future!,
                  workout_plan_id: planId,
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
    input.start_date = '9999-12-30';
    input.end_date = '9999-12-31';
    input.auto_shift = true;
    input.phases = [
      {
        name: 'Boundary',
        goal: 'Calendar',
        weeks: [
          {
            start_date: input.start_date,
            end_date: input.end_date,
            sessions: [
              {
                name: 'Miss',
                scheduled_date: input.start_date,
                workout_plan_id: planId,
              },
              {
                name: 'Future',
                scheduled_date: input.end_date,
                workout_plan_id: planId,
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
});
