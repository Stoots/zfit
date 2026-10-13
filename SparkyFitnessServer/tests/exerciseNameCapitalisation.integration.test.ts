import { randomUUID, randomBytes } from 'node:crypto';
import express from 'express';
// @ts-expect-error TS7016 — supertest has no declarations in this package.
import request from 'supertest';
// @ts-expect-error TS7016 — cookie-parser has no declarations in this package.
import cookieParser from 'cookie-parser';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { getClient, getSystemClient, endPool } from '../db/poolManager.js';
import { toolOpts } from './helpers/toolExecutionOptions.js';
import errorHandler from '../middleware/errorHandler.js';
import exerciseRepository from '../models/exercise.js';
import exerciseEntryRepository from '../models/exerciseEntry.js';
import exercisePresetEntryRepository from '../models/exercisePresetEntryRepository.js';
import { getOrCreateGarminExercise } from '../services/garmin/garminExerciseMapper.js';
import { buildExerciseTools } from '../ai/tools/exerciseTools.js';

const optedIn = process.env.SPARKY_FITNESS_RUN_NAME_MIGRATION_TEST === '1';

describe.runIf(optedIn)(
  'persisted exercise-name contracts through authenticated workflows',
  () => {
    const app = express();
    let owner: string, other: string, token: string, otherToken: string;
    const lower = 'bench press with TRX and McGill';
    const correct = 'Bench press with TRX and McGill';

    beforeAll(async () => {
      if (!/test/i.test(process.env.SPARKY_FITNESS_DB_NAME ?? '')) {
        throw new Error(
          'Exercise-name integration tests require an explicitly opted-in disposable test database.'
        );
      }
      const db = await getSystemClient();
      try {
        await db.query('SELECT public.normalize_exercise_name_initial($1)', [
          lower,
        ]);
      } finally {
        db.release();
      }
      // Auth and routers eagerly validate the migrated database at module load;
      // defer them until the disposable-database safety gate has passed.
      const { auth } = await import('../auth.js');
      const accounts = await Promise.all(
        ['owner', 'other'].map((name) =>
          auth.api.signUpEmail({
            body: {
              name,
              email: `exercise-label-${name}-${randomUUID()}@example.test`,
              password: randomBytes(24).toString('base64'),
            },
          })
        )
      );
      owner = accounts[0]!.user.id;
      token = accounts[0]!.token!;
      other = accounts[1]!.user.id;
      otherToken = accounts[1]!.token!;
      const { authenticate } = await import('../middleware/authMiddleware.js');
      app.use(express.json(), cookieParser(), authenticate);
      app.use(
        '/api/exercises',
        (await import('../routes/exerciseRoutes.js')).default
      );
      app.use(
        '/api/exercise-entries',
        (await import('../routes/exerciseEntryRoutes.js')).default
      );
      app.use(
        '/api/workout-presets',
        (await import('../routes/workoutPresetRoutes.js')).default
      );
      app.use(
        '/api/workout-plan-templates',
        (await import('../routes/workoutPlanTemplateRoutes.js')).default
      );
      app.use(errorHandler);
    }, 30000);

    afterAll(async () => {
      if (owner && other) {
        const db = await getSystemClient();
        try {
          await db.query(
            'DELETE FROM public."user" WHERE id = ANY($1::uuid[])',
            [[owner, other]]
          );
        } finally {
          db.release();
        }
      }
      await endPool();
    });

    async function create(name = lower) {
      const response = await request(app)
        .post('/api/exercises')
        .set('Authorization', `Bearer ${token}`)
        .field(
          'exerciseData',
          JSON.stringify({
            name,
            category: 'strength',
            modality: 'weight_reps',
            calories_per_hour: 200,
            description: 'Unchanged McGill instructions',
            is_custom: true,
            shared_with_public: false,
            source: 'manual',
            equipment: ['TRX'],
          })
        );
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      return response.body;
    }
    async function get(path: string) {
      const response = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${token}`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return response.body;
    }

    it('stores create/edit names, exposes them in preset/plan/diary contracts, and keeps history wording after rename/delete', async () => {
      const exercise = await create();
      expect(exercise).toMatchObject({
        name: correct,
        user_id: owner,
        equipment: '["TRX"]',
      });
      expect(await get(`/api/exercises/${exercise.id}`)).toMatchObject({
        id: exercise.id,
        name: correct,
        description: exercise.description,
      });
      const prescription = {
        set_number: 1,
        reps: 8,
        weight: null,
        rest_time: 90,
        notes: '8–10 each side',
      };
      const preset = await request(app)
        .post('/api/workout-presets')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Preset label unchanged',
          exercises: [{ exercise_id: exercise.id, sets: [prescription] }],
        });
      expect(preset.status, JSON.stringify(preset.body)).toBe(201);
      const savedPreset = await get(`/api/workout-presets/${preset.body.id}`);
      expect(savedPreset.exercises[0]).toMatchObject({
        exercise_id: exercise.id,
        exercise_name: correct,
        sets: [expect.objectContaining(prescription)],
      });
      const plan = await request(app)
        .post('/api/workout-plan-templates')
        .set('Authorization', `Bearer ${token}`)
        .send({
          plan_name: 'Plan label unchanged',
          is_active: false,
          schedule_type: 'weekly',
          sessions: [
            {
              name: 'Session label unchanged',
              day_of_week: 1,
              sort_order: 0,
              assignments: [
                {
                  exercise_id: exercise.id,
                  sort_order: 0,
                  sets: [prescription],
                },
              ],
            },
          ],
        });
      expect(plan.status, JSON.stringify(plan.body)).toBe(201);
      const savedPlan = await get(
        `/api/workout-plan-templates/${plan.body.id}`
      );
      expect(savedPlan.sessions[0].assignments[0]).toMatchObject({
        exercise_id: exercise.id,
        exercise_name: correct,
        sets: [expect.objectContaining(prescription)],
      });
      const logged = await request(app)
        .post('/api/exercise-entries')
        .set('Authorization', `Bearer ${token}`)
        .send({
          exercise_id: exercise.id,
          entry_date: '2025-10-01',
          duration_minutes: 12,
          calories_burned: 80,
          notes: 'Recorded separately',
          sets: [
            {
              set_number: 1,
              reps: 7,
              weight: 32.5,
              rest_time: 95,
              notes: 'Actual per-side result',
            },
          ],
        });
      expect(logged.status, JSON.stringify(logged.body)).toBe(201);
      expect(logged.body).toMatchObject({
        exercise_id: exercise.id,
        exercise_name: correct,
      });
      const entryId = logged.body.id;
      const changed = await request(app)
        .put(`/api/exercise-entries/${entryId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ exercise_name: 'old McGill TRX diary wording' });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      const historical = await get(`/api/exercise-entries/${entryId}`);
      expect(historical.exercise_name).toBe('Old McGill TRX diary wording');
      const renamed = await request(app)
        .put(`/api/exercises/${exercise.id}`)
        .set('Authorization', `Bearer ${token}`)
        .field(
          'exerciseData',
          JSON.stringify({ name: 'new McGill exercise wording' })
        );
      expect(renamed.status).toBe(200);
      expect(renamed.body).toMatchObject({
        id: exercise.id,
        name: 'New McGill exercise wording',
        description: exercise.description,
      });
      expect(await get(`/api/exercise-entries/${entryId}`)).toEqual(historical);
      const removed = await request(app)
        .delete(`/api/exercises/${exercise.id}?mode=delete`)
        .set('Authorization', `Bearer ${token}`);
      expect(removed.status, JSON.stringify(removed.body)).toBe(200);
      expect(await get(`/api/exercise-entries/${entryId}`)).toEqual({
        ...historical,
        exercise_id: null,
      });
      const diary = await get(
        '/api/exercise-entries/by-date?selectedDate=2025-10-01'
      );
      expect(diary).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: entryId,
            name: 'Old McGill TRX diary wording',
          }),
        ])
      );
    });

    it('normalizes direct repository snapshots independently and rejects another owner at HTTP and RLS boundaries', async () => {
      const exercise = await create('TRX McGill row');
      const repository = exerciseEntryRepository;
      const entry = await repository.createExerciseEntry(
        owner,
        {
          exercise_id: exercise.id,
          exercise_name: 'direct McGill TRX snapshot',
          entry_date: '2025-10-02',
          duration_minutes: 4,
          calories_burned: 25,
          notes: 'Keep direct snapshot values',
        },
        owner,
        'manual',
        null,
        { skipDuplicateCheck: true }
      );
      expect(await get(`/api/exercise-entries/${entry.id}`)).toMatchObject({
        exercise_name: 'Direct McGill TRX snapshot',
        exercise_id: exercise.id,
        user_id: owner,
        duration_minutes: 4,
        calories_burned: 25,
      });
      for (const path of [
        `/api/exercises/${exercise.id}`,
        `/api/exercise-entries/${entry.id}`,
      ]) {
        const forbidden = await request(app)
          .get(path)
          .set('Authorization', `Bearer ${otherToken}`);
        expect([403, 404]).toContain(forbidden.status);
      }
      const denied = await request(app)
        .put(`/api/exercise-entries/${entry.id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ exercise_name: 'attack TRX' });
      expect([403, 404]).toContain(denied.status);
      const scoped = await getClient(other, other);
      try {
        expect(
          (
            await scoped.query(
              'SELECT id FROM public.exercise_entries WHERE id=$1',
              [entry.id]
            )
          ).rows
        ).toEqual([]);
        expect(
          (
            await scoped.query(
              'UPDATE public.exercises SET name=$1 WHERE id=$2 RETURNING id',
              ['attack TRX', exercise.id]
            )
          ).rows
        ).toEqual([]);
      } finally {
        scoped.release();
      }
      expect(await get(`/api/exercise-entries/${entry.id}`)).toMatchObject({
        exercise_name: 'Direct McGill TRX snapshot',
      });
    });

    it('imports historical CSV names using the existing identity while preserving remainder-case distinctions and recorded values', async () => {
      const exercise = await create('csv McGill TRX row');
      const entries = [
        'csv McGill TRX row',
        'csv McGill trx row',
        'new CSV McGill row',
      ].map((exercise_name, i) => ({
        exercise_name,
        entry_date: `2025-11-0${i + 1}`,
        entry_notes: 'Import record',
        calories_burned: 123,
        exercise_category: 'strength',
        sets: [
          {
            set_number: 1,
            reps: 9,
            weight: 24.5,
            duration_min: 0.5,
            rest_time_sec: 75,
            notes: 'Per side',
          },
        ],
      }));
      const response = await request(app)
        .post('/api/exercise-entries/import-history-csv')
        .set('Authorization', `Bearer ${token}`)
        .send({ entries });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(response.body).toMatchObject({ created: 3, failed: 0 });
      const db = await getClient(owner);
      try {
        const rows = (
          await db.query(
            "SELECT id,exercise_id,exercise_name,calories_burned,notes FROM public.exercise_entries WHERE user_id=$1 AND entry_date BETWEEN '2025-11-01' AND '2025-11-03' ORDER BY entry_date",
            [owner]
          )
        ).rows;
        expect(rows).toMatchObject([
          {
            exercise_id: exercise.id,
            exercise_name: 'Csv McGill TRX row',
            calories_burned: 123,
          },
          { exercise_name: 'Csv McGill trx row' },
          { exercise_name: 'New CSV McGill row' },
        ]);
        expect(rows[1].exercise_id).not.toBe(exercise.id);
        const sets = (
          await db.query(
            'SELECT reps,weight,duration,rest_time,notes FROM public.exercise_entry_sets WHERE exercise_entry_id=$1',
            [rows[0].id]
          )
        ).rows;
        expect(sets).toEqual([
          {
            reps: 9,
            weight: 24.5,
            duration: 30,
            rest_time: 75,
            notes: 'Per side',
          },
        ]);
        expect(
          (
            await db.query(
              'SELECT id FROM public.exercises WHERE user_id=$1 AND name=$2',
              [owner, 'Csv McGill TRX row']
            )
          ).rows
        ).toEqual([{ id: exercise.id }]);
      } finally {
        db.release();
      }
    });

    it('humanises Garmin enum names, preserves acronyms, and title-cases legacy matches', async () => {
      const first = await getOrCreateGarminExercise(
        owner,
        'trx McGill row',
        'ROW'
      );
      expect(first.name).toBe('TRX McGill Row');
      expect(
        (await getOrCreateGarminExercise(owner, 'trx McGill row', 'ROW')).id
      ).toBe(first.id);
      const acronym = await getOrCreateGarminExercise(
        owner,
        'TRX McGill curl',
        'CURL'
      );
      expect(acronym.name).toBe('TRX McGill Curl');
      const imported = await getOrCreateGarminExercise(
        owner,
        'LEG_EXTENSION',
        'LEG_EXTENSION'
      );
      expect(imported.name).toBe('Leg Extension');
      const legacy = await create('LEG CURL');
      expect(
        (await getOrCreateGarminExercise(owner, 'LEG_CURL', 'LEG_CURL')).id
      ).toBe(legacy.id);
      expect(await get(`/api/exercises/${legacy.id}`)).toMatchObject({
        name: 'Leg Curl',
      });
      const title = await create('Leg Press');
      expect(
        (await getOrCreateGarminExercise(owner, 'LEG_PRESS', 'LEG_PRESS')).id
      ).toBe(title.id);
      expect(await get(`/api/exercises/${title.id}`)).toMatchObject({
        name: 'Leg Press',
      });
      const provider = await request(app)
        .post('/api/exercises/add-nutritionix-exercise')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'provider TRX McGill row',
          external_id: 'synthetic-name-test',
          category: 'strength',
          calories_per_hour: 200,
        });
      expect(provider.status, JSON.stringify(provider.body)).toBe(201);
      expect(await get(`/api/exercises/${provider.body.id}`)).toMatchObject({
        name: 'Provider TRX McGill row',
        source: 'nutritionix',
      });
      const repository = exerciseRepository;
      const sourced = await repository.createExercise({
        user_id: owner,
        name: 'provider McGill identity',
        source: 'hevy',
        source_id: 'unchanged-template-id',
        category: 'strength',
        is_custom: true,
        shared_with_public: false,
      });
      expect(
        await repository.getExerciseBySourceAndSourceId(
          'hevy',
          'unchanged-template-id',
          owner
        )
      ).toMatchObject({
        id: sourced.id,
        name: 'Provider McGill identity',
        source_id: 'unchanged-template-id',
        user_id: owner,
      });
    });

    it('retains Garmin title-case alias precedence and all coexisting exercise identities', async () => {
      const title = await exerciseRepository.createExercise({
        user_id: other,
        name: 'Leg Curl',
        source: 'garmin',
        source_id: 'title-alias',
        category: 'strength',
        primary_muscles: ['hamstrings'],
        description: 'Established movement A',
        is_custom: true,
        shared_with_public: false,
      });
      const uppercase = await exerciseRepository.createExercise({
        user_id: other,
        name: 'LEG CURL',
        source: 'garmin',
        source_id: 'uppercase-alias',
        category: 'strength',
        primary_muscles: ['hamstrings'],
        description: 'Distinct movement B',
        is_custom: true,
        shared_with_public: false,
      });
      const db = await getClient(other);
      try {
        const before = (
          await db.query(
            'SELECT * FROM exercises WHERE id = ANY($1::uuid[]) ORDER BY id',
            [[title.id, uppercase.id]]
          )
        ).rows;
        for (const rawName of ['LEG_CURL', 'leg_curl', 'LEG CURL']) {
          expect(
            (await getOrCreateGarminExercise(other, rawName, 'LEG_CURL')).id
          ).toBe(title.id);
        }
        expect(
          (
            await db.query(
              'SELECT * FROM exercises WHERE id = ANY($1::uuid[]) ORDER BY id',
              [[title.id, uppercase.id]]
            )
          ).rows
        ).toEqual(before);
      } finally {
        db.release();
      }
    });

    it('persists AI tool create/log output and library JSON import names without overwriting substring matches', async () => {
      const tool = buildExerciseTools(owner, 'UTC').sparky_manage_exercise;
      const created = await tool.execute!(
        {
          action: 'create_exercise',
          name: 'ai TRX McGill curl',
          category: 'strength',
        },
        toolOpts
      );
      expect(created).toContain('Ai TRX McGill curl');
      await tool.execute!(
        {
          action: 'log_exercise',
          exercise_name: 'ai TRX McGill curl',
          entry_date: '2025-12-01',
          duration_minutes: 10,
          calories_burned: 50,
          notes: 'AI recorded result',
        },
        toolOpts
      );
      const db = await getClient(owner);
      try {
        expect(
          (
            await db.query(
              "SELECT exercise_name,calories_burned,notes FROM public.exercise_entries WHERE user_id=$1 AND entry_date='2025-12-01'",
              [owner]
            )
          ).rows
        ).toEqual([
          {
            exercise_name: 'Ai TRX McGill curl',
            calories_burned: 50,
            notes: 'AI recorded result',
          },
        ]);
      } finally {
        db.release();
      }
      const existing = await create('Imported McGill TRX row long variant');
      const imported = await request(app)
        .post('/api/exercises/import-json')
        .set('Authorization', `Bearer ${token}`)
        .send({
          exercises: [
            {
              name: 'imported McGill TRX row',
              primary_muscles: 'back',
              category: 'strength',
              is_custom: true,
            },
          ],
        });
      expect(imported.status, JSON.stringify(imported.body)).toBe(201);
      expect(imported.body).toMatchObject({
        created: 1,
        updated: 0,
        failed: 0,
      });
      expect(await get(`/api/exercises/${existing.id}`)).toMatchObject({
        name: 'Imported McGill TRX row long variant',
        description: existing.description,
      });
      const search = await get(
        '/api/exercises/search?searchTerm=imported%20McGill%20TRX%20row'
      );
      expect(search).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Imported McGill TRX row' }),
          expect.objectContaining({ id: existing.id }),
        ])
      );
    });

    it('imports a real library CSV using exact names, never a substring movement', async () => {
      const existing = await create('Csv McGill curl long variant');
      const csv =
        'name,primary_muscles,category,calories_per_hour\ncsv McGill curl,back,strength,180\n';
      const first = await request(app)
        .post('/api/exercises/import')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from(csv), 'exercise-labels.csv');
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      expect(first.body).toMatchObject({ created: 1, updated: 0, failed: 0 });
      const matches = await get(
        '/api/exercises/search?searchTerm=Csv%20McGill%20curl'
      );
      const imported = matches.find(
        (row: { name: string }) => row.name === 'Csv McGill curl'
      );
      expect(imported).toMatchObject({ calories_per_hour: 180 });
      expect(imported.id).not.toBe(existing.id);
      const repeated = await request(app)
        .post('/api/exercises/import')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from(csv), 'exercise-labels.csv');
      expect(repeated.status, JSON.stringify(repeated.body)).toBe(201);
      expect(repeated.body).toMatchObject({
        created: 0,
        updated: 1,
        failed: 0,
      });
      expect(await get(`/api/exercises/${imported.id}`)).toMatchObject({
        id: imported.id,
        name: 'Csv McGill curl',
      });
      expect(await get(`/api/exercises/${existing.id}`)).toMatchObject({
        name: 'Csv McGill curl long variant',
        description: existing.description,
      });
    });

    it('imports a visible CSV movement without updating its hidden exact-name counterpart', async () => {
      const hidden = await create('hidden CSV McGill TRX row');
      const hide = await request(app)
        .delete(`/api/exercises/${hidden.id}?mode=hide`)
        .set('Authorization', `Bearer ${token}`);
      expect(hide.status, JSON.stringify(hide.body)).toBe(200);
      expect(hide.body).toMatchObject({ status: 'hidden' });
      const searchPath =
        '/api/exercises/search?searchTerm=hidden%20CSV%20McGill%20TRX%20row';
      expect(await get(searchPath)).toEqual([]);
      // History/provider lookups must still see hidden exercises by default.
      expect(
        await exerciseRepository.findExerciseByNameAndUserId(
          'hidden CSV McGill TRX row',
          owner
        )
      ).toMatchObject({ id: hidden.id, description: hidden.description });
      const db = await getClient(owner);
      try {
        const before = (
          await db.query('SELECT * FROM exercises WHERE id=$1', [hidden.id])
        ).rows[0];
        expect(before.is_quick_exercise).toBe(true);
        const csv =
          'name,primary_muscles,category,calories_per_hour,description\nhidden CSV McGill TRX row,back,strength,180,Visible imported metadata\n';
        const first = await request(app)
          .post('/api/exercises/import')
          .set('Authorization', `Bearer ${token}`)
          .attach('file', Buffer.from(csv), 'visible-exercise.csv');
        expect(first.status, JSON.stringify(first.body)).toBe(201);
        expect(first.body).toMatchObject({ created: 1, updated: 0, failed: 0 });
        const visible = await get(searchPath);
        expect(visible).toEqual([
          expect.objectContaining({
            name: 'Hidden CSV McGill TRX row',
            description: 'Visible imported metadata',
            calories_per_hour: 180,
          }),
        ]);
        expect(visible[0].id).not.toBe(hidden.id);
        const repeated = await request(app)
          .post('/api/exercises/import')
          .set('Authorization', `Bearer ${token}`)
          .attach('file', Buffer.from(csv), 'visible-exercise.csv');
        expect(repeated.status, JSON.stringify(repeated.body)).toBe(201);
        expect(repeated.body).toMatchObject({
          created: 0,
          updated: 1,
          failed: 0,
        });
        expect(await get(searchPath)).toEqual([
          expect.objectContaining({ id: visible[0].id }),
        ]);
        expect(
          (await db.query('SELECT * FROM exercises WHERE id=$1', [hidden.id]))
            .rows[0]
        ).toEqual(before);
      } finally {
        db.release();
      }
    });

    it('imports an owned copy instead of updating another user’s shared exact-name exercise', async () => {
      const name = 'shared CSV cable row';
      const shared = await request(app)
        .post('/api/exercises')
        .set('Authorization', `Bearer ${otherToken}`)
        .field(
          'exerciseData',
          JSON.stringify({
            name,
            category: 'strength',
            modality: 'weight_reps',
            calories_per_hour: 200,
            description: 'Other owner description',
            is_custom: true,
            shared_with_public: true,
            source: 'manual',
          })
        );
      expect(shared.status, JSON.stringify(shared.body)).toBe(201);

      const csv =
        'name,primary_muscles,category,description\nshared CSV cable row,back,strength,Owner import description\n';
      const first = await request(app)
        .post('/api/exercises/import')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from(csv), 'shared-exercise.csv');
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      expect(first.body).toMatchObject({ created: 1, updated: 0, failed: 0 });

      const own = await exerciseRepository.findExerciseByNameAndUserId(
        name,
        owner
      );
      expect(own).toMatchObject({
        user_id: owner,
        description: 'Owner import description',
      });
      expect(own.id).not.toBe(shared.body.id);

      const otherDb = await getClient(other, other);
      try {
        expect(
          (
            await otherDb.query(
              'SELECT description FROM public.exercises WHERE id=$1',
              [shared.body.id]
            )
          ).rows
        ).toEqual([{ description: 'Other owner description' }]);
      } finally {
        otherDb.release();
      }

      const repeated = await request(app)
        .post('/api/exercises/import')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from(csv), 'shared-exercise.csv');
      expect(repeated.status, JSON.stringify(repeated.body)).toBe(201);
      expect(repeated.body).toMatchObject({
        created: 0,
        updated: 1,
        failed: 0,
      });
      expect(
        await exerciseRepository.findExerciseByNameAndUserId(name, owner)
      ).toMatchObject({
        id: own.id,
        user_id: owner,
        description: 'Owner import description',
      });
    });

    it('preserves the legacy by-date row and preset-child fields', async () => {
      const exercise = await create('Legacy response exercise');
      const entryDate = '2025-10-04';
      const preset =
        await exercisePresetEntryRepository.createExercisePresetEntry(
          owner,
          { name: 'Legacy preset response', entry_date: entryDate },
          owner
        );
      const child = await exerciseEntryRepository.createExerciseEntry(
        owner,
        {
          exercise_id: exercise.id,
          exercise_name: 'Legacy preset child snapshot',
          entry_date: entryDate,
          duration_minutes: 3,
          calories_burned: 20,
          sort_order: 4,
          sets: [],
        },
        owner,
        'Manual',
        preset.id,
        { skipDuplicateCheck: true }
      );
      const individual = await exerciseEntryRepository.createExerciseEntry(
        owner,
        {
          exercise_id: exercise.id,
          exercise_name: 'Legacy individual snapshot',
          entry_date: entryDate,
          duration_minutes: 5,
          calories_burned: 30,
          sort_order: 9,
          sets: [],
        },
        owner,
        'Manual',
        null,
        { skipDuplicateCheck: true }
      );

      const diary = await get(
        `/api/exercise-entries/by-date?selectedDate=${entryDate}`
      );
      const individualRow = diary.find(
        (row: { id: string }) => row.id === individual.id
      );
      expect(individualRow).toMatchObject({
        name: 'Legacy individual snapshot',
        sort_order: 9,
        user_id: owner,
        created_by_user_id: owner,
        updated_at: expect.any(String),
      });
      const presetRow = diary.find(
        (row: { id: string }) => row.id === preset.id
      );
      expect(presetRow.exercises).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: child.id,
            name: 'Legacy preset child snapshot',
            sort_order: 4,
            user_id: owner,
            created_by_user_id: owner,
            updated_at: expect.any(String),
          }),
        ])
      );
    });
  }
);
