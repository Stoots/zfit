import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  databaseReachable,
  requireDatabaseInCI,
} from './databaseIntegrationGuard.js';

const skipEnvVar = 'SKIP_TRAINING_PROGRAM_DB';
const run = await databaseReachable(skipEnvVar);
requireDatabaseInCI(run, skipEnvVar, 'Workout Plan Session upgrade');

const migration = readFileSync(
  new URL(
    '../db/migrations/20261011110000_workout_plan_sessions.sql',
    import.meta.url
  ),
  'utf8'
);
const schema = `workout_upgrade_${randomUUID().replaceAll('-', '')}`;
const owner = randomUUID();
const exerciseId = randomUUID();
const diaryIndividualId = randomUUID();
const diaryPresetId = randomUUID();
const completedPresetId = randomUUID();
const programId = randomUUID();
const phaseId = randomUUID();
const weekId = randomUUID();
const individualSessionId = randomUUID();
const presetSessionId = randomUUID();
const inferredSessionId = randomUUID();

const planIds = { ambiguous: 1101, unambiguous: 1102 };
const assignmentIds = { individual: 1701, preset: 1702, inferred: 1801 };
const presetId = 1901;
const presetExerciseId = 1902;
const presetSetId = 1903;
const planSetId = 1802;

let db: pg.Client;

