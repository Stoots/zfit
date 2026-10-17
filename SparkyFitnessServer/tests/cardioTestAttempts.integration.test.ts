import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import type { PoolClient } from 'pg';
// @ts-expect-error supertest has no declarations in this package.
import request from 'supertest';
// @ts-expect-error cookie-parser has no declarations in this package.
import cookieParser from 'cookie-parser';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cardioTestTypeSchema,
  cooperRunAttemptSchema,
  trainingProgramSchema,
  type CooperRunAttemptInput,
} from '@workspace/shared';
import { getSystemClient, endPool } from '../db/poolManager.js';
import errorHandler from '../middleware/errorHandler.js';
import {
  databaseReachable,
  requireDatabaseInCI,
} from './databaseIntegrationGuard.js';

import { buildTrainingAnalysisTools } from '../ai/tools/trainingAnalysisTools.js';
import { toolOpts } from './helpers/toolExecutionOptions.js';

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

  async function createCooperProgram(name: string) {
    const response = await request(app)
      .post('/api/training-programs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name,
        goal: 'Measure progress',
        start_date: '2026-10-01',
        end_date: '2026-10-31',
        phases: [
          {
            name: 'Base',
            goal: 'Aerobic base',
            weeks: [
              {
                start_date: '2026-10-12',
                end_date: '2026-10-18',
                sessions: [
                  {
                    name: 'Cooper baseline',
                    scheduled_date: '2026-10-14',
                    cardio_test_type: 'cooper_run',
                  },
                ],
              },
            ],
          },
        ],
      });
    expect(response.status).toBe(201);
    return trainingProgramSchema.parse(response.body);
  }

  async function waitForBlockedQuery(fragment: string) {
    const observer = await getSystemClient();
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = (await observer.query(
          `SELECT count(*)::int AS waiting FROM pg_stat_activity
           WHERE datname = current_database() AND pid <> pg_backend_pid()
             AND wait_event_type = 'Lock' AND query LIKE $1`,
          [`%${fragment}%`]
        )) as { rows: Array<{ waiting: number }> };
        if (result.rows[0]?.waiting) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      observer.release();
    }
    throw new Error(`No blocked ${fragment} query appeared`);
  }

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

  it('reads only selected synced Health fields and canonical attempts for the requesting owner', async () => {
    await attempt({ attempt_date: '2026-10-14', distance_meters: 2400 });
    const db = await getSystemClient();
    try {
      const category = await db.query(
        `INSERT INTO custom_categories (user_id, name, frequency, measurement_type, data_type)
         VALUES ($1, 'RestingHeartRate', 'Hourly', 'bpm', 'numeric') RETURNING id`,
        [ownerId]
      );
      await db.query(
        `INSERT INTO custom_measurements (user_id, category_id, value, entry_date, source)
         VALUES ($1,$2,'54','2026-10-15','HealthKit'), ($1,$2,'777','2026-10-15','manual')`,
        [ownerId, category.rows[0].id]
      );
      await db.query(
        `INSERT INTO daily_health_metrics (user_id, entry_date, source_provider, resting_heart_rate, vo2_max)
        VALUES ($1, '2026-10-14', 'healthkit', 52, 99), ($1, '2026-10-14', 'manual', 123, 99),
        ($2, '2026-10-14', 'healthkit', 199, 99), ($1, '2025-10-14', 'healthkit', 222, 99),
        ($1, '2026-10-16', 'healthkit', NULL, 99)`,
        [ownerId, otherId]
      );
      await db.query(
        `INSERT INTO health_metric_samples (user_id, entry_date, source_provider, metric, samples)
        VALUES ($1, '2026-10-14', 'healthkit', 'hrv', $2::jsonb)`,
        [
          ownerId,
          JSON.stringify([
            { t: '2026-10-14T00:00:00Z', sdnn_ms: 40 },
            { t: '2026-10-14T01:00:00Z', sdnn_ms: 60, rmssd_ms: 30 },
          ]),
        ]
      );
    } finally {
      db.release();
    }
    const scope = {
      start_date: '2026-10-12',
      end_date: '2026-10-18',
      programs: false,
      test_types: ['cooper_run' as const],
      health_metrics: ['resting_heart_rate' as const, 'hrv' as const],
    };
    const tools = buildTrainingAnalysisTools(ownerId, scope);
    const health = JSON.parse(
      String(await tools.sparky_read_training_health!.execute!({}, toolOpts))
    );
    expect(health.rows).toHaveLength(4);
    expect(health.rows).toContainEqual(
      expect.objectContaining({
        category: 'RestingHeartRate',
        mean: 54,
        unit: 'bpm',
      })
    );
    expect(JSON.stringify(health.rows)).not.toContain('777');
    expect(health.rows).toContainEqual({
      entry_date: '2026-10-14',
      source_provider: 'healthkit',
      resting_heart_rate: 52,
    });
    expect(health.rows).toContainEqual(
      expect.objectContaining({ method: 'sdnn_ms', mean: 50, count: 2 })
    );
    expect(health.rows).toContainEqual(
      expect.objectContaining({ method: 'rmssd_ms', mean: 30, count: 1 })
    );
    const tests = String(
      await tools.sparky_read_cardio_tests!.execute!({}, toolOpts)
    );
    expect(tests).toContain('2400');
    const otherTools = buildTrainingAnalysisTools(otherId, scope);
    expect(
      JSON.parse(
        String(
          await otherTools.sparky_read_cardio_tests!.execute!({}, toolOpts)
        )
      ).attempts
    ).toEqual([]);
  });

  it('reads selected HealthKit daily HR and SDNN statistics separately and excludes unselected metrics', async () => {
    const summaries = [
      { category: 'heart_rate_min', mean: 48, unit: 'bpm' },
      { category: 'heart_rate_max', mean: 172, unit: 'bpm' },
      { category: 'heart_rate_avg', mean: 64, unit: 'bpm' },
      { category: 'HRV_SDNN_min', mean: 25, unit: 'ms' },
      { category: 'HRV_SDNN_max', mean: 80, unit: 'ms' },
      { category: 'HRV_SDNN_avg', mean: 52, unit: 'ms' },
    ];
    const db: PoolClient = await getSystemClient();
    try {
      for (const summary of summaries) {
        const categories = await db.query<{ id: string; user_id: string }>(
          `INSERT INTO custom_categories (user_id, name, frequency, measurement_type, data_type)
           VALUES ($1,$3,'Daily',$4,'numeric'), ($2,$3,'Daily',$4,'numeric') RETURNING id, user_id`,
          [ownerId, otherId, summary.category, summary.unit]
        );
        const ownerCategory = categories.rows.find(
          (row) => row.user_id === ownerId
        )!;
        const otherCategory = categories.rows.find(
          (row) => row.user_id === otherId
        )!;
        await db.query(
          `INSERT INTO custom_measurements (user_id, category_id, value, entry_date, source)
           VALUES ($1,$2,$3,'2026-10-15','HealthKit'), ($1,$2,'999','2026-10-15','manual'),
             ($1,$2,'999','2026-09-15','HealthKit'), ($4,$5,'999','2026-10-15','HealthKit')`,
          [
            ownerId,
            ownerCategory.id,
            String(summary.mean),
            otherId,
            otherCategory.id,
          ]
        );
      }
    } finally {
      db.release();
    }
    const scope = {
      start_date: '2026-10-12',
      end_date: '2026-10-18',
      programs: false,
      test_types: [],
      health_metrics: ['heart_rate' as const, 'hrv' as const],
    };
    const tools = buildTrainingAnalysisTools(ownerId, scope);
    const health = JSON.parse(
      String(await tools.sparky_read_training_health!.execute!({}, toolOpts))
    );
    const aggregateRows = health.rows.filter(
      (row: { category?: string }) =>
        row.category && summaries.some((s) => s.category === row.category)
    );
    expect(aggregateRows).toHaveLength(6);
    for (const summary of summaries)
      expect(aggregateRows).toContainEqual({
        ...summary,
        entry_date: '2026-10-15',
        source_provider: 'HealthKit',
        count: 1,
        min: summary.mean,
        max: summary.mean,
      });
    for (const metric of ['heart_rate', 'hrv'] as const) {
      const selectedTools = buildTrainingAnalysisTools(ownerId, {
        ...scope,
        health_metrics: [metric],
      });
      const selected = JSON.parse(
        String(
          await selectedTools.sparky_read_training_health!.execute!(
            {},
            toolOpts
          )
        )
      );
      const selectedAggregates = selected.rows.filter(
        (row: { category?: string }) =>
          row.category && summaries.some((s) => s.category === row.category)
      );
      expect(selectedAggregates).toHaveLength(3);
      expect(
        selectedAggregates
          .map((row: { category: string }) => row.category)
          .sort()
      ).toEqual(
        metric === 'heart_rate'
          ? ['heart_rate_avg', 'heart_rate_max', 'heart_rate_min']
          : ['HRV_SDNN_avg', 'HRV_SDNN_max', 'HRV_SDNN_min']
      );
    }
    const unselectedTools = buildTrainingAnalysisTools(ownerId, {
      ...scope,
      health_metrics: ['resting_heart_rate'],
    });
    const unselected = String(
      await unselectedTools.sparky_read_training_health!.execute!({}, toolOpts)
    );
    for (const summary of summaries)
      expect(unselected).not.toContain(summary.category);
  });

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
    const readScope = {
      start_date: '2026-10-01',
      end_date: '2026-10-01',
      programs: false,
      test_types: [cardioTestTypeSchema.parse(protocol)],
      health_metrics: [],
    };
    const readTools = buildTrainingAnalysisTools(ownerId, readScope);
    const analyzed = JSON.parse(
      String(await readTools.sparky_read_cardio_tests!.execute!({}, toolOpts))
    );
    expect(analyzed.attempts).toEqual([expect.objectContaining(input)]);
    const unrelatedTools = buildTrainingAnalysisTools(otherId, readScope);
    expect(
      JSON.parse(
        String(
          await unrelatedTools.sparky_read_cardio_tests!.execute!({}, toolOpts)
        )
      ).attempts
    ).toEqual([]);
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

  it('deletes a Program while a linked attempt is concurrently unlinked', async () => {
    const program = await createCooperProgram('Concurrent deletion');
    const planned = program.phases[0]!.weeks[0]!.sessions[0]!;
    const linked = await attempt({
      attempt_date: '2026-10-14',
      distance_meters: 2500,
      planned_session_id: planned.id,
    });
    expect(linked.status).toBe(201);
    const blocker = await getSystemClient();
    let unlink: Promise<{ status: number }> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query("SET LOCAL deadlock_timeout = '100ms'");
      await blocker.query("SET LOCAL statement_timeout = '5s'");
      await blocker.query(
        'SELECT id FROM training_programs WHERE id = $1 FOR UPDATE',
        [program.id]
      );
      unlink = Promise.resolve(
        request(app)
          .put(`/api/cardio-tests/cooper-run/attempts/${linked.body.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({
            attempt_date: '2026-10-14',
            distance_meters: 2500,
            planned_session_id: null,
          })
      ) as Promise<{ status: number }>;
      await waitForBlockedQuery('training_programs');
      await blocker.query('DELETE FROM training_programs WHERE id = $1', [
        program.id,
      ]);
      await blocker.query('COMMIT');
      const response = await unlink;
      expect(response?.status).toBe(409);
      const retained = await request(app)
        .get('/api/cardio-tests/cooper-run/attempts')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(retained.body[0].planned_session_id).toBeNull();
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
      await unlink;
    }
  });

  it('saves a Program while its attempt moves to another Program', async () => {
    const source = await createCooperProgram('Concurrent relink source');
    const target = await createCooperProgram('Concurrent relink target');
    const sourceSession = source.phases[0]!.weeks[0]!.sessions[0]!;
    const targetSession = target.phases[0]!.weeks[0]!.sessions[0]!;
    const linked = await attempt({
      attempt_date: '2026-10-14',
      distance_meters: 2500,
      planned_session_id: sourceSession.id,
    });
    expect(linked.status).toBe(201);
    const blocker = await getSystemClient();
    let save: Promise<{ status: number }> | undefined;
    let relink:
      | Promise<{ status: number; body: { planned_session_id: string } }>
      | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        'SELECT id FROM training_program_sessions WHERE id = $1 FOR UPDATE',
        [sourceSession.id]
      );
      save = Promise.resolve(
        request(app)
          .put(`/api/training-programs/${source.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({
            name: 'Concurrent relink source updated',
            goal: source.goal,
            start_date: source.start_date,
            end_date: source.end_date,
            schedule_type: source.schedule_type,
            auto_shift: source.auto_shift,
            phases: source.phases.map((phase) => ({
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
                  cardio_test_type: session.cardio_test_type,
                  is_optional: session.is_optional,
                })),
              })),
            })),
          })
      ) as Promise<{ status: number }>;
      await waitForBlockedQuery('training_program_sessions');
      relink = Promise.resolve(
        request(app)
          .put(`/api/cardio-tests/cooper-run/attempts/${linked.body.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({
            attempt_date: '2026-10-14',
            distance_meters: 2500,
            planned_session_id: targetSession.id,
          })
      ) as Promise<{ status: number; body: { planned_session_id: string } }>;
      await waitForBlockedQuery('training_programs');
      await blocker.query('COMMIT');
      const [saved, moved] = await Promise.all([save, relink]);
      expect(saved?.status).toBe(200);
      expect(moved?.status).toBe(200);
      expect(moved?.body.planned_session_id).toBe(targetSession.id);
      const previous = await request(app)
        .get(`/api/training-programs/${source.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      const current = await request(app)
        .get(`/api/training-programs/${target.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(previous.body.phases[0].weeks[0].sessions[0].status).toBe(
        'planned'
      );
      expect(current.body.phases[0].weeks[0].sessions[0].status).toBe(
        'completed'
      );
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
      await Promise.all([save, relink]);
    }
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
      const db = await getSystemClient();
      try {
        await db.query(
          "UPDATE training_programs SET updated_at = '2020-01-01T00:00:00Z' WHERE id = $1",
          [program.body.id]
        );
      } finally {
        db.release();
      }
      const unlinked = await request(app)
        .put(`${path}/${linked.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ ...input, planned_session_id: null });
      expect(unlinked.status).toBe(200);
      expect(unlinked.body.planned_session_id).toBeNull();
      const restored = await request(app)
        .get(`/api/training-programs/${program.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(new Date(restored.body.updated_at).getTime()).toBeGreaterThan(
        new Date('2020-01-01T00:00:00Z').getTime()
      );
      expect(restored.body.phases[0].weeks[0].sessions[0]).toMatchObject({
        status: 'planned',
        completed_test_attempt: null,
      });
    }
  );
});
