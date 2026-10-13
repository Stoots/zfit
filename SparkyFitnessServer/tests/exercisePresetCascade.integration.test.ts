import { randomUUID } from 'node:crypto';
import pg from 'pg';
import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from 'express';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'supertest'
import request from 'supertest';
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import { getSystemClient, endPool } from '../db/poolManager.js';
import { initializeDatabase } from '../utils/initializeDatabase.js';
import exerciseDb from '../models/exercise.js';
import userRepository from '../models/userRepository.js';
import { createExerciseEntriesFromTemplate } from '../models/exerciseTemplate.js';
import exerciseRoutes from '../routes/exerciseRoutes.js';
import workoutPlanTemplateRoutes from '../routes/workoutPlanTemplateRoutes.js';

// Only authentication is replaced: HTTP handlers, service, RLS clients and
// mutations below are real. No service/repository mocks hide rollback failures.
vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: ((_req, _res, next) => next()) satisfies RequestHandler,
}));

async function dbReachable(): Promise<boolean> {
  if (process.env.SKIP_RLS_MATRIX === '1') return false;
  if (
    !process.env.SPARKY_FITNESS_APP_DB_USER ||
    !process.env.SPARKY_FITNESS_DB_HOST
  ) {
    return false;
  }
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
    await probe.end();
  }
}

interface Fixture {
  userId: string;
  exerciseId: string;
  presetId: number;
  templateId: number;
  sessionId: string;
  assignmentId: number;
}

const diaryCases = [
  { date: '2026-09-10', completed: true },
  { date: '2026-09-12', completed: false },
  { date: '2026-09-15', completed: false },
  { date: '2026-09-16', completed: true },
];

