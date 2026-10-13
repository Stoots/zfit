import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const optedIn = process.env.SPARKY_FITNESS_RUN_NAME_MIGRATION_TEST === '1';
const migration = readFileSync(
  new URL(
    '../db/migrations/20261011101000_normalize_exercise_name_initial.sql',
    import.meta.url
  ),
  'utf8'
);

// This suite executes broad historical UPDATEs. Reachability alone is not consent.
describe.runIf(optedIn)(
  'exercise label-only migration on disposable PostgreSQL',
  () => {
    let db: pg.Client;
    const owner = randomUUID();
    const renamed = randomUUID();
    const deleted = randomUUID();
    const names = [
      'current McGill TRX name',
      'TRX row',
      'élevated McGill curl',
      'same movement',
      'Same movement',
    ];
    const ids = [renamed, ...names.slice(1).map(() => randomUUID())];

    beforeAll(async () => {
      if (!/test/i.test(process.env.SPARKY_FITNESS_DB_NAME ?? '')) {
        throw new Error(
          'Name migration tests require an explicitly opted-in disposable test database.'
        );
      }
      db = new pg.Client({
        host: process.env.SPARKY_FITNESS_DB_HOST,
        port: Number(process.env.SPARKY_FITNESS_DB_PORT) || 5432,
        database: process.env.SPARKY_FITNESS_DB_NAME,
        user: process.env.SPARKY_FITNESS_DB_USER,
        password: process.env.SPARKY_FITNESS_DB_PASSWORD,
        connectionTimeoutMillis: 5000,
      });
      await db.connect(); // Opted-in connection failures are failures, never skips.
      await db.query(
        'INSERT INTO public."user"(id,email,email_verified) VALUES($1,$2,true)',
        [owner, `label-migration-${owner}@example.test`]
      );
    });

    beforeEach(async () => {
      await db.query('DELETE FROM public.training_programs WHERE user_id=$1', [
        owner,
      ]);
      await db.query('DELETE FROM public.exercise_entries WHERE user_id=$1', [
        owner,
      ]);
      await db.query(
        'DELETE FROM public.workout_plan_templates WHERE user_id=$1',
        [owner]
      );
      await db.query('DELETE FROM public.workout_presets WHERE user_id=$1', [
        owner,
      ]);
      await db.query('DELETE FROM public.exercises WHERE user_id=$1', [owner]);
      await db.query('BEGIN');
      try {
        // Seed genuine pre-upgrade labels without removing the installed guards.
        // DDL locks prevent any concurrent writer from observing disabled guards.
        await db.query(
          'ALTER TABLE public.exercises DISABLE TRIGGER normalize_exercise_library_name'
        );
        await db.query(
          'ALTER TABLE public.exercise_entries DISABLE TRIGGER normalize_exercise_snapshot_name'
        );
        for (let i = 0; i < names.length; i++) {
          await db.query(
            `INSERT INTO public.exercises(id,user_id,name,source,source_id,category,modality,is_custom,shared_with_public,description,equipment,created_at,updated_at)
          VALUES($1,$2,$3,'garmin',$4,'strength','weight_reps',true,false,'Retain every non-name field','["TRX"]','2025-01-01','2025-01-02')`,
            [ids[i], owner, names[i], `movement-${i}`]
          );
        }
        await db.query(
          "INSERT INTO public.exercises(id,user_id,name,source,category,is_custom) VALUES($1,$2,'deleted old TRX row','manual','strength',true)",
          [deleted, owner]
        );
        const plan = (
          await db.query(
            "INSERT INTO public.workout_plan_templates(user_id,plan_name,is_active) VALUES($1,'Unchanged plan',false) RETURNING id",
            [owner]
          )
        ).rows[0].id;
        const session = (
          await db.query(
            "INSERT INTO public.workout_plan_sessions(template_id,user_id,name,day_of_week,sort_order) VALUES($1,$2,'Unchanged session',1,0) RETURNING id",
            [plan, owner]
          )
        ).rows[0].id;
        const assignment = (
          await db.query(
            'INSERT INTO public.workout_plan_template_assignments(template_id,workout_session_id,user_id,exercise_id,sort_order) VALUES($1,$2,$3,$4,3) RETURNING id',
            [plan, session, owner, renamed]
          )
        ).rows[0].id;
        await db.query(
          "INSERT INTO public.workout_plan_assignment_sets(assignment_id,set_number,reps,weight,rest_time,notes) VALUES($1,1,8,NULL,90,'8–10 reps each side; do not invent load')",
          [assignment]
        );
        const programId = randomUUID();
        const phaseId = randomUUID();
        const weekId = randomUUID();
        await db.query(
          "INSERT INTO public.training_programs(id,user_id,name,goal,start_date,end_date) VALUES($1,$2,'Name migration','Strength','2025-03-01','2025-03-07')",
          [programId, owner]
        );
        await db.query(
          "INSERT INTO public.training_program_phases(id,program_id,user_id,name,goal,sort_order) VALUES($1,$2,$3,'Phase','Strength',0)",
          [phaseId, programId, owner]
        );
        await db.query(
          "INSERT INTO public.training_program_weeks(id,program_id,phase_id,user_id,start_date,end_date,sort_order) VALUES($1,$2,$3,$4,'2025-03-01','2025-03-07',0)",
          [weekId, programId, phaseId, owner]
        );
        for (const [index, workout] of [
          [
            0,
            {
              type: 'individual',
              id: randomUUID(),
              name: 'lowercase individual',
              entry_date: '2025-03-02',
            },
          ],
          [
            1,
            {
              type: 'preset',
              id: randomUUID(),
              name: 'lowercase preset',
              entry_date: '2025-03-03',
            },
          ],
        ] as const) {
          await db.query(
            `INSERT INTO public.training_program_sessions
              (program_id,week_id,user_id,name,scheduled_date,effective_date,workout_session_id,workout_session_name_snapshot,sort_order,status,outcome_at,completed_workout,workout_plan_name_snapshot)
             VALUES($1,$2,$3,'History','2025-03-02','2025-03-02',$4,'Unchanged session',$5,'completed',now(),$6::jsonb,'Unchanged plan')`,
            [programId, weekId, owner, session, index, JSON.stringify(workout)]
          );
        }
        const preset = (
          await db.query(
            "INSERT INTO public.workout_presets(user_id,name) VALUES($1,'Unchanged preset') RETURNING id",
            [owner]
          )
        ).rows[0].id;
        await db.query(
          'INSERT INTO public.workout_preset_exercises(workout_preset_id,exercise_id,sort_order) VALUES($1,$2,4)',
          [preset, renamed]
        );
        for (const [exerciseId, label] of [
          [renamed, 'old McGill TRX wording'],
          [deleted, 'deleted old TRX row'],
          [null, 'unlinked historical McGill label'],
        ] as const) {
          const entry = (
            await db.query(
              `INSERT INTO public.exercise_entries(user_id,exercise_id,exercise_name,entry_date,duration_minutes,calories_burned,notes,source,source_id,modality,distance,avg_heart_rate,created_at,updated_at,workout_plan_assignment_id)
          VALUES($1,$2,$3,'2025-02-03',17.5,123.4,'Recorded wording stays intact','garmin',$4,'weight_reps',1.25,137,'2025-02-03','2025-02-04',$5) RETURNING id`,
              [
                owner,
                exerciseId,
                label,
                randomUUID(),
                exerciseId === renamed ? assignment : null,
              ]
            )
          ).rows[0].id;
          await db.query(
            "INSERT INTO public.exercise_entry_sets(exercise_entry_id,set_number,reps,weight,duration,rest_time,notes,rpe,rir,completed_at) VALUES($1,1,9,32.5,45,90,'Each side; preserve',8,2,'2025-02-03')",
            [entry]
          );
          await db.query(
            `INSERT INTO public.exercise_entry_activity_details(exercise_entry_id,provider_name,detail_type,detail_data)
            VALUES($1,'garmin','full_activity_data','{"name":"raw provider text","heartRate":137}')`,
            [entry]
          );
        }
        await db.query('DELETE FROM public.exercises WHERE id=$1', [deleted]);
        await db.query(
          'ALTER TABLE public.exercises ENABLE TRIGGER normalize_exercise_library_name'
        );
        await db.query(
          'ALTER TABLE public.exercise_entries ENABLE TRIGGER normalize_exercise_snapshot_name'
        );
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    });

    afterAll(async () => {
      if (!db) return;
      await db.query('ROLLBACK');
      await db.query('DELETE FROM public.exercise_entries WHERE user_id=$1', [
        owner,
      ]);
      await db.query('DELETE FROM public."user" WHERE id=$1', [owner]);
      await db.end();
    });

    async function snapshot() {
      const queries = {
        exercises:
          'SELECT to_jsonb(e) AS row FROM public.exercises e WHERE user_id=$1 ORDER BY id',
        entries:
          'SELECT to_jsonb(e) AS row FROM public.exercise_entries e WHERE user_id=$1 ORDER BY id',
        sets: 'SELECT to_jsonb(s) AS row FROM public.exercise_entry_sets s JOIN public.exercise_entries e ON e.id=s.exercise_entry_id WHERE e.user_id=$1 ORDER BY s.id',
        details:
          'SELECT to_jsonb(d) AS row FROM public.exercise_entry_activity_details d JOIN public.exercise_entries e ON e.id=d.exercise_entry_id WHERE e.user_id=$1 ORDER BY d.id',
        plans:
          'SELECT to_jsonb(p) AS row FROM public.workout_plan_templates p WHERE user_id=$1 ORDER BY id',
        sessions:
          'SELECT to_jsonb(s) AS row FROM public.workout_plan_sessions s WHERE user_id=$1 ORDER BY id',
        programSessions:
          'SELECT to_jsonb(s) AS row FROM public.training_program_sessions s WHERE user_id=$1 ORDER BY id',
        assignments:
          'SELECT to_jsonb(a) AS row FROM public.workout_plan_template_assignments a JOIN public.workout_plan_templates p ON p.id=a.template_id WHERE p.user_id=$1 ORDER BY a.id',
        prescriptions:
          'SELECT to_jsonb(s) AS row FROM public.workout_plan_assignment_sets s JOIN public.workout_plan_template_assignments a ON a.id=s.assignment_id JOIN public.workout_plan_templates p ON p.id=a.template_id WHERE p.user_id=$1 ORDER BY s.id',
        presets:
          'SELECT to_jsonb(p) AS row FROM public.workout_presets p WHERE user_id=$1 ORDER BY id',
        memberships:
          'SELECT to_jsonb(e) AS row FROM public.workout_preset_exercises e JOIN public.workout_presets p ON p.id=e.workout_preset_id WHERE p.user_id=$1 ORDER BY e.id',
      };
      const result: Record<string, Record<string, unknown>[]> = {};
      for (const [table, query] of Object.entries(queries)) {
        result[table] = (await db.query(query, [owner])).rows.map(
          (row) => row.row
        );
      }
      return result;
    }

    it('corrects each stored label only, preserves full identities/history/prescriptions, and repeats without writes', async () => {
      const before = await snapshot();
      await db.query(migration);
      const after = await snapshot();
      for (const [table, rows] of Object.entries(before)) {
        expect(after[table]).toEqual(
          rows.map((row) => {
            if (
              table === 'programSessions' &&
              row.status === 'completed' &&
              typeof row.completed_workout === 'object' &&
              row.completed_workout !== null
            ) {
              const completedWorkout = row.completed_workout as Record<
                string,
                unknown
              >;
              if (
                completedWorkout.type === 'individual' &&
                typeof completedWorkout.name === 'string'
              ) {
                return {
                  ...row,
                  completed_workout: {
                    ...completedWorkout,
                    name:
                      completedWorkout.name.slice(0, 1).toUpperCase() +
                      completedWorkout.name.slice(1),
                  },
                };
              }
            }
            const field =
              table === 'exercises'
                ? 'name'
                : table === 'entries'
                  ? 'exercise_name'
                  : null;
            if (!field || typeof row[field] !== 'string') return row;
            const value = row[field];
            return {
              ...row,
              [field]: value.slice(0, 1).toUpperCase() + value.slice(1),
            };
          })
        );
      }
      expect(after.programSessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            completed_workout: expect.objectContaining({
              type: 'individual',
              name: 'Lowercase individual',
            }),
          }),
          expect.objectContaining({
            completed_workout: expect.objectContaining({
              type: 'preset',
              name: 'lowercase preset',
            }),
          }),
        ])
      );
      expect(after.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            exercise_id: renamed,
            exercise_name: 'Old McGill TRX wording',
          }),
          expect.objectContaining({
            exercise_id: null,
            exercise_name: 'Deleted old TRX row',
          }),
        ])
      );
      expect(
        after.exercises
          ?.filter((row) => row.name === 'Same movement')
          .map((row) => row.id)
          .sort()
      ).toEqual([ids[3], ids[4]].sort());
      const versions = (
        await db.query(
          'SELECT id,xmin::text FROM public.exercise_entries WHERE user_id=$1 ORDER BY id',
          [owner]
        )
      ).rows;
      await db.query(migration);
      expect(await snapshot()).toEqual(after);
      expect(
        (
          await db.query(
            'SELECT id,xmin::text FROM public.exercise_entries WHERE user_id=$1 ORDER BY id',
            [owner]
          )
        ).rows
      ).toEqual(versions);
      const boundaries = (
        await db.query(
          "SELECT public.normalize_exercise_name_initial(NULL) AS absent, public.normalize_exercise_name_initial('') AS empty, public.normalize_exercise_name_initial('  untouched TRX') AS spaces, public.normalize_exercise_name_initial('3D curl') AS digit"
        )
      ).rows[0];
      expect(boundaries).toEqual({
        absent: null,
        empty: '',
        spaces: '  untouched TRX',
        digit: '3D curl',
      });
    });

    it('rolls back the library correction when the later historical update fails', async () => {
      const before = await snapshot();
      await db.query(`CREATE OR REPLACE FUNCTION public.fail_name_migration_rehearsal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected historical update failure'; END; $$;
      CREATE TRIGGER fail_name_migration_rehearsal BEFORE UPDATE OF exercise_name ON public.exercise_entries FOR EACH ROW EXECUTE FUNCTION public.fail_name_migration_rehearsal();`);
      try {
        await expect(db.query(migration)).rejects.toThrow(
          'Injected historical update failure'
        );
        await db.query('ROLLBACK');
        expect(await snapshot()).toEqual(before);
      } finally {
        await db.query('ROLLBACK');
        await db.query(
          'DROP TRIGGER fail_name_migration_rehearsal ON public.exercise_entries; DROP FUNCTION public.fail_name_migration_rehearsal();'
        );
      }
    });
  }
);
