import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, describe, it, expect } from 'vitest';
import workoutPresetRepository from '../models/workoutPresetRepository.js';
import { endPool } from '../db/poolManager.js';

const optedIn = process.env.SPARKY_FITNESS_RUN_RIR_MIGRATION_TEST === '1';
describe.runIf(optedIn)(
  'strength RIR migration on disposable PostgreSQL',
  () => {
    it('backfills only missing strength RIR, preserves snapshots and is idempotent', async () => {
      if (!/test/i.test(process.env.SPARKY_FITNESS_DB_NAME ?? ''))
        throw new Error('Requires disposable test DB');
      const db = new pg.Client({
        host: process.env.SPARKY_FITNESS_DB_HOST,
        port: Number(process.env.SPARKY_FITNESS_DB_PORT),
        database: process.env.SPARKY_FITNESS_DB_NAME,
        user: process.env.SPARKY_FITNESS_DB_USER,
        password: process.env.SPARKY_FITNESS_DB_PASSWORD,
      });
      await db.connect();
      await db.query('BEGIN');
      try {
        const owner = randomUUID();
        await db.query('INSERT INTO public."user"(id,email) VALUES($1,$2)', [
          owner,
          `${owner}@example.test`,
        ]);
        // Disable the installed write trigger to seed genuine pre-upgrade data.
        await db.query('ALTER TABLE exercise_entry_sets DISABLE TRIGGER USER');
        const entries: string[] = [];
        for (const [category, modality] of [
          ['strength', 'weight_reps'],
          ['cardio', 'duration_distance'],
          ['isometric', 'duration'],
        ]) {
          const entry = await db.query(
            "INSERT INTO exercise_entries(user_id,exercise_name,entry_date,duration_minutes,calories_burned,category,modality) VALUES($1,'Test','2026-10-17',10,20,$2,$3) RETURNING id",
            [owner, category, modality]
          );
          entries.push(entry.rows[0].id);
        }
        for (const [entry, rpe, rir] of [
          [entries[0], 8, null],
          [entries[0], 12, null],
          [entries[0], -1, null],
          [entries[0], 9, 0],
          [entries[0], null, null],
          [entries[1], 8, null],
          [entries[2], 7.5, null],
        ]) {
          await db.query(
            'INSERT INTO exercise_entry_sets(exercise_entry_id,set_number,rpe,rir) VALUES($1,1,$2,$3)',
            [entry, rpe, rir]
          );
        }
        await db.query('ALTER TABLE exercise_entry_sets ENABLE TRIGGER USER');
        const exerciseId = randomUUID();
        await db.query(
          "INSERT INTO exercises(id,user_id,name,category,modality,is_custom,source) VALUES($1,$2,'Squat','strength','weight_reps',true,'manual')",
          [exerciseId, owner]
        );
        const plan = (
          await db.query(
            "INSERT INTO workout_plan_templates(user_id,plan_name,is_active) VALUES($1,'Migration test',false) RETURNING id",
            [owner]
          )
        ).rows[0].id;
        const session = (
          await db.query(
            "INSERT INTO workout_plan_sessions(template_id,user_id,name,sort_order) VALUES($1,$2,'Session',0) RETURNING id",
            [plan, owner]
          )
        ).rows[0].id;
        const assignment = (
          await db.query(
            'INSERT INTO workout_plan_template_assignments(template_id,workout_session_id,user_id,exercise_id,sort_order) VALUES($1,$2,$3,$4,0) RETURNING id',
            [plan, session, owner, exerciseId]
          )
        ).rows[0].id;
        await db.query(
          'ALTER TABLE workout_plan_assignment_sets DISABLE TRIGGER USER'
        );
        await db.query(
          'INSERT INTO workout_plan_assignment_sets(assignment_id,set_number,prescription) VALUES($1,1,\'{"rpe":8,"notes":"keep","extra":42}\')',
          [assignment]
        );
        await db.query(
          'ALTER TABLE workout_plan_assignment_sets ENABLE TRIGGER USER'
        );
        const snapshot = {
          id: 123,
          name: 'Frozen prescription',
          description: null,
          workout_format: 'standard',
          exercises: [
            {
              exercise_id: exerciseId,
              category: 'strength',
              modality: 'weight_reps',
              sets: [
                { set_number: 1, rpe: 8 },
                { set_number: 2, rpe: 9, rir: 0 },
              ],
            },
            {
              exercise_id: randomUUID(),
              category: 'cardio',
              modality: 'duration_distance',
              sets: [{ set_number: 1, rpe: 8 }],
            },
          ],
        };
        await db.query(
          'ALTER TABLE workout_plan_template_assignments DISABLE TRIGGER USER'
        );
        const frozen = (
          await db.query(
            'INSERT INTO workout_plan_template_assignments(template_id,workout_session_id,user_id,preset_snapshot,sort_order) VALUES($1,$2,$3,$4,1) RETURNING id',
            [plan, session, owner, JSON.stringify(snapshot)]
          )
        ).rows[0].id;
        await db.query(
          'ALTER TABLE workout_plan_template_assignments ENABLE TRIGGER USER'
        );
        const migration = readFileSync(
          new URL(
            '../db/migrations/20261018100000_strength_rir.sql',
            import.meta.url
          ),
          'utf8'
        );
        await db.query(migration);
        expect(
          (
            await db.query(
              'SELECT prescription FROM workout_plan_assignment_sets WHERE assignment_id=$1',
              [assignment]
            )
          ).rows[0].prescription
        ).toEqual({ rpe: 8, rir: 2, notes: 'keep', extra: 42 });
        const expectedSnapshot = structuredClone(snapshot);
        Object.assign(expectedSnapshot.exercises[0]!.sets[0]!, { rir: 2 });
        expect(
          (
            await db.query(
              'SELECT preset_snapshot FROM workout_plan_template_assignments WHERE id=$1',
              [frozen]
            )
          ).rows[0].preset_snapshot
        ).toEqual(expectedSnapshot);
        const sets = await db.query(
          'SELECT rpe::float8,rir::float8 FROM exercise_entry_sets WHERE exercise_entry_id = ANY($1::uuid[]) ORDER BY id',
          [entries]
        );
        expect(sets.rows.map((s) => s.rir)).toEqual([
          2,
          0,
          10,
          0,
          null,
          null,
          2.5,
        ]);
        expect(sets.rows.map((s) => s.rpe)).toEqual([
          8,
          12,
          -1,
          9,
          null,
          8,
          7.5,
        ]);
        await db.query(migration);
        expect(
          (
            await db.query(
              'SELECT rpe::float8,rir::float8 FROM exercise_entry_sets WHERE exercise_entry_id = ANY($1::uuid[]) ORDER BY id',
              [entries]
            )
          ).rows
        ).toEqual(sets.rows);
        await db.query(
          'INSERT INTO exercise_entry_sets(exercise_entry_id,set_number,rpe) VALUES($1,2,8)',
          [entries[0]]
        );
        expect(
          (
            await db.query(
              'SELECT rir::float8 FROM exercise_entry_sets WHERE exercise_entry_id=$1 AND set_number=2',
              [entries[0]]
            )
          ).rows[0].rir
        ).toBe(2);
      } finally {
        await db.query('ROLLBACK');
        await db.end();
      }
    });
  }
);
afterAll(async () => {
  await endPool();
});
it.runIf(optedIn)(
  'retains prescribed RIR through preset create, edit and add-exercise round trips',
  async () => {
    if (!/test/i.test(process.env.SPARKY_FITNESS_DB_NAME ?? ''))
      throw new Error('Requires disposable test DB');
    const db = new pg.Client({
      host: process.env.SPARKY_FITNESS_DB_HOST,
      port: Number(process.env.SPARKY_FITNESS_DB_PORT),
      database: process.env.SPARKY_FITNESS_DB_NAME,
      user: process.env.SPARKY_FITNESS_DB_USER,
      password: process.env.SPARKY_FITNESS_DB_PASSWORD,
    });
    await db.connect();
    const owner = randomUUID();
    const exerciseId = randomUUID();
    const secondId = randomUUID();
    try {
      await db.query('INSERT INTO public."user"(id,email) VALUES($1,$2)', [
        owner,
        `${owner}@example.test`,
      ]);
      for (const id of [exerciseId, secondId])
        await db.query(
          "INSERT INTO exercises(id,user_id,name,category,modality,is_custom,source) VALUES($1,$2,'Squat','strength','weight_reps',true,'manual')",
          [id, owner]
        );
      const preset = await workoutPresetRepository.createWorkoutPreset({
        user_id: owner,
        name: 'RIR round trip',
        exercises: [
          {
            exercise_id: exerciseId,
            sets: [{ set_number: 1, reps: 8, rir: 2 }],
          },
        ],
      });
      const read = async () =>
        workoutPresetRepository.getWorkoutPresetById(preset.id, owner);
      expect((await read()).exercises[0].sets[0].rir).toBe(2);
      await workoutPresetRepository.updateWorkoutPreset(preset.id, owner, {
        exercises: [
          {
            exercise_id: exerciseId,
            sets: [{ set_number: 1, reps: 8, rir: 0 }],
          },
        ],
      });
      expect((await read()).exercises[0].sets[0].rir).toBe(0);
      await workoutPresetRepository.addExerciseToWorkoutPreset(
        owner,
        preset.id,
        secondId,
        null,
        [{ set_number: 1, reps: 6, rir: 1.5 }],
        1
      );
      expect((await read()).exercises[1].sets[0].rir).toBe(1.5);
    } finally {
      await db.query('DELETE FROM public."user" WHERE id=$1', [owner]);
      await db.end();
    }
  }
);