async function createLegacySchema(): Promise<void> {
  await db.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}, public;
    CREATE FUNCTION update_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

    CREATE TABLE exercises (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL,
      category text, modality text, primary_muscles jsonb, secondary_muscles jsonb,
      equipment jsonb, instructions jsonb, images jsonb,
      shared_with_public boolean NOT NULL DEFAULT false, UNIQUE (id, user_id)
    );
    CREATE TABLE workout_presets (
      id integer PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL,
      description text, workout_format text, time_cap_seconds integer,
      is_public boolean NOT NULL DEFAULT false
    );
    CREATE TABLE workout_preset_exercises (
      id integer PRIMARY KEY, workout_preset_id integer NOT NULL,
      exercise_id uuid NOT NULL, sort_order integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE workout_preset_exercise_sets (
      id integer PRIMARY KEY, workout_preset_exercise_id integer NOT NULL,
      set_number integer NOT NULL, reps integer, weight numeric, duration integer,
      rest_time integer, notes text, rpe numeric, rir numeric,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE workout_plan_templates (
      id integer PRIMARY KEY, user_id uuid NOT NULL, plan_name text NOT NULL,
      schedule_type text NOT NULL, is_active boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (id, user_id)
    );
    CREATE TABLE workout_plan_template_assignments (
      id integer PRIMARY KEY, template_id integer NOT NULL,
      exercise_id uuid, workout_preset_id integer, day_of_week integer,
      session_index integer, session_name text, sort_order integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT chk_workout_assignment_type CHECK (
        (exercise_id IS NOT NULL AND workout_preset_id IS NULL) OR
        (exercise_id IS NULL AND workout_preset_id IS NOT NULL)
      ),
      CONSTRAINT workout_plan_template_assignments_workout_preset_id_fkey
        FOREIGN KEY (workout_preset_id) REFERENCES workout_presets(id)
    );
    CREATE TRIGGER update_workout_plan_template_assignments_timestamp
      BEFORE UPDATE ON workout_plan_template_assignments
      FOR EACH ROW EXECUTE FUNCTION update_timestamp();
    CREATE TABLE workout_plan_assignment_sets (
      id integer PRIMARY KEY, assignment_id integer NOT NULL,
      set_number integer NOT NULL, reps integer, weight numeric, rest_time integer,
      notes text, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE exercise_preset_entries (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL
    );
    CREATE TABLE exercise_entries (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, exercise_id uuid,
      exercise_name text NOT NULL, entry_date date NOT NULL,
      workout_plan_assignment_id integer,
      CONSTRAINT exercise_entries_workout_plan_assignment_id_fkey
        FOREIGN KEY (workout_plan_assignment_id)
        REFERENCES workout_plan_template_assignments(id)
    );
    CREATE TABLE family_access (
      owner_user_id uuid NOT NULL, family_user_id uuid NOT NULL,
      is_active boolean NOT NULL DEFAULT false, access_end_date timestamptz,
      access_permissions jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE training_programs (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL,
      goal text NOT NULL, start_date date NOT NULL, end_date date NOT NULL,
      schedule_type text NOT NULL DEFAULT 'fixed',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (id, user_id)
    );
    CREATE TABLE training_program_phases (
      id uuid PRIMARY KEY, program_id uuid NOT NULL, user_id uuid NOT NULL,
      name text NOT NULL, goal text NOT NULL, sort_order integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (id, program_id, user_id)
    );
    CREATE TABLE training_program_weeks (
      id uuid PRIMARY KEY, program_id uuid NOT NULL, phase_id uuid NOT NULL,
      user_id uuid NOT NULL, start_date date NOT NULL, end_date date NOT NULL,
      sort_order integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (id, program_id, user_id)
    );
    CREATE TABLE training_program_sessions (
      id uuid PRIMARY KEY, program_id uuid NOT NULL, week_id uuid NOT NULL,
      user_id uuid NOT NULL, name text NOT NULL, scheduled_date date NOT NULL,
      effective_date date NOT NULL, workout_plan_id integer NOT NULL,
      sort_order integer NOT NULL, status text NOT NULL DEFAULT 'planned',
      outcome_at timestamptz, completed_workout jsonb,
      workout_plan_name_snapshot text, exercise_entry_id uuid,
      exercise_preset_entry_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT training_program_sessions_workout_plan_fk
        FOREIGN KEY (workout_plan_id, user_id)
        REFERENCES workout_plan_templates(id, user_id)
        DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (exercise_entry_id) REFERENCES exercise_entries(id),
      FOREIGN KEY (exercise_preset_entry_id) REFERENCES exercise_preset_entries(id)
    );
  `);
}

async function seedLegacyData(): Promise<void> {
  await db.query(
    `INSERT INTO exercises
       (id,user_id,name,category,modality,primary_muscles,secondary_muscles,equipment,instructions,images)
     VALUES ($1,$2,'Legacy Press','Strength','weight_reps','["Chest"]','["Triceps"]','["Barbell"]','["Keep form"]','[]')`,
    [exerciseId, owner]
  );
  await db.query(
    `INSERT INTO workout_presets(id,user_id,name,description,workout_format,time_cap_seconds)
     VALUES ($1,$2,'Legacy circuit','Frozen library copy','amrap',720)`,
    [presetId, owner]
  );
  await db.query(
    `INSERT INTO workout_preset_exercises(id,workout_preset_id,exercise_id,sort_order)
     VALUES ($1,$2,$3,4)`,
    [presetExerciseId, presetId, exerciseId]
  );
  await db.query(
    `INSERT INTO workout_preset_exercise_sets
       (id,workout_preset_exercise_id,set_number,reps,weight,duration,rest_time,notes,rpe,rir)
     VALUES ($1,$2,1,8,32.5,45,90,'Keep the tempo',7,2)`,
    [presetSetId, presetExerciseId]
  );
  await db.query(
    `INSERT INTO workout_plan_templates(id,user_id,plan_name,schedule_type)
     VALUES ($1,$2,'Legacy weekly plan','weekly'),($3,$2,'Legacy single plan','weekly')`,
    [planIds.ambiguous, owner, planIds.unambiguous]
  );
  await db.query(
    `INSERT INTO workout_plan_template_assignments
       (id,template_id,exercise_id,workout_preset_id,day_of_week,session_name,sort_order)
     VALUES ($1,$2,$3,NULL,1,'Strength A',5),($4,$2,NULL,$5,3,'Conditioning B',9)`,
    [
      assignmentIds.individual,
      planIds.ambiguous,
      exerciseId,
      assignmentIds.preset,
      presetId,
    ]
  );
  await db.query(
    `INSERT INTO workout_plan_template_assignments
       (id,template_id,exercise_id,day_of_week,session_name,sort_order)
     VALUES ($1,$2,$3,5,'Single Session',2)`,
    [assignmentIds.inferred, planIds.unambiguous, exerciseId]
  );
  await db.query(
    `INSERT INTO workout_plan_assignment_sets
       (id,assignment_id,set_number,reps,weight,rest_time,notes)
     VALUES ($1,$2,1,6,45,90,'Legacy plan prescription')`,
    [planSetId, assignmentIds.individual]
  );
  await db.query(
    `INSERT INTO exercise_entries(id,user_id,exercise_id,exercise_name,entry_date,workout_plan_assignment_id)
     VALUES ($1,$2,$3,'Legacy Press','2026-10-05',$4),
            ($5,$2,$3,'Legacy Press','2026-10-08',$6)`,
    [
      diaryIndividualId,
      owner,
      exerciseId,
      assignmentIds.individual,
      diaryPresetId,
      assignmentIds.preset,
    ]
  );
  await db.query(
    `INSERT INTO exercise_preset_entries(id,user_id,name)
     VALUES ($1,$2,'Completed circuit')`,
    [completedPresetId, owner]
  );
  await db.query(
    `INSERT INTO training_programs(id,user_id,name,goal,start_date,end_date)
     VALUES ($1,$2,'Legacy Program','Strength','2026-10-05','2026-10-11')`,
    [programId, owner]
  );
  await db.query(
    `INSERT INTO training_program_phases(id,program_id,user_id,name,goal,sort_order)
     VALUES ($1,$2,$3,'Foundation','Strength',2)`,
    [phaseId, programId, owner]
  );
  await db.query(
    `INSERT INTO training_program_weeks(id,program_id,phase_id,user_id,start_date,end_date,sort_order)
     VALUES ($1,$2,$3,$4,'2026-10-05','2026-10-11',3)`,
    [weekId, programId, phaseId, owner]
  );
  await db.query(
    `INSERT INTO training_program_sessions
       (id,program_id,week_id,user_id,name,scheduled_date,effective_date,workout_plan_id,sort_order,status,outcome_at,completed_workout,workout_plan_name_snapshot,exercise_entry_id,exercise_preset_entry_id)
     VALUES
       ($1,$2,$3,$4,'Strength A','2026-10-05','2026-10-06',$5,4,'completed','2026-10-06T12:00:00Z',$6::jsonb,'Legacy weekly plan',$7,NULL),
       ($8,$2,$3,$4,'Conditioning B','2026-10-08','2026-10-09',$5,8,'completed','2026-10-09T12:00:00Z',$9::jsonb,'Legacy weekly plan',NULL,$10),
       ($11,$2,$3,$4,'Single Session','2026-10-10','2026-10-10',$12,10,'planned',NULL,NULL,NULL,NULL,NULL)`,
    [
      individualSessionId,
      programId,
      weekId,
      owner,
      planIds.ambiguous,
      JSON.stringify({
        type: 'individual',
        id: diaryIndividualId,
        name: 'Legacy Press',
        entry_date: '2026-10-05',
      }),
      diaryIndividualId,
      presetSessionId,
      JSON.stringify({
        type: 'preset',
        id: completedPresetId,
        name: 'Completed circuit',
        entry_date: '2026-10-08',
      }),
      completedPresetId,
      inferredSessionId,
      planIds.unambiguous,
    ]
  );
}

describe.runIf(run)('legacy Workout Plan Session migration', () => {
  beforeAll(async () => {
    if (!/test/i.test(process.env.SPARKY_FITNESS_DB_NAME ?? '')) {
      throw new Error(
        'Workout Session upgrade tests require an explicitly opted-in disposable test database.'
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
    await db.connect();
    await createLegacySchema();
    await seedLegacyData();
  }, 30000);

  afterAll(async () => {
    if (!db) return;
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  it('requires explicit mapping for ambiguous Programs and preserves every legacy relationship on upgrade', async () => {
    const scopedMigration = migration
      .replaceAll('public.', `${schema}.`)
      .replaceAll("table_schema = 'public'", `table_schema = '${schema}'`);

    await expect(db.query(scopedMigration)).rejects.toMatchObject({
      message: expect.stringContaining('explicit operator mapping'),
      hint: expect.stringContaining('app.workout_session_upgrade_mapping'),
    });
    await db.query('ROLLBACK');
    expect(
      (
        await db.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = $1 AND table_name = 'workout_plan_sessions'`,
          [schema]
        )
      ).rows
    ).toEqual([]);
    expect(
      (
        await db.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = 'training_program_sessions'
             AND column_name = 'workout_plan_id'`,
          [schema]
        )
      ).rows
    ).toEqual([{ column_name: 'workout_plan_id' }]);

    const mapping = {
      [individualSessionId]: assignmentIds.individual,
      [presetSessionId]: assignmentIds.preset,
    };
    await db.query('SELECT set_config($1, $2, false)', [
      'app.workout_session_upgrade_mapping',
      JSON.stringify(mapping),
    ]);
    const beforePrograms = (
      await db.query('SELECT to_jsonb(p) AS row FROM training_programs p')
    ).rows.map((row) => row.row);
    const beforePhases = (
      await db.query('SELECT to_jsonb(p) AS row FROM training_program_phases p')
    ).rows.map((row) => row.row);
    const beforeWeeks = (
      await db.query('SELECT to_jsonb(w) AS row FROM training_program_weeks w')
    ).rows.map((row) => row.row);
    const beforeAssignments = (
      await db.query(
        `SELECT id,template_id,exercise_id,workout_preset_id,sort_order,created_at,updated_at
         FROM workout_plan_template_assignments ORDER BY id`
      )
    ).rows;
    const beforeDiaryLinks = (
      await db.query(
        'SELECT id,workout_plan_assignment_id FROM exercise_entries ORDER BY id'
      )
    ).rows;
    const beforeOutcomes = (
      await db.query(
        `SELECT id,program_id,week_id,user_id,name,scheduled_date::text,effective_date::text,
                workout_plan_id,sort_order,status,outcome_at::text,completed_workout,
                workout_plan_name_snapshot,exercise_entry_id,exercise_preset_entry_id,
                created_at,updated_at
         FROM training_program_sessions ORDER BY sort_order`
      )
    ).rows;

    await db.query(scopedMigration);

    expect(
      (
        await db.query('SELECT to_jsonb(p) AS row FROM training_programs p')
      ).rows.map((row) => row.row)
    ).toEqual(beforePrograms);
    expect(
      (
        await db.query(
          'SELECT to_jsonb(p) AS row FROM training_program_phases p'
        )
      ).rows.map((row) => row.row)
    ).toEqual(beforePhases);
    expect(
      (
        await db.query(
          'SELECT to_jsonb(w) AS row FROM training_program_weeks w'
        )
      ).rows.map((row) => row.row)
    ).toEqual(beforeWeeks);

    const workoutSessions = (
      await db.query(
        `SELECT template_id,name,day_of_week,sort_order,created_at,updated_at
         FROM workout_plan_sessions ORDER BY template_id,sort_order`
      )
    ).rows;
    expect(workoutSessions).toMatchObject([
      {
        template_id: planIds.ambiguous,
        name: 'Strength A',
        day_of_week: 1,
        sort_order: 0,
      },
      {
        template_id: planIds.ambiguous,
        name: 'Conditioning B',
        day_of_week: 3,
        sort_order: 1,
      },
      {
        template_id: planIds.unambiguous,
        name: 'Single Session',
        day_of_week: 5,
        sort_order: 0,
      },
    ]);

    const assignments = (
      await db.query(
        `SELECT id,template_id,user_id,exercise_id,workout_preset_id,sort_order,
                workout_session_id,preset_snapshot,created_at,updated_at
         FROM workout_plan_template_assignments ORDER BY id`
      )
    ).rows;
    expect(assignments).toHaveLength(3);
    expect(assignments.map((row) => row.id)).toEqual([
      assignmentIds.individual,
      assignmentIds.preset,
      assignmentIds.inferred,
    ]);
    expect(assignments.map((row) => row.user_id)).toEqual([
      owner,
      owner,
      owner,
    ]);
    expect(assignments.map((row) => row.sort_order)).toEqual([5, 9, 2]);
    expect(assignments[1]!.preset_snapshot).toMatchObject({
      id: presetId,
      name: 'Legacy circuit',
      description: 'Frozen library copy',
      workout_format: 'amrap',
      time_cap_seconds: 720,
      exercises: [
        {
          id: presetExerciseId,
          exercise_id: exerciseId,
          exercise_name: 'Legacy Press',
          sort_order: 4,
          sets: [
            {
              id: presetSetId,
              set_number: 1,
              reps: 8,
              weight: 32.5,
              duration: 45,
              rest_time: 90,
              notes: 'Keep the tempo',
              rpe: 7,
              rir: 2,
            },
          ],
        },
      ],
    });
    expect(
      assignments.map(
        ({
          id,
          template_id,
          exercise_id,
          workout_preset_id,
          sort_order,
          created_at,
          updated_at,
        }) => ({
          id,
          template_id,
          exercise_id,
          workout_preset_id,
          sort_order,
          created_at,
          updated_at,
        })
      )
    ).toEqual(beforeAssignments);

    expect(
      (
        await db.query(
          'SELECT id,workout_plan_assignment_id FROM exercise_entries ORDER BY id'
        )
      ).rows
    ).toEqual(beforeDiaryLinks);
    const planSets = (
      await db.query(
        `SELECT id,assignment_id,set_number,reps,weight,rest_time,notes,distance,prescription
         FROM workout_plan_assignment_sets ORDER BY id`
      )
    ).rows;
    expect(planSets).toMatchObject([
      {
        id: planSetId,
        assignment_id: assignmentIds.individual,
        set_number: 1,
        reps: 6,
        weight: '45',
        rest_time: 90,
        notes: 'Legacy plan prescription',
        distance: null,
        prescription: {},
      },
    ]);

    const afterOutcomes = (
      await db.query(
        `SELECT id,program_id,week_id,user_id,name,scheduled_date::text,effective_date::text,
                workout_session_id,sort_order,status,outcome_at::text,completed_workout,
                workout_plan_name_snapshot,workout_session_name_snapshot,
                exercise_entry_id,exercise_preset_entry_id,created_at,updated_at
         FROM training_program_sessions ORDER BY sort_order`
      )
    ).rows;
    expect(afterOutcomes).toMatchObject([
      {
        id: individualSessionId,
        program_id: programId,
        week_id: weekId,
        user_id: owner,
        name: 'Strength A',
        scheduled_date: '2026-10-05',
        effective_date: '2026-10-06',
        sort_order: 4,
        status: 'completed',
        completed_workout: {
          type: 'individual',
          id: diaryIndividualId,
          name: 'Legacy Press',
          entry_date: '2026-10-05',
        },
        workout_plan_name_snapshot: 'Legacy weekly plan',
        workout_session_name_snapshot: 'Strength A',
        exercise_entry_id: diaryIndividualId,
        exercise_preset_entry_id: null,
      },
      {
        id: presetSessionId,
        name: 'Conditioning B',
        scheduled_date: '2026-10-08',
        effective_date: '2026-10-09',
        sort_order: 8,
        status: 'completed',
        completed_workout: {
          type: 'preset',
          id: completedPresetId,
          name: 'Completed circuit',
          entry_date: '2026-10-08',
        },
        workout_plan_name_snapshot: 'Legacy weekly plan',
        workout_session_name_snapshot: 'Conditioning B',
        exercise_entry_id: null,
        exercise_preset_entry_id: completedPresetId,
      },
      {
        id: inferredSessionId,
        name: 'Single Session',
        scheduled_date: '2026-10-10',
        effective_date: '2026-10-10',
        sort_order: 10,
        status: 'planned',
        outcome_at: null,
        completed_workout: null,
        workout_plan_name_snapshot: null,
        workout_session_name_snapshot: null,
        exercise_entry_id: null,
        exercise_preset_entry_id: null,
      },
    ]);
    type OutcomeIdentity = {
      id: string;
      scheduled_date: string;
      effective_date: string;
      sort_order: number;
      status: string;
      outcome_at: string | null;
      completed_workout: unknown;
      workout_plan_name_snapshot: string | null;
      exercise_entry_id: string | null;
      exercise_preset_entry_id: string | null;
      created_at: Date;
      updated_at: Date;
    };
    const outcomeIdentity = (row: OutcomeIdentity) => ({
      id: row.id,
      scheduled_date: row.scheduled_date,
      effective_date: row.effective_date,
      sort_order: row.sort_order,
      status: row.status,
      outcome_at: row.outcome_at,
      completed_workout: row.completed_workout,
      workout_plan_name_snapshot: row.workout_plan_name_snapshot,
      exercise_entry_id: row.exercise_entry_id,
      exercise_preset_entry_id: row.exercise_preset_entry_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    expect(afterOutcomes.map(outcomeIdentity)).toEqual(
      beforeOutcomes.map(outcomeIdentity)
    );
    const mappedSessions = (
      await db.query(
        `SELECT s.id,ws.name AS workout_session_name,ws.template_id,ws.day_of_week,ws.sort_order
         FROM training_program_sessions s
         JOIN workout_plan_sessions ws ON ws.id = s.workout_session_id
         ORDER BY s.sort_order`
      )
    ).rows;
    expect(mappedSessions).toMatchObject([
      {
        id: individualSessionId,
        workout_session_name: 'Strength A',
        template_id: planIds.ambiguous,
        day_of_week: 1,
        sort_order: 0,
      },
      {
        id: presetSessionId,
        workout_session_name: 'Conditioning B',
        template_id: planIds.ambiguous,
        day_of_week: 3,
        sort_order: 1,
      },
      {
        id: inferredSessionId,
        workout_session_name: 'Single Session',
        template_id: planIds.unambiguous,
        day_of_week: 5,
        sort_order: 0,
      },
    ]);
  });
});