describe('exercise removal preserves nested-session diary identity', () => {
  let canRun = false;
  let adminClient: pg.PoolClient | null = null;
  let activeUserId = '';
  const users: string[] = [];
  const app = express();
  app.use((req, _res, next) => {
    req.userId = activeUserId;
    req.authenticatedUserId = activeUserId;
    next();
  });
  app.use('/exercises', exerciseRoutes);
  app.use('/workout-plan-templates', workoutPlanTemplateRoutes);
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const status =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number'
        ? error.status
        : 500;
    res.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  };
  app.use(errors);

  function db(): pg.PoolClient {
    if (!adminClient) throw new Error('Persisted fixture client unavailable');
    return adminClient;
  }

  async function createUser(): Promise<string> {
    const id = randomUUID();
    await db().query(
      `INSERT INTO "user" (id,email,name,email_verified,created_at,updated_at)
       VALUES ($1,$2,'Exercise removal fixture',true,NOW(),NOW())`,
      [id, `exercise-removal-${id}@example.test`]
    );
    users.push(id);
    return id;
  }

  async function seedDiary(
    userId: string,
    exerciseId: string | null,
    presetId: number,
    assignmentId: number | null
  ) {
    for (const [index, scenario] of diaryCases.entries()) {
      const parentId = randomUUID();
      const entryId = randomUUID();
      await db().query(
        `INSERT INTO exercise_preset_entries(id,user_id,workout_preset_id,name,description,entry_date,source,notes)
         VALUES ($1,$2,$3,'Frozen routine','Frozen routine description',$4,'Workout Plan','Keep parent notes')`,
        [parentId, userId, presetId, scenario.date]
      );
      await db().query(
        `INSERT INTO exercise_entries(id,user_id,exercise_id,exercise_name,entry_date,duration_minutes,
         calories_burned,workout_plan_assignment_id,exercise_preset_entry_id,source,notes,
         category,modality,equipment,primary_muscles,secondary_muscles,instructions,images)
         VALUES ($1,$2,$3,'Frozen dumbbell press',$4,30,150,$5,$6,'Workout Plan','Keep exercise notes',
         'Strength','weight_reps','["Dumbbell"]','["Chest"]','["Triceps"]','["Frozen instruction"]','["/uploads/frozen.png"]')`,
        [entryId, userId, exerciseId, scenario.date, assignmentId, parentId]
      );
      await db().query(
        `INSERT INTO exercise_entry_sets(exercise_entry_id,set_number,reps,weight,completed_at,is_pr)
         VALUES ($1,1,$2,20,$3,false),($1,2,$2,22,null,false)`,
        [
          entryId,
          8 + index,
          scenario.completed ? `${scenario.date}T10:00:00Z` : null,
        ]
      );
    }
  }

  async function fixture(
    linked: boolean,
    includeDiary = true
  ): Promise<Fixture> {
    const userId = await createUser();
    const exercise = await db().query<{ id: string }>(
      `INSERT INTO exercises(name,category,user_id,is_custom,source)
       VALUES ('Library dumbbell press','Strength',$1,true,'custom') RETURNING id`,
      [userId]
    );
    const exerciseId = exercise.rows[0]!.id;
    const preset = await db().query<{ id: number }>(
      `INSERT INTO workout_presets(user_id,name,description)
       VALUES ($1,'Mutable routine','Library description') RETURNING id`,
      [userId]
    );
    const presetId = preset.rows[0]!.id;
    const member = await db().query<{ id: number }>(
      `INSERT INTO workout_preset_exercises(workout_preset_id,exercise_id,sort_order)
       VALUES ($1,$2,0) RETURNING id`,
      [presetId, exerciseId]
    );
    await db().query(
      'INSERT INTO workout_preset_exercise_sets(workout_preset_exercise_id,set_number,reps,weight) VALUES ($1,1,10,20)',
      [member.rows[0]!.id]
    );
    const plan = await db().query<{ id: number }>(
      `INSERT INTO workout_plan_templates(user_id,plan_name,is_active)
       VALUES ($1,'Weekly nested removal fixture',true) RETURNING id`,
      [userId]
    );
    const templateId = plan.rows[0]!.id;
    const sessionId = randomUUID();
    await db().query(
      `INSERT INTO workout_plan_sessions(id,template_id,user_id,name,day_of_week,sort_order)
       VALUES ($1,$2,$3,'A',0,0)`,
      [sessionId, templateId, userId]
    );
    const assignment = await db().query<{ id: number }>(
      `INSERT INTO workout_plan_template_assignments(template_id,workout_session_id,user_id,exercise_id,sort_order)
       VALUES ($1,$2,$3,$4,0) RETURNING id`,
      [templateId, sessionId, userId, exerciseId]
    );
    const assignmentId = assignment.rows[0]!.id;
    await db().query(
      `INSERT INTO workout_plan_assignment_sets(assignment_id,set_number,reps,weight,prescription)
       VALUES ($1,1,8,20,'{"notes":"Independent session prescription"}'::jsonb)`,
      [assignmentId]
    );
    if (includeDiary)
      await seedDiary(
        userId,
        exerciseId,
        presetId,
        linked ? assignmentId : null
      );
    activeUserId = userId;
    return {
      userId,
      exerciseId,
      presetId,
      templateId,
      sessionId,
      assignmentId,
    };
  }

  async function createPrefillEntries(f: Fixture, date: string) {
    const dayOfWeek = (
      await db().query<{ day_of_week: number }>(
        'SELECT EXTRACT(DOW FROM $1::date)::int AS day_of_week',
        [date]
      )
    ).rows[0]!.day_of_week;
    await db().query(
      `UPDATE workout_plan_templates
       SET schedule_type = 'weekly', entry_mode = 'prefill', start_date = $2, end_date = $2
       WHERE id = $1`,
      [f.templateId, date]
    );
    await db().query(
      'UPDATE workout_plan_sessions SET day_of_week = $2 WHERE id = $1',
      [f.sessionId, dayOfWeek]
    );
    await createExerciseEntriesFromTemplate(f.templateId, f.userId, date);
    const entries = (
      await db().query<{ id: string }>(
        `SELECT id FROM exercise_entries
         WHERE user_id = $1 AND workout_plan_assignment_id = $2 AND entry_date = $3`,
        [f.userId, f.assignmentId, date]
      )
    ).rows;
    return entries;
  }

  async function state(userId: string) {
    const client = db();
    return {
      entries: (
        await client.query(
          'SELECT * FROM exercise_entries WHERE user_id = $1 ORDER BY id',
          [userId]
        )
      ).rows,
      sets: (
        await client.query(
          `SELECT s.* FROM exercise_entry_sets s JOIN exercise_entries e ON e.id = s.exercise_entry_id
         WHERE e.user_id = $1 ORDER BY s.id`,
          [userId]
        )
      ).rows,
      parents: (
        await client.query(
          'SELECT * FROM exercise_preset_entries WHERE user_id = $1 ORDER BY id',
          [userId]
        )
      ).rows,
      plans: (
        await client.query(
          'SELECT * FROM workout_plan_templates WHERE user_id = $1 ORDER BY id',
          [userId]
        )
      ).rows,
      sessions: (
        await client.query(
          'SELECT * FROM workout_plan_sessions WHERE user_id = $1 ORDER BY id',
          [userId]
        )
      ).rows,
      assignments: (
        await client.query(
          'SELECT * FROM workout_plan_template_assignments WHERE user_id = $1 ORDER BY id',
          [userId]
        )
      ).rows,
      assignmentSets: (
        await client.query(
          `SELECT s.* FROM workout_plan_assignment_sets s JOIN workout_plan_template_assignments a ON a.id = s.assignment_id
         WHERE a.user_id = $1 ORDER BY s.id`,
          [userId]
        )
      ).rows,
      presetMembers: (
        await client.query(
          `SELECT e.* FROM workout_preset_exercises e JOIN workout_presets p ON p.id = e.workout_preset_id
         WHERE p.user_id = $1 ORDER BY e.id`,
          [userId]
        )
      ).rows,
      presetSets: (
        await client.query(
          `SELECT s.* FROM workout_preset_exercise_sets s JOIN workout_preset_exercises e ON e.id = s.workout_preset_exercise_id
         JOIN workout_presets p ON p.id = e.workout_preset_id WHERE p.user_id = $1 ORDER BY s.id`,
          [userId]
        )
      ).rows,
    };
  }

  beforeAll(async () => {
    canRun = await dbReachable();
    if (!canRun) return;
    await initializeDatabase();
    adminClient = await getSystemClient();
  });

  afterEach(async () => {
    if (!adminClient) return;
    // RESTRICT requires diary-first cleanup. Each scenario owns fresh users and
    // fixtures, so no test relies on an earlier test having removed anything.
    for (const userId of users) {
      await db().query('DELETE FROM exercise_entries WHERE user_id = $1', [
        userId,
      ]);
      await db().query(
        'DELETE FROM exercise_preset_entries WHERE user_id = $1',
        [userId]
      );
    }
    for (const userId of users) {
      await db().query(
        'DELETE FROM workout_plan_templates WHERE user_id = $1',
        [userId]
      );
      await db().query('DELETE FROM workout_presets WHERE user_id = $1', [
        userId,
      ]);
      await db().query('DELETE FROM exercises WHERE user_id = $1', [userId]);
      await db().query('DELETE FROM "user" WHERE id = $1', [userId]);
    }
    users.length = 0;
  });

  afterAll(async () => {
    adminClient?.release();
    await endPool();
  });

  it('deletes a user with linked plan history but blocks direct plan-graph deletes', async (ctx) => {
    if (!canRun) {
      ctx.skip();
      return;
    }
    const f = await fixture(true);
    const before = await state(f.userId);

    await expect(
      db().query(
        'DELETE FROM workout_plan_template_assignments WHERE id = $1',
        [f.assignmentId]
      )
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(23001|23503)$/) });
    await expect(
      db().query('DELETE FROM workout_plan_sessions WHERE id = $1', [
        f.sessionId,
      ])
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(23001|23503)$/) });
    await expect(
      db().query('DELETE FROM workout_plan_templates WHERE id = $1', [
        f.templateId,
      ])
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(23001|23503)$/) });
    expect(await state(f.userId)).toEqual(before);

    await expect(userRepository.deleteUser(f.userId)).resolves.toBe(true);
    expect(
      (await db().query('SELECT id FROM "user" WHERE id = $1', [f.userId])).rows
    ).toEqual([]);
    expect(
      (
        await db().query('SELECT id FROM exercise_entries WHERE user_id = $1', [
          f.userId,
        ])
      ).rows
    ).toEqual([]);
    expect(
      (
        await db().query(
          'SELECT id FROM workout_plan_template_assignments WHERE user_id = $1',
          [f.userId]
        )
      ).rows
    ).toEqual([]);
  });

  it('deletes a plan after removing only its future incomplete prefill rows', async (ctx) => {
    if (!canRun) {
      ctx.skip();
      return;
    }
    const f = await fixture(false, false);
    const entries = await createPrefillEntries(f, '2040-01-01');
    expect(entries).toHaveLength(1);

    const response = await request(app).delete(
      `/workout-plan-templates/${f.templateId}`
    );
    expect(response.status).toBe(200);
    expect(response.body.message).toBe(
      'Workout plan template deleted successfully.'
    );
    expect(await state(f.userId)).toMatchObject({
      entries: [],
      parents: [],
      plans: [],
      sessions: [],
      assignments: [],
    });
  });

  it('blocks deletion when a plan has completed past diary history without mutating it', async (ctx) => {
    if (!canRun) {
      ctx.skip();
      return;
    }
    const f = await fixture(false, false);
    const futureEntries = await createPrefillEntries(f, '2040-01-01');
    const pastEntries = await createPrefillEntries(f, '2000-01-01');
    expect(futureEntries).toHaveLength(1);
    expect(pastEntries).toHaveLength(1);
    await db().query(
      'UPDATE exercise_entry_sets SET completed_at = $2 WHERE exercise_entry_id = $1',
      [pastEntries[0]!.id, new Date('2000-01-01T12:00:00Z')]
    );
    const before = await state(f.userId);

    const response = await request(app).delete(
      `/workout-plan-templates/${f.templateId}`
    );
    expect(response.status).toBe(409);
    expect(response.body.error).toContain('diary-linked history');
    expect(await state(f.userId)).toEqual(before);
  });

  it.for(['delete', 'delete_with_history'])(
    '%s rejects linked history with HTTP 409 before any mutation',
    async (mode, ctx) => {
      if (!canRun) {
        ctx.skip();
        return;
      }
      const f = await fixture(true);
      const before = await state(f.userId);
      const exerciseBefore = await db().query(
        'SELECT * FROM exercises WHERE id = $1',
        [f.exerciseId]
      );
      const response = await request(app)
        .delete(`/exercises/${f.exerciseId}`)
        .query({ mode });
      expect(response.status).toBe(409);
      expect(response.body.error).toContain('Hide it instead');
      expect(await state(f.userId)).toEqual(before);
      expect(
        (
          await db().query('SELECT * FROM exercises WHERE id = $1', [
            f.exerciseId,
          ])
        ).rows
      ).toEqual(exerciseBefore.rows);
      expect(before.assignments[0]).toMatchObject({
        id: f.assignmentId,
        user_id: f.userId,
        workout_session_id: f.sessionId,
      });
      expect(before.entries).toHaveLength(4);
      expect(before.parents).toHaveLength(4);
      expect(before.sets).toHaveLength(8);
    }
  );

  it('hide keeps exact past/future, completed/incomplete diary snapshots and session links', async (ctx) => {
    if (!canRun) {
      ctx.skip();
      return;
    }
    const f = await fixture(true);
    const before = await state(f.userId);
    const response = await request(app)
      .delete(`/exercises/${f.exerciseId}`)
      .query({ mode: 'hide' });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('hidden');
    expect(await state(f.userId)).toEqual(before);
    expect(
      (
        await db().query(
          'SELECT is_quick_exercise FROM exercises WHERE id = $1',
          [f.exerciseId]
        )
      ).rows
    ).toEqual([{ is_quick_exercise: true }]);
  });

  it('ordinary unlinked removal retains exact diary IDs, snapshots, sets and parents, nulling only source FK', async (ctx) => {
    if (!canRun) {
      ctx.skip();
      return;
    }
    const f = await fixture(false);
    const before = await state(f.userId);
    const response = await request(app)
      .delete(`/exercises/${f.exerciseId}`)
      .query({ mode: 'delete' });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('deleted');
    const after = await state(f.userId);
    expect(after.entries).toEqual(
      before.entries.map((entry) => ({ ...entry, exercise_id: null }))
    );
    expect(after.sets).toEqual(before.sets);
    expect(after.parents).toEqual(before.parents);
    expect(after.plans).toEqual(before.plans);
    expect(after.sessions).toEqual(before.sessions);
    expect(after.assignments).toEqual([]);
    expect(after.assignmentSets).toEqual([]);
    expect(after.presetMembers).toEqual([]);
    expect(after.presetSets).toEqual([]);
    expect(
      (
        await db().query('SELECT id FROM exercises WHERE id = $1', [
          f.exerciseId,
        ])
      ).rows
    ).toEqual([]);
  });

  it('explicit unlinked delete_with_history removes own logs and empty UUID parents atomically', async (ctx) => {
    if (!canRun) {
      ctx.skip();
      return;
    }
    const f = await fixture(false);
    const response = await request(app)
      .delete(`/exercises/${f.exerciseId}`)
      .query({ mode: 'delete_with_history' });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('deleted_with_history');
    const after = await state(f.userId);
    expect(after.entries).toEqual([]);
    expect(after.sets).toEqual([]);
    expect(after.parents).toEqual([]);
    expect(after.assignments).toEqual([]);
    expect(after.presetMembers).toEqual([]);
    expect(
      (
        await db().query('SELECT id FROM exercises WHERE id = $1', [
          f.exerciseId,
        ])
      ).rows
    ).toEqual([]);
  });

  it('explicit history deletion removes entries linked to another exercise assignment', async (ctx) => {
    if (!canRun) {
      ctx.skip();
      return;
    }
    const f = await fixture(false);
    const otherExercise = await db().query<{ id: string }>(
      `INSERT INTO exercises(name,category,user_id,is_custom,source)
       VALUES ('Other library exercise','Strength',$1,true,'custom') RETURNING id`,
      [f.userId]
    );
    const otherAssignment = await db().query<{ id: number }>(
      `INSERT INTO workout_plan_template_assignments(
         template_id,workout_session_id,user_id,exercise_id,sort_order
       ) VALUES ($1,$2,$3,$4,1) RETURNING id`,
      [f.templateId, f.sessionId, f.userId, otherExercise.rows[0]!.id]
    );
    const otherAssignmentId = otherAssignment.rows[0]!.id;
    await seedDiary(f.userId, f.exerciseId, f.presetId, otherAssignmentId);
    const before = await state(f.userId);
    expect(before.entries).toHaveLength(8);
    expect(before.assignments).toHaveLength(2);

    const response = await request(app)
      .delete(`/exercises/${f.exerciseId}`)
      .query({ mode: 'delete_with_history' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('deleted_with_history');
    const after = await state(f.userId);
    expect(after.entries).toEqual([]);
    expect(after.sets).toEqual([]);
    expect(after.parents).toEqual([]);
    expect(after.assignments.map((assignment) => assignment.id)).toEqual([
      otherAssignmentId,
    ]);
    expect(
      (
        await db().query('SELECT id FROM exercises WHERE id = $1', [
          f.exerciseId,
        ])
      ).rows
    ).toEqual([]);
  });

  it.for(['delete', 'delete_with_history'])(
    '%s hides shared family use without modifying either diary',
    async (mode, ctx) => {
      if (!canRun) {
        ctx.skip();
        return;
      }
      const f = await fixture(false);
      const familyUserId = await createUser();
      await db().query(
        `INSERT INTO family_access(owner_user_id,family_user_id,family_email,access_permissions,is_active,status)
       VALUES ($1,$2,$3,'{"can_view_exercise_library":true,"can_manage_diary":true}'::jsonb,true,'active')`,
        [
          f.userId,
          familyUserId,
          `exercise-removal-${familyUserId}@example.test`,
        ]
      );
      await seedDiary(familyUserId, f.exerciseId, f.presetId, null);
      const ownerBefore = await state(f.userId);
      const familyBefore = await state(familyUserId);
      const response = await request(app)
        .delete(`/exercises/${f.exerciseId}`)
        .query({ mode });
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('hidden');
      expect(await state(f.userId)).toEqual(ownerBefore);
      expect(await state(familyUserId)).toEqual(familyBefore);
    }
  );

  it('transactional history deletion scopes diary and UUID parent removal to the owner', async (ctx) => {
    if (!canRun) {
      ctx.skip();
      return;
    }
    const f = await fixture(false);
    const otherUserId = await createUser();
    await seedDiary(otherUserId, f.exerciseId, f.presetId, null);
    const otherBefore = await state(otherUserId);
    // The consumer intentionally hides shared references. Exercise the model's
    // independent owner scope too, with rows the owner's RLS cannot read.
    const result = await exerciseDb.deleteExerciseAndDependencies(
      f.exerciseId,
      f.userId,
      { deleteHistory: true }
    );
    expect(result).toEqual({ success: true, deletedEntries: 4 });
    const ownerAfter = await state(f.userId);
    expect(ownerAfter.entries).toEqual([]);
    expect(ownerAfter.parents).toEqual([]);
    const otherAfter = await state(otherUserId);
    expect(otherAfter.entries).toEqual(
      otherBefore.entries.map((entry) => ({ ...entry, exercise_id: null }))
    );
    expect(otherAfter.sets).toEqual(otherBefore.sets);
    expect(otherAfter.parents).toEqual(otherBefore.parents);
  });

  it.for(['delete', 'delete_with_history'])(
    '%s rolls back on an RLS-hidden retained assignment link with HTTP 409',
    async (mode, ctx) => {
      if (!canRun) {
        ctx.skip();
        return;
      }
      const f = await fixture(false);
      const otherUserId = await createUser();
      // Retained snapshots may have no library FK. The foreign assignment link
      // is invisible to the owner's RLS and absent from exercise impact counts.
      await seedDiary(otherUserId, null, f.presetId, f.assignmentId);
      const ownerBefore = await state(f.userId);
      const otherBefore = await state(otherUserId);
      const response = await request(app)
        .delete(`/exercises/${f.exerciseId}`)
        .query({ mode });
      expect(response.status).toBe(409);
      expect(response.body.error).toBe(
        'This exercise is still referenced. Hide it instead; no changes were saved.'
      );
      expect(await state(f.userId)).toEqual(ownerBefore);
      expect(await state(otherUserId)).toEqual(otherBefore);
      expect(
        (
          await db().query('SELECT id FROM exercises WHERE id = $1', [
            f.exerciseId,
          ])
        ).rows
      ).toEqual([{ id: f.exerciseId }]);
    }
  );

  it.for(['hide', 'delete', 'delete_with_history'])(
    'a family library viewer cannot %s the owner exercise',
    async (mode, ctx) => {
      if (!canRun) {
        ctx.skip();
        return;
      }
      const f = await fixture(true);
      const familyUserId = await createUser();
      await db().query(
        `INSERT INTO family_access(owner_user_id,family_user_id,family_email,access_permissions,is_active,status)
       VALUES ($1,$2,$3,'{"can_view_exercise_library":true,"can_manage_diary":true}'::jsonb,true,'active')`,
        [
          f.userId,
          familyUserId,
          `exercise-removal-${familyUserId}@example.test`,
        ]
      );
      const before = await state(f.userId);
      const exerciseBefore = (
        await db().query('SELECT * FROM exercises WHERE id = $1', [
          f.exerciseId,
        ])
      ).rows;
      activeUserId = familyUserId;
      const response = await request(app)
        .delete(`/exercises/${f.exerciseId}`)
        .query({ mode });
      expect(response.status).toBe(403);
      expect(await state(f.userId)).toEqual(before);
      expect(
        (
          await db().query('SELECT * FROM exercises WHERE id = $1', [
            f.exerciseId,
          ])
        ).rows
      ).toEqual(exerciseBefore);
    }
  );
});
