import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
// @ts-expect-error supertest has no declarations in this package.
import request from 'supertest';
// @ts-expect-error cookie-parser has no declarations in this package.
import cookieParser from 'cookie-parser';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cooperRunAttemptSchema,
  type CooperRunAttemptInput,
} from '@workspace/shared';
import { getSystemClient, endPool } from '../db/poolManager.js';
import errorHandler from '../middleware/errorHandler.js';
import {
  databaseReachable,
  requireDatabaseInCI,
} from './databaseIntegrationGuard.js';

const skipEnvVar = 'SKIP_CARDIO_TEST_DB';
const run = await databaseReachable(skipEnvVar);
requireDatabaseInCI(run, skipEnvVar, 'Cardio Test Attempt');

describe.runIf(run)('persisted authenticated Cooper Test Attempts', () => {
  const app = express();
  let ownerId = '';
  let otherId = '';
  let ownerToken = '';
  let otherToken = '';
  let firstAttemptId = '';
  const attempt = (input: CooperRunAttemptInput, token = ownerToken) =>
    request(app)
      .post('/api/cardio-tests/cooper-run/attempts')
      .set('Authorization', `Bearer ${token}`)
      .send(input);

  beforeAll(async () => {
    const { auth } = await import('../auth.js');
    const accounts = await Promise.all(
      ['owner', 'other'].map((name) =>
        auth.api.signUpEmail({
          body: {
            name,
            email: `cooper-test-${name}-${randomUUID()}@example.test`,
            password: randomBytes(24).toString('base64'),
          },
        })
      )
    );
    ownerId = accounts[0]!.user.id;
    ownerToken = accounts[0]!.token!;
    otherId = accounts[1]!.user.id;
    otherToken = accounts[1]!.token!;
    const db = await getSystemClient();
    try {
      await db.query(
        `INSERT INTO family_access(owner_user_id, family_user_id, family_email, access_permissions, is_active, status)
         VALUES ($1,$2,$3,'{"can_manage_diary":true}',true,'active')`,
        [ownerId, otherId, accounts[1]!.user.email]
      );
    } finally {
      db.release();
    }
    const { default: routes } = await import('../routes/cardioTestRoutes.js');
    const { default: programRoutes } =
      await import('../routes/trainingProgramRoutes.js');
    app.use(express.json(), cookieParser());
    app.use('/api/cardio-tests', routes);
    app.use('/api/training-programs', programRoutes);
    app.use(errorHandler);
  }, 30000);

  beforeEach(async () => {
    const db = await getSystemClient();
    try {
      await db.query(
        'DELETE FROM cardio_test_attempts WHERE user_id = ANY($1::uuid[])',
        [[ownerId, otherId]]
      );
      await db.query(
        'DELETE FROM training_programs WHERE user_id = ANY($1::uuid[])',
        [[ownerId, otherId]]
      );
    } finally {
      db.release();
    }
  });

  afterAll(async () => {
    if (ownerId && otherId) {
      const db = await getSystemClient();
      try {
        await db.query('DELETE FROM public."user" WHERE id = ANY($1::uuid[])', [
          [ownerId, otherId],
        ]);
      } finally {
        db.release();
      }
    }
    await endPool();
  });

  it('persists attempts, orders them by date, and edits dated distance values', async () => {
    const later = await attempt({
      attempt_date: '2026-10-08',
      distance_meters: 2705,
    });
    expect(later.status).toBe(201);
    const laterAttempt = cooperRunAttemptSchema.parse(later.body);

    const earlier = await attempt({
      attempt_date: '2026-09-21',
      distance_meters: 2480,
    });
    expect(earlier.status).toBe(201);
    const earlierAttempt = cooperRunAttemptSchema.parse(earlier.body);
    firstAttemptId = earlierAttempt.id;

    const listed = await request(app)
      .get('/api/cardio-tests/cooper-run/attempts')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.map((row: { id: string }) => row.id)).toEqual([
      earlierAttempt.id,
      laterAttempt.id,
    ]);

    const edited = await request(app)
      .put(`/api/cardio-tests/cooper-run/attempts/${firstAttemptId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ attempt_date: '2026-09-22', distance_meters: 2512 });
    expect(edited.status).toBe(200);
    expect(cooperRunAttemptSchema.parse(edited.body)).toMatchObject({
      id: firstAttemptId,
      attempt_date: '2026-09-22',
      distance_meters: 2512,
    });
  });

  it('does not expose or allow editing another user’s attempts', async () => {
    const saved = await attempt({
      attempt_date: '2026-10-01',
      distance_meters: 2610,
    });
    expect(saved.status).toBe(201);
    const id = cooperRunAttemptSchema.parse(saved.body).id;

    const foreignList = await request(app)
      .get('/api/cardio-tests/cooper-run/attempts')
      .set('Authorization', `Bearer ${otherToken}`);
    expect(foreignList.status).toBe(200);
    expect(foreignList.body).toEqual([]);

    const foreignEdit = await request(app)
      .put(`/api/cardio-tests/cooper-run/attempts/${id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ attempt_date: '2026-10-02', distance_meters: 2800 });
    expect(foreignEdit.status).toBe(404);

    const ownerList = await request(app)
      .get('/api/cardio-tests/cooper-run/attempts')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ownerList.body.map((row: { id: string }) => row.id)).toEqual([id]);
  });

  it('rejects invalid dates and non-positive distances', async () => {
    const invalidDate = await attempt({
      attempt_date: '2026-02-30',
      distance_meters: 2400,
    });
    expect(invalidDate.status).toBe(400);

    const invalidDistance = await request(app)
      .post('/api/cardio-tests/cooper-run/attempts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ attempt_date: '2026-10-01', distance_meters: 0 });
    expect(invalidDistance.status).toBe(400);
  });

  it.each([
    ['sprint_6s', { peak_watts: [900, 800, 700, 600, 500] }],
    [
      'power_30s',
      {
        efforts: [
          { peak_watts: 700, average_watts: 450 },
          { peak_watts: 650, average_watts: 425 },
        ],
      },
    ],
    [
      'ramp',
      { maximum_watts: 340, peak_heart_rate: 180, one_minute_heart_rate: 145 },
    ],
  ])('persists and isolates %s attempts', async (protocol, results) => {
    const path = `/api/cardio-tests/${protocol}/attempts`;
    const input = { test_type: protocol, attempt_date: '2026-10-01', results };
    const saved = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(input);
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject(input);
    const otherList = await request(app)
      .get(path)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(otherList.body).toEqual([]);
    const otherEdit = await request(app)
      .put(`${path}/${saved.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send(input);
    expect(otherEdit.status).toBe(404);
    const ownerList = await request(app)
      .get(path)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ownerList.body).toHaveLength(1);
    expect(ownerList.body[0]).toMatchObject(input);
    const edited = await request(app)
      .put(`${path}/${saved.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...input, attempt_date: '2026-10-02' });
    expect(edited.status).toBe(200);
    expect(edited.body.attempt_date).toBe('2026-10-02');
  });

  it('rejects incomplete power efforts and mismatched protocols', async () => {
    const path = '/api/cardio-tests/sprint_6s/attempts';
    const bad = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        test_type: 'sprint_6s',
        attempt_date: '2026-10-01',
        results: { peak_watts: [100, 200] },
      });
    expect(bad.status).toBe(400);
    const mismatched = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        test_type: 'ramp',
        attempt_date: '2026-10-01',
        results: {
          maximum_watts: 300,
          peak_heart_rate: 180,
          one_minute_heart_rate: 145,
        },
      });
    expect(mismatched.status).toBe(400);
  });

  it('keeps the database protocol constraint aligned with the public contract', async () => {
    const db = await getSystemClient();
    try {
      await expect(
        db.query(
          `INSERT INTO cardio_test_attempts (user_id, test_type, attempt_date, results)
         VALUES ($1, 'sprint_6s', '2026-10-01', '{}'::jsonb)`,
          [ownerId]
        )
      ).rejects.toThrow();
      await expect(
        db.query(
          `INSERT INTO cardio_test_attempts (user_id, test_type, attempt_date, results)
         VALUES ($1, 'power_30s', '2026-10-01', '{"efforts":[]}'::jsonb)`,
          [ownerId]
        )
      ).rejects.toThrow();
      await expect(
        db.query(
          `INSERT INTO cardio_test_attempts (user_id, test_type, attempt_date, results)
         VALUES ($1, 'ramp', '2026-10-01',
           '{"maximum_watts":300,"peak_heart_rate":180.5,"one_minute_heart_rate":145}'::jsonb)`,
          [ownerId]
        )
      ).rejects.toThrow();
      await expect(
        db.query(
          `INSERT INTO cardio_test_attempts (user_id, test_type, attempt_date, results)
         VALUES ($1, 'ramp', '2026-10-01',
           '{"maximum_watts":300,"peak_heart_rate":180,"one_minute_heart_rate":145.5}'::jsonb)`,
          [ownerId]
        )
      ).rejects.toThrow();
    } finally {
      db.release();
    }
  });

  it('schedules an assessment without a Workout Session and links only its owner’s attempt', async () => {
    const program = await request(app)
      .post('/api/training-programs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Autumn base',
        goal: 'Measure progress',
        start_date: '2026-10-01',
        end_date: '2026-10-31',
        phases: [
          {
            name: 'Build',
            goal: 'Aerobic base',
            weeks: [
              {
                start_date: '2026-10-12',
                end_date: '2026-10-18',
                sessions: [
                  {
                    name: 'Baseline',
                    scheduled_date: '2026-10-14',
                    cardio_test_type: 'cooper_run',
                  },
                ],
              },
            ],
          },
        ],
      });
    expect(program.status).toBe(201);
    const planned = program.body.phases[0].weeks[0].sessions[0];
    expect(planned).toMatchObject({
      workout_session_id: null,
      cardio_test_type: 'cooper_run',
      status: 'planned',
    });

    const foreign = await attempt(
      {
        attempt_date: '2026-10-14',
        distance_meters: 2500,
        planned_session_id: planned.id,
      },
      otherToken
    );
    expect(foreign.status).toBe(404);
    const delegatedLink = await request(app)
      .post('/api/cardio-tests/cooper-run/attempts')
      .set('Authorization', `Bearer ${otherToken}`)
      .set('Cookie', `sparky_active_user_id=${ownerId}`)
      .send({
        attempt_date: '2026-10-14',
        distance_meters: 2500,
        planned_session_id: planned.id,
      });
    expect(delegatedLink.status).toBe(403);
    const linked = await attempt({
      attempt_date: '2026-10-14',
      distance_meters: 2510,
      planned_session_id: planned.id,
    });
    expect(linked.status).toBe(201);
    expect(linked.body.planned_session_id).toBe(planned.id);
    const delegatedEdit = await request(app)
      .put(`/api/cardio-tests/cooper-run/attempts/${linked.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .set('Cookie', `sparky_active_user_id=${ownerId}`)
      .send({ attempt_date: '2026-10-14', distance_meters: 2550 });
    expect(delegatedEdit.status).toBe(404);
    const history = await request(app)
      .get(`/api/training-programs/${program.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(history.status).toBe(200);
    expect(history.body.phases[0].weeks[0].sessions[0]).toMatchObject({
      status: 'completed',
      completed_test_attempt: {
        id: linked.body.id,
        test_type: 'cooper_run',
        attempt_date: '2026-10-14',
        results: { distance_meters: 2510 },
      },
    });
    const duplicate = await attempt({
      attempt_date: '2026-10-14',
      distance_meters: 2530,
      planned_session_id: planned.id,
    });
    expect(duplicate.status).toBe(409);

    const standalone = await attempt({
      attempt_date: '2026-10-15',
      distance_meters: 2600,
    });
    expect(standalone.status).toBe(201);
    expect(standalone.body.planned_session_id).toBeNull();
    const listed = await request(app)
      .get('/api/cardio-tests/cooper-run/attempts')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(
      listed.body.map(
        (row: { planned_session_id: string | null }) => row.planned_session_id
      )
    ).toEqual([planned.id, null]);
    const removed = await request(app)
      .delete(`/api/training-programs/${program.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(removed.status).toBe(204);
    const retained = await request(app)
      .get('/api/cardio-tests/cooper-run/attempts')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(
      retained.body.map(
        (row: { planned_session_id: string | null }) => row.planned_session_id
      )
    ).toEqual([null, null]);
  });

  it.each([
    ['sprint_6s', { peak_watts: [900, 800, 700, 600, 500] }],
    [
      'power_30s',
      {
        efforts: [
          { peak_watts: 700, average_watts: 450 },
          { peak_watts: 650, average_watts: 425 },
        ],
      },
    ],
  ])(
    'links a scheduled %s attempt to its Program',
    async (protocol, results) => {
      const program = await request(app)
        .post('/api/training-programs')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Power baseline',
          goal: 'Measure power',
          start_date: '2026-10-01',
          end_date: '2026-10-31',
          phases: [
            {
              name: 'Assess',
              goal: 'Baseline',
              weeks: [
                {
                  start_date: '2026-10-12',
                  end_date: '2026-10-18',
                  sessions: [
                    {
                      name: 'Power test',
                      scheduled_date: '2026-10-14',
                      cardio_test_type: protocol,
                    },
                  ],
                },
              ],
            },
          ],
        });
      expect(program.status).toBe(201);
      const planned = program.body.phases[0].weeks[0].sessions[0];
      const path = `/api/cardio-tests/${protocol}/attempts`;
      const input = {
        test_type: protocol,
        attempt_date: '2026-10-14',
        results,
        planned_session_id: planned.id,
      };
      const delegated = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${otherToken}`)
        .set('Cookie', `sparky_active_user_id=${ownerId}`)
        .send(input);
      expect(delegated.status).toBe(403);
      const linked = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(input);
      expect(linked.status).toBe(201);
      expect(linked.body).toMatchObject(input);
      const history = await request(app)
        .get(`/api/training-programs/${program.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(history.body.phases[0].weeks[0].sessions[0]).toMatchObject({
        status: 'completed',
        completed_test_attempt: {
          id: linked.body.id,
          test_type: protocol,
          results,
        },
      });
      const duplicate = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(input);
      expect(duplicate.status).toBe(409);
      const unlinked = await request(app)
        .put(`${path}/${linked.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ ...input, planned_session_id: null });
      expect(unlinked.status).toBe(200);
      expect(unlinked.body.planned_session_id).toBeNull();
      const restored = await request(app)
        .get(`/api/training-programs/${program.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(restored.body.phases[0].weeks[0].sessions[0]).toMatchObject({
        status: 'planned',
        completed_test_attempt: null,
      });
    }
  );
});
