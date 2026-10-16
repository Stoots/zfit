/**
 * RLS permission matrix — integration test.
 *
 * WHY THIS EXISTS
 * ---------------
 * Row-Level Security is enforced *inside Postgres*, so it cannot be unit-tested
 * with a mocked pool (the rest of the suite mocks `db/poolManager.js`, which
 * bypasses RLS entirely). This test runs against a REAL Postgres, connecting as
 * the non-superuser app role via `getClient(...)` (RLS enforced) and seeding via
 * `getSystemClient()` (superuser, RLS bypassed). It checks:
 *
 *   Part A — domain classification covers every RLS-enabled table.
 *   Part B — permission helpers return the expected allow/deny decisions.
 *   Part C — real row visibility and writes enforce those boundaries, including
 *            nested Workout Sessions and strictly owner-only Training Programs.
 *
 * HOW TO RUN
 * ----------
 * It runs automatically whenever a database is actually reachable — locally as
 * part of `pnpm test` (creds from ../.env) and in the CI migration-check job —
 * so RLS regressions are caught before a PR. It uses the same DB env the server
 * uses (SPARKY_FITNESS_DB_* and SPARKY_FITNESS_APP_DB_*), pointed at a database
 * with the schema + `db/rls_policies.sql` applied (the server applies these on
 * boot). It seeds and deletes only its own synthetic `@example.test` users, but
 * still — do NOT point it at production data.
 *
 * The gate below does a real, short-timeout connection probe (not just an env
 * check), so it SKIPS cleanly when the database is missing OR not running — the
 * mocked unit suite, a contributor without a DB, or a stopped local Postgres —
 * instead of failing to connect. Set SKIP_RLS_MATRIX=1 to force-skip even when
 * a database is up.
 */
import pg, { type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import exerciseDb from '../models/exercise.js';
import exerciseEntryDb from '../models/exerciseEntry.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getClient, getSystemClient, endPool } from '../db/poolManager.js';

// Probe the app role RLS actually needs, with a short timeout, using a
// standalone client. Returns false on any failure so the suite skips rather
// than erroring when no DB is reachable.
async function rlsTestDbReachable(): Promise<boolean> {
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
    await probe.end().catch(() => {});
  }
}

const RUN = await rlsTestDbReachable();

// Stable, namespaced UUIDs so cleanup is unambiguous.
const OWNER = '00000000-0000-4000-a000-0000000000ff';
const D = {
  diary: '00000000-0000-4000-a000-000000000001',
  checkin: '00000000-0000-4000-a000-000000000002',
  meds: '00000000-0000-4000-a000-000000000003',
  reports: '00000000-0000-4000-a000-000000000004',
  foodlib: '00000000-0000-4000-a000-000000000005',
  exlib: '00000000-0000-4000-a000-000000000006',
  none: '00000000-0000-4000-a000-000000000007',
  symptoms: '00000000-0000-4000-a000-000000000008',
} as const;

type DelegateKey = keyof typeof D;

const PERMS: Record<DelegateKey, Record<string, boolean>> = {
  diary: { can_manage_diary: true },
  checkin: { can_manage_checkin: true },
  meds: { can_manage_medications: true },
  reports: { can_view_reports: true },
  foodlib: { can_view_food_library: true },
  exlib: { can_view_exercise_library: true },
  none: {},
  symptoms: { can_manage_symptoms: true },
};

const ALL_IDS = [OWNER, ...Object.values(D)];

describe.runIf(RUN)('RLS permission matrix', () => {
  beforeAll(async () => {
    const sys = await getSystemClient();
    try {
      // Idempotent clean slate (cascades remove family_access).
      await sys.query('DELETE FROM public."user" WHERE id = ANY($1::uuid[])', [
        ALL_IDS,
      ]);
      for (const id of ALL_IDS) {
        await sys.query(
          'INSERT INTO public."user" (id, email, email_verified) VALUES ($1, $2, true) ON CONFLICT (id) DO NOTHING',
          [id, `rls-matrix-${id}@example.test`]
        );
      }
      for (const key of Object.keys(D) as DelegateKey[]) {
        await sys.query(
          `INSERT INTO public.family_access
             (owner_user_id, family_user_id, family_email, access_permissions, is_active, status)
           VALUES ($1, $2, $3, $4::jsonb, true, 'active')`,
          [
            OWNER,
            D[key],
            `rls-matrix-${key}@example.test`,
            JSON.stringify(PERMS[key]),
          ]
        );
      }
    } finally {
      sys.release();
    }
  });

  afterAll(async () => {
    const sys = await getSystemClient();
    try {
      await sys.query('DELETE FROM public."user" WHERE id = ANY($1::uuid[])', [
        ALL_IDS,
      ]);
    } finally {
      sys.release();
    }
    await endPool();
  });

  // ---------------------------------------------------------------------------
  // Part A — classify every RLS-enabled table into a permission domain.
  // The completeness guard catches newly unclassified or stale tables without
  // pinning policy names, helper wiring or PostgreSQL's expression rendering.
  // ---------------------------------------------------------------------------
  type Domain =
    | 'owner'
    | 'diary'
    | 'checkin'
    | 'medication'
    | 'symptom'
    | 'library'
    | 'custom';

  const DOMAIN: Record<string, Domain> = {
    // owner-only (no delegation)
    api_key: 'owner',
    sparky_chat_history: 'owner',
    user_ignored_updates: 'owner',
    user_oidc_links: 'owner',
    cycle_daily_entries: 'owner',
    cycle_settings: 'owner',
    cycle_test_entries: 'owner',
    cycles: 'owner',
    health_appointments: 'owner',
    openfoodfacts_sync_queue: 'owner',
    pregnancies: 'owner',
    pregnancy_checklist_state: 'owner',
    pregnancy_contractions: 'owner',
    pregnancy_kick_sessions: 'owner',
    pregnancy_photos: 'owner',
    user_cycle_display_preferences: 'owner',
    user_fasting_preferences: 'owner',
    user_mood_display_preferences: 'owner',
    training_programs: 'owner',
    training_program_phases: 'owner',
    training_program_weeks: 'owner',
    training_program_sessions: 'owner',
    workout_program_consolidations: 'owner',
    // diary
    exercise_entries: 'diary',
    exercise_preset_entries: 'diary',
    workout_feedback: 'diary',
    food_entry_meals: 'diary',
    food_favorites: 'diary',
    goal_presets: 'diary',
    meal_plans: 'diary',
    user_allergen_preferences: 'diary',
    user_custom_nutrients: 'diary',
    user_goals: 'diary',
    user_nutrient_goal_preferences: 'diary',
    user_meal_visibilities: 'diary',
    user_water_containers: 'diary',
    water_intake: 'diary',
    water_intake_entries: 'diary',
    weekly_goal_plans: 'diary',
    cardio_test_attempts: 'diary',
    // check-in / wellness
    check_in_measurements: 'checkin',
    check_in_photos: 'checkin',
    custom_categories: 'checkin',
    custom_measurements: 'checkin',
    daily_health_metrics: 'checkin',
    daily_sleep_need: 'checkin',
    day_classification_cache: 'checkin',
    fasting_logs: 'checkin',
    health_metric_samples: 'checkin',
    mindfulness_sessions: 'checkin',
    mood_entries: 'checkin',
    user_custom_moods: 'checkin',
    sleep_entries: 'checkin',
    sleep_entry_stages: 'checkin',
    sleep_need_calculations: 'checkin',
    vitals_entries: 'checkin',
    // medication
    injection_entries: 'medication',
    medication_entries: 'medication',
    medication_pens: 'medication',
    medication_schedules: 'medication',
    medication_titration_steps: 'medication',
    medications: 'medication',
    // symptom (own permission; see the symptom_entries pins below for the
    // cycle-row carve-out)
    symptom_entry_photos: 'symptom',
    symptom_entry_treatments: 'symptom',
    symptom_free_days: 'symptom',
    user_custom_symptoms: 'symptom',
    user_symptom_options: 'symptom',
    // library (read shared, write owner-only)
    exercises: 'library',
    foods: 'library',
    meal_plan_templates: 'library',
    meals: 'library',
    workout_plan_templates: 'library',
    workout_presets: 'library',
    // bespoke / custom policies
    admin_activity_logs: 'custom',
    ai_service_settings: 'custom',
    exercise_entry_activity_details: 'custom',
    exercise_entry_gps_points: 'custom',
    exercise_entry_hr_zones: 'custom',
    exercise_entry_laps: 'custom',
    exercise_entry_sets: 'custom',
    external_data_providers: 'custom',
    family_access: 'custom',
    food_entries: 'custom',
    food_variants: 'custom',
    meal_foods: 'custom',
    meal_plan_template_assignments: 'custom',
    meal_types: 'custom',
    onboarding_data: 'custom',
    onboarding_status: 'custom',
    profiles: 'custom',
    // Symptom entries also retain owner-only access for cycle-source rows.
    symptom_entries: 'custom',
    user_dashboard_layouts: 'custom',
    user_medication_display_preferences: 'custom',
    user_nutrient_display_preferences: 'custom',
    user_preferences: 'custom',
    workout_plan_sessions: 'custom',
    workout_plan_assignment_sets: 'custom',
    workout_plan_template_assignments: 'custom',
    workout_preset_exercise_sets: 'custom',
    workout_preset_exercises: 'custom',
    // system/internal: RLS-enabled with an explicit deny-all policy; only
    // getSystemClient (which bypasses RLS) touches it.
    openfoodfacts_product_read_rate_limit: 'custom',
    passkey_registration_tickets: 'custom',
    rate_limit: 'custom',
  };

  describe('domain classification', () => {
    it('every RLS-enabled table is classified in DOMAIN (completeness guard)', async () => {
      const sys = await getSystemClient();
      let enabled: string[];
      try {
        const { rows } = await sys.query(
          `SELECT c.relname AS t
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true`
        );
        enabled = rows.map((r: { t: string }) => r.t);
      } finally {
        sys.release();
      }
      const declared = new Set(Object.keys(DOMAIN));
      const missing = enabled.filter((t) => !declared.has(t)).sort();
      const stale = [...declared].filter((t) => !enabled.includes(t)).sort();
      expect(
        missing,
        `RLS-enabled tables not classified in DOMAIN: ${missing}`
      ).toEqual([]);
      expect(
        stale,
        `DOMAIN entries that are no longer RLS-enabled: ${stale}`
      ).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Part B — helper behavior. For each delegate (switched into OWNER's context
  // via getClient(OWNER, delegate)), assert every RLS helper's verdict.
  // T = access granted, F = denied. This is the contract the policies depend on.
  // ---------------------------------------------------------------------------
  describe('helper behavior (as delegate, switched to owner)', () => {
    // columns: [diaryWrite, diaryRead, checkinRead, checkinWrite, medWrite,
    //           medRead, profileRead, libFood, libExercise, symptomWrite,
    //           symptomRead]
    const EXPECTED: Record<DelegateKey, boolean[]> = {
      //          d_w   d_r   c_r   c_w   m_w   m_r   p_r   lib_f lib_e s_w   s_r
      diary: [
        true,
        true,
        false,
        false,
        false,
        false,
        true,
        true,
        true,
        false,
        false,
      ],
      checkin: [
        false,
        false,
        true,
        true,
        false,
        false,
        true,
        false,
        false,
        false,
        false,
      ],
      meds: [
        false,
        false,
        false,
        false,
        true,
        true,
        true,
        false,
        false,
        false,
        false,
      ],
      reports: [
        false,
        true,
        true,
        false,
        false,
        true,
        true,
        true,
        true,
        false,
        true,
      ],
      foodlib: [
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        true,
        false,
        false,
        false,
      ],
      exlib: [
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        true,
        false,
        false,
      ],
      none: [
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
      ],
      symptoms: [
        false,
        false,
        false,
        false,
        false,
        false,
        true,
        false,
        false,
        true,
        true,
      ],
    };

    it.each(Object.keys(D) as DelegateKey[])(
      'delegate "%s" gets the expected verdicts',
      async (key) => {
        // getClient's authenticatedUserId param is typed `null` via its default;
        // at runtime it accepts the actor id. Cast to satisfy the inferred type.
        const client = await getClient(OWNER, D[key] as unknown as null);
        try {
          const { rows } = await client.query(
            `SELECT
               has_diary_access($1)                                                                       AS d_w,
               has_diary_read_access($1)                                                                  AS d_r,
               has_checkin_read_access($1)                                                                AS c_r,
               has_family_access($1, 'can_manage_checkin')                                                AS c_w,
               has_medication_access($1)                                                                  AS m_w,
               has_medication_read_access($1)                                                             AS m_r,
               has_profile_read_access($1)                                                                AS p_r,
               has_library_access_with_public($1, false, ARRAY['can_view_food_library','can_manage_diary'])     AS lib_f,
               has_library_access_with_public($1, false, ARRAY['can_view_exercise_library','can_manage_diary']) AS lib_e,
               has_symptom_access($1)                                                                     AS s_w,
               has_symptom_read_access($1)                                                                AS s_r`,
            [OWNER]
          );
          const r = rows[0];
          const actual = [
            r.d_w,
            r.d_r,
            r.c_r,
            r.c_w,
            r.m_w,
            r.m_r,
            r.p_r,
            r.lib_f,
            r.lib_e,
            r.s_w,
            r.s_r,
          ];
          expect(actual).toEqual(EXPECTED[key]);
        } finally {
          client.release();
        }
      }
    );

    it('F6: a diary delegate that is NOT switched cannot read the owner library', async () => {
      // current_user_id() = delegate (not owner), so the can_manage_diary caveat
      // in has_library_access_with_public fails -> no library access.
      const client = await getClient(D.diary, D.diary as unknown as null);
      try {
        const { rows } = await client.query(
          "SELECT has_library_access_with_public($1, false, ARRAY['can_view_food_library','can_manage_diary']) AS lib_f",
          [OWNER]
        );
        expect(rows[0].lib_f).toBe(false);
      } finally {
        client.release();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Part C — behavioral access (the strongest layer). Seed a real row owned by
  // OWNER, then as each delegate actually attempt SELECT / INSERT / UPDATE /
  // DELETE against live RLS and assert allow/deny. This is what proves a domain
  // grants the operations it should — e.g. a diary delegate gets all four,
  // while a reports delegate is read-only.
  //
  // RLS denial surfaces differently per operation: INSERT raises 42501 on a
  // WITH CHECK violation; UPDATE/DELETE just affect 0 rows when USING hides the
  // row. Every write runs inside a rolled-back transaction so nothing persists.
  // ---------------------------------------------------------------------------
  describe('behavioral access (real DML as delegate)', () => {
    const KEYS = Object.keys(D) as DelegateKey[];
    type Actor = DelegateKey | 'owner';
    const ACTORS: Actor[] = ['owner', ...KEYS];
    const RLS_DENIED = '42501';

    async function canSelect(
      key: Actor,
      table: string,
      id: string | number,
      switched = true
    ) {
      const actorId = key === 'owner' ? OWNER : D[key];
      const client = await getClient(switched ? OWNER : actorId, actorId);
      try {
        const { rows } = await client.query(
          `SELECT 1 FROM public.${table} WHERE id = $1`,
          [id]
        );
        return rows.length > 0;
      } finally {
        client.release();
      }
    }

    // INSERT: allowed unless RLS raises 42501.
    async function canInsert(key: Actor, sql: string, params: unknown[]) {
      const client = await getClient(OWNER, key === 'owner' ? OWNER : D[key]);
      try {
        await client.query('BEGIN');
        try {
          await client.query(sql, params);
          await client.query('SET CONSTRAINTS ALL IMMEDIATE');
          return true;
        } catch (e) {
          if ((e as { code?: string }).code === RLS_DENIED) return false;
          throw e;
        } finally {
          await client.query('ROLLBACK');
        }
      } finally {
        client.release();
      }
    }

    // UPDATE/DELETE: allowed only if a row was actually affected (USING hides
    // rows the delegate may not write, yielding rowCount 0 with no error).
    async function canAffect(key: Actor, sql: string, params: unknown[]) {
      const client = await getClient(OWNER, key === 'owner' ? OWNER : D[key]);
      try {
        await client.query('BEGIN');
        try {
          const res = await client.query(sql, params);
          await client.query('SET CONSTRAINTS ALL IMMEDIATE');
          return (res.rowCount ?? 0) > 0;
        } catch (e) {
          if ((e as { code?: string }).code === RLS_DENIED) return false;
          throw e;
        } finally {
          await client.query('ROLLBACK');
        }
      } finally {
        client.release();
      }
    }

    // Runs SELECT/INSERT/UPDATE/DELETE allow-deny assertions for one table.
    function crudSuite(opts: {
      table: string;
      read: Actor[];
      write: Actor[];
      deleteWrite?: Actor[];
      actors?: Actor[];
      // lazy so it can read seed ids captured in beforeAll
      insert: () => { sql: string; params: unknown[] };
      // Legacy cases use a self-assignment; nested cases supply a real edit.
      touchColumn?: string;
      update?: () => { sql: string; params: unknown[] };
      rowId: () => string | number;
    }) {
      it.each(opts.actors ?? KEYS)(
        `${opts.table} SELECT as "%s"`,
        async (key) => {
          expect(await canSelect(key, opts.table, opts.rowId())).toBe(
            opts.read.includes(key)
          );
        }
      );
      it.each(opts.actors ?? KEYS)(
        `${opts.table} INSERT as "%s"`,
        async (key) => {
          const { sql, params } = opts.insert();
          expect(await canInsert(key, sql, params)).toBe(
            opts.write.includes(key)
          );
        }
      );
      it.each(opts.actors ?? KEYS)(
        `${opts.table} UPDATE as "%s"`,
        async (key) => {
          const edit = opts.update?.() ?? {
            sql: `UPDATE public.${opts.table} SET ${opts.touchColumn} = ${opts.touchColumn} WHERE id = $1`,
            params: [opts.rowId()],
          };
          expect(await canAffect(key, edit.sql, edit.params)).toBe(
            opts.write.includes(key)
          );
        }
      );
      it.each(opts.actors ?? KEYS)(
        `${opts.table} DELETE as "%s"`,
        async (key) => {
          expect(
            await canAffect(
              key,
              `DELETE FROM public.${opts.table} WHERE id = $1`,
              [opts.rowId()]
            )
          ).toBe((opts.deleteWrite ?? opts.write).includes(key));
        }
      );
    }

    describe('Workout Session hierarchy and private Program structure', () => {
      type PlanFixture = {
        planId: number;
        sessionId: string;
        assignmentId: number;
        setId: number;
      };
      type ProgramFixture = {
        programId: string;
        phaseId: string;
        weekId: string;
        sessionId: string;
      };
      let exerciseId: string;
      let presetId: number;
      let presetExerciseId: number;
      let presetSetId: number;
      let boundSessionId: string;
      let boundAssignmentId: number;
      let plan: PlanFixture;
      let secondPlan: PlanFixture;
      let foreignPlan: PlanFixture;
      let program: ProgramFixture;
      let foreignProgram: ProgramFixture;

      async function seedPlan(
        client: PoolClient,
        userId: string
      ): Promise<PlanFixture> {
        const parent = await client.query<{ id: number }>(
          `INSERT INTO workout_plan_templates (user_id, plan_name, schedule_type)
           VALUES ($1, 'rls-session-plan', 'sequential') RETURNING id`,
          [userId]
        );
        const session = await client.query<{ id: string }>(
          `INSERT INTO workout_plan_sessions (template_id, user_id, name, sort_order)
           VALUES ($1, $2, 'A', 0) RETURNING id`,
          [parent.rows[0].id, userId]
        );
        const assignment = await client.query<{ id: number }>(
          `INSERT INTO workout_plan_template_assignments
             (template_id, workout_session_id, user_id, exercise_id, sort_order)
           VALUES ($1, $2, $3, $4, 0) RETURNING id`,
          [parent.rows[0].id, session.rows[0].id, userId, exerciseId]
        );
        const set = await client.query<{ id: number }>(
          `INSERT INTO workout_plan_assignment_sets (assignment_id, set_number, set_type, reps)
           VALUES ($1, 1, 'Working Set', 8) RETURNING id`,
          [assignment.rows[0].id]
        );
        return {
          planId: parent.rows[0].id,
          sessionId: session.rows[0].id,
          assignmentId: assignment.rows[0].id,
          setId: set.rows[0].id,
        };
      }

      async function seedProgram(
        client: PoolClient,
        userId: string,
        workoutSessionId: string
      ): Promise<ProgramFixture> {
        const fixture = {
          programId: randomUUID(),
          phaseId: randomUUID(),
          weekId: randomUUID(),
          sessionId: randomUUID(),
        };
        await client.query(
          `INSERT INTO training_programs (id, user_id, name, goal, start_date, end_date)
           VALUES ($1, $2, 'rls-program', 'Strength', '2026-10-11', '2026-10-17')`,
          [fixture.programId, userId]
        );
        await client.query(
          `INSERT INTO training_program_phases (id, program_id, user_id, name, goal, sort_order)
           VALUES ($1, $2, $3, 'Phase', 'Strength', 0)`,
          [fixture.phaseId, fixture.programId, userId]
        );
        await client.query(
          `INSERT INTO training_program_weeks
             (id, program_id, phase_id, user_id, start_date, end_date, sort_order)
           VALUES ($1, $2, $3, $4, '2026-10-11', '2026-10-17', 0)`,
          [fixture.weekId, fixture.programId, fixture.phaseId, userId]
        );
        await client.query(
          `INSERT INTO training_program_sessions
             (id, program_id, week_id, user_id, name, scheduled_date, effective_date, workout_session_id, sort_order)
           VALUES ($1, $2, $3, $4, 'A', '2026-10-11', '2026-10-11', $5, 0)`,
          [
            fixture.sessionId,
            fixture.programId,
            fixture.weekId,
            userId,
            workoutSessionId,
          ]
        );
        return fixture;
      }

      beforeAll(async () => {
        const sys: PoolClient = await getSystemClient();
        try {
          await sys.query('BEGIN');
          const exercise = await sys.query<{ id: string }>(
            `INSERT INTO exercises (user_id, name, category, is_custom, source, shared_with_public)
             VALUES ($1, 'rls-session-exercise', 'Strength', true, 'custom', true) RETURNING id`,
            [OWNER]
          );
          exerciseId = exercise.rows[0].id;
          plan = await seedPlan(sys, OWNER);
          secondPlan = await seedPlan(sys, OWNER);
          foreignPlan = await seedPlan(sys, D.none);
          // A genuine read-only family grant exposes the foreign plan, not authorship.
          await sys.query(
            `INSERT INTO family_access
               (owner_user_id, family_user_id, family_email, access_permissions, is_active, status)
             VALUES ($1, $2, 'rls-owner@example.test', '{"can_view_exercise_library":true}', true, 'active')`,
            [D.none, OWNER]
          );
          const preset = await sys.query<{ id: number }>(
            `INSERT INTO workout_presets (user_id, name, is_public, workout_format)
             VALUES ($1, 'Public source preset', true, 'standard') RETURNING id`,
            [OWNER]
          );
          presetId = preset.rows[0].id;
          const presetExercise = await sys.query<{ id: number }>(
            `INSERT INTO workout_preset_exercises (workout_preset_id, exercise_id, sort_order)
             VALUES ($1, $2, 0) RETURNING id`,
            [presetId, exerciseId]
          );
          presetExerciseId = presetExercise.rows[0].id;
          const presetSet = await sys.query<{ id: number }>(
            `INSERT INTO workout_preset_exercise_sets (workout_preset_exercise_id, set_number, reps)
             VALUES ($1, 1, 8) RETURNING id`,
            [presetExerciseId]
          );
          presetSetId = presetSet.rows[0].id;
          // Public sources do not make their consuming plan/session/Program public.
          // Keep this Program-bound session separate from deletion test targets.
          const boundSession = await sys.query<{ id: string }>(
            `INSERT INTO workout_plan_sessions (template_id, user_id, name, sort_order)
             VALUES ($1, $2, 'Program-bound public prescription', 1) RETURNING id`,
            [plan.planId, OWNER]
          );
          boundSessionId = boundSession.rows[0].id;
          const boundAssignment = await sys.query<{ id: number }>(
            `INSERT INTO workout_plan_template_assignments
               (template_id, workout_session_id, user_id, workout_preset_id, preset_snapshot, sort_order)
             SELECT $1, $2, $3, wp.id,
               jsonb_build_object('id', wp.id, 'name', wp.name, 'description', wp.description,
                 'workout_format', wp.workout_format, 'time_cap_seconds', wp.time_cap_seconds,
                 'exercises', (SELECT jsonb_agg(
                   (to_jsonb(pe) - 'workout_preset_id' - 'created_at' - 'updated_at') ||
                   jsonb_build_object('exercise_name', e.name, 'category', e.category, 'modality', e.modality,
                     'primary_muscles', e.primary_muscles, 'secondary_muscles', e.secondary_muscles,
                     'equipment', e.equipment, 'instructions', e.instructions, 'images', e.images,
                     'sets', (SELECT jsonb_agg(to_jsonb(ps) - 'workout_preset_exercise_id' - 'created_at' - 'updated_at'
                       ORDER BY ps.set_number, ps.id) FROM workout_preset_exercise_sets ps
                       WHERE ps.workout_preset_exercise_id = pe.id))
                   ORDER BY pe.sort_order, pe.id)
                 FROM workout_preset_exercises pe JOIN exercises e ON e.id = pe.exercise_id
                 WHERE pe.workout_preset_id = wp.id)), 0
             FROM workout_presets wp WHERE wp.id = $4 RETURNING id`,
            [plan.planId, boundSessionId, OWNER, presetId]
          );
          boundAssignmentId = boundAssignment.rows[0].id;
          program = await seedProgram(sys, OWNER, boundSessionId);
          foreignProgram = await seedProgram(
            sys,
            D.none,
            foreignPlan.sessionId
          );
          await sys.query('COMMIT');
        } catch (error) {
          await sys.query('ROLLBACK');
          throw error;
        } finally {
          sys.release();
        }
      });

      afterAll(async () => {
        const sys: PoolClient = await getSystemClient();
        try {
          await sys.query(
            'DELETE FROM training_programs WHERE id = ANY($1::uuid[])',
            [
              [program?.programId, foreignProgram?.programId].filter(
                (id) => id !== undefined
              ),
            ]
          );
          await sys.query(
            'DELETE FROM workout_plan_templates WHERE id = ANY($1::integer[])',
            [
              [plan?.planId, secondPlan?.planId, foreignPlan?.planId].filter(
                (id) => id !== undefined
              ),
            ]
          );
          await sys.query('DELETE FROM workout_presets WHERE id = $1', [
            presetId,
          ]);
          await sys.query('DELETE FROM exercises WHERE id = $1', [exerciseId]);
          await sys.query(
            'DELETE FROM family_access WHERE owner_user_id = $1 AND family_user_id = $2',
            [D.none, OWNER]
          );
        } finally {
          sys.release();
        }
      });

      crudSuite({
        table: 'workout_plan_templates',
        actors: ACTORS,
        read: ['owner', 'reports', 'exlib'],
        write: ['owner'],
        rowId: () => secondPlan.planId,
        insert: () => ({
          sql: `INSERT INTO workout_plan_templates (user_id, plan_name, schedule_type)
                VALUES ($1, 'New plan', 'sequential')`,
          params: [OWNER],
        }),
        update: () => ({
          sql: "UPDATE workout_plan_templates SET plan_name = 'Edited plan' WHERE id = $1",
          params: [secondPlan.planId],
        }),
      });
      crudSuite({
        table: 'workout_plan_sessions',
        actors: ACTORS,
        read: ['owner', 'reports', 'exlib'],
        write: ['owner'],
        rowId: () => plan.sessionId,
        insert: () => ({
          sql: `INSERT INTO workout_plan_sessions (template_id, user_id, name, sort_order)
                VALUES ($1, $2, 'New session', 2)`,
          params: [plan.planId, OWNER],
        }),
        update: () => ({
          sql: "UPDATE workout_plan_sessions SET name = 'Edited session' WHERE id = $1",
          params: [plan.sessionId],
        }),
      });
      crudSuite({
        table: 'workout_plan_template_assignments',
        actors: ACTORS,
        read: ['owner', 'diary', 'reports', 'exlib'],
        // INSERT/UPDATE also require visible parent session membership.
        write: ['owner'],
        deleteWrite: ['owner', 'diary'],
        rowId: () => plan.assignmentId,
        insert: () => ({
          sql: `INSERT INTO workout_plan_template_assignments
                  (template_id, workout_session_id, user_id, exercise_id, sort_order)
                VALUES ($1, $2, $3, $4, 2)`,
          params: [plan.planId, plan.sessionId, OWNER, exerciseId],
        }),
        update: () => ({
          sql: 'UPDATE workout_plan_template_assignments SET sort_order = 3 WHERE id = $1',
          params: [plan.assignmentId],
        }),
      });
      crudSuite({
        table: 'workout_plan_assignment_sets',
        actors: ACTORS,
        read: ['owner', 'diary', 'reports', 'exlib'],
        write: ['owner', 'diary'],
        rowId: () => plan.setId,
        insert: () => ({
          sql: `INSERT INTO workout_plan_assignment_sets (assignment_id, set_number, set_type, reps)
                VALUES ($1, 2, 'Working Set', 10)`,
          params: [plan.assignmentId],
        }),
        update: () => ({
          sql: 'UPDATE workout_plan_assignment_sets SET reps = 12 WHERE id = $1',
          params: [plan.setId],
        }),
      });

      it.each(['diary', 'exlib', 'reports', 'none'] as const)(
        'respects the parent plan boundary in the reader own context as %s',
        async (key) => {
          const libraryRead = key === 'exlib' || key === 'reports';
          expect(
            await canSelect(key, 'workout_plan_templates', plan.planId, false)
          ).toBe(libraryRead);
          expect(
            await canSelect(key, 'workout_plan_sessions', plan.sessionId, false)
          ).toBe(libraryRead);
          for (const [table, id] of [
            ['workout_plan_template_assignments', plan.assignmentId],
            ['workout_plan_assignment_sets', plan.setId],
          ] as const) {
            expect(await canSelect(key, table, id, false)).toBe(
              libraryRead || key === 'diary'
            );
          }
        }
      );

      it('allows diary assignment authoring with an additional session-library grant, not session authorship', async () => {
        const client: PoolClient = await getClient(OWNER, OWNER);
        try {
          await client.query('BEGIN');
          await client.query(
            `UPDATE family_access SET access_permissions =
               access_permissions || '{"can_view_exercise_library":true}'::jsonb
             WHERE owner_user_id = $1 AND family_user_id = $2`,
            [OWNER, D.diary]
          );
          await client.query('SELECT set_app_context($1, $2)', [
            OWNER,
            D.diary,
          ]);
          const inserted = await client.query<{ id: number }>(
            `INSERT INTO workout_plan_template_assignments
               (template_id, workout_session_id, user_id, exercise_id, sort_order)
             VALUES ($1, $2, $3, $4, 2) RETURNING id`,
            [plan.planId, plan.sessionId, OWNER, exerciseId]
          );
          const edited = await client.query(
            'UPDATE workout_plan_template_assignments SET sort_order = 3 WHERE id = $1 RETURNING id, sort_order',
            [inserted.rows[0].id]
          );
          expect(edited.rows).toEqual([
            { id: inserted.rows[0].id, sort_order: 3 },
          ]);
          await expect(
            client.query(
              `INSERT INTO workout_plan_sessions (template_id, user_id, name, sort_order)
               VALUES ($1, $2, 'Denied diary session', 2)`,
              [plan.planId, OWNER]
            )
          ).rejects.toMatchObject({ code: RLS_DENIED });
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      });

      it.each(['inactive', 'expired'] as const)(
        'revokes nested plan reads for an %s library grant without hiding public sources',
        async (state) => {
          const client: PoolClient = await getClient(OWNER, OWNER);
          try {
            await client.query('BEGIN');
            await client.query(
              `UPDATE family_access SET is_active = $3, access_end_date = $4
               WHERE owner_user_id = $1 AND family_user_id = $2`,
              [
                OWNER,
                D.exlib,
                state !== 'inactive',
                state === 'expired' ? '2000-01-01' : null,
              ]
            );
            await client.query('SELECT set_app_context($1, $2)', [
              OWNER,
              D.exlib,
            ]);
            for (const [table, id] of [
              ['workout_plan_templates', plan.planId],
              ['workout_plan_sessions', plan.sessionId],
              ['workout_plan_template_assignments', plan.assignmentId],
              ['workout_plan_assignment_sets', plan.setId],
            ] as const) {
              const hidden = await client.query(
                `SELECT id FROM ${table} WHERE id = $1`,
                [id]
              );
              expect(hidden.rows).toEqual([]);
            }
            for (const [table, id] of [
              ['exercises', exerciseId],
              ['workout_presets', presetId],
              ['workout_preset_exercises', presetExerciseId],
              ['workout_preset_exercise_sets', presetSetId],
            ] as const) {
              const visible = await client.query(
                `SELECT id FROM ${table} WHERE id = $1`,
                [id]
              );
              expect(visible.rows).toEqual([{ id }]);
            }
          } finally {
            await client.query('ROLLBACK');
            client.release();
          }
        }
      );

      it('rejects mismatched plan/session owners and cross-plan assignment moves', async () => {
        expect(
          await canSelect(
            'owner',
            'workout_plan_sessions',
            foreignPlan.sessionId
          )
        ).toBe(true);
        expect(
          await canInsert(
            'owner',
            `INSERT INTO workout_plan_sessions (template_id, user_id, name, sort_order)
             VALUES ($1, $2, 'Wrong owner', 2)`,
            [foreignPlan.planId, OWNER]
          )
        ).toBe(false);
        expect(
          await canAffect(
            'owner',
            'UPDATE workout_plan_sessions SET template_id = $2 WHERE id = $1',
            [plan.sessionId, foreignPlan.planId]
          )
        ).toBe(false);
        expect(
          await canInsert(
            'owner',
            `INSERT INTO workout_plan_template_assignments
               (template_id, workout_session_id, user_id, exercise_id, sort_order)
             VALUES ($1, $2, $3, $4, 2)`,
            [plan.planId, secondPlan.sessionId, OWNER, exerciseId]
          )
        ).toBe(false);
        expect(
          await canAffect(
            'owner',
            'UPDATE workout_plan_template_assignments SET workout_session_id = $2 WHERE id = $1',
            [plan.assignmentId, secondPlan.sessionId]
          )
        ).toBe(false);
        expect(
          await canAffect(
            'owner',
            'UPDATE workout_plan_assignment_sets SET assignment_id = $2 WHERE id = $1',
            [plan.setId, foreignPlan.assignmentId]
          )
        ).toBe(false);
      });

      for (const spec of [
        {
          table: 'training_programs',
          rowId: () => program.programId,
          insert: () => ({
            sql: `INSERT INTO training_programs (user_id, name, goal, start_date, end_date)
                  VALUES ($1, 'New Program', 'Strength', '2026-10-11', '2026-10-17')`,
            params: [OWNER],
          }),
          update: () => ({
            sql: "UPDATE training_programs SET name = 'Edited Program' WHERE id = $1",
            params: [program.programId],
          }),
        },
        {
          table: 'training_program_phases',
          rowId: () => program.phaseId,
          insert: () => ({
            sql: `INSERT INTO training_program_phases (program_id, user_id, name, goal, sort_order)
                  VALUES ($1, $2, 'New phase', 'Strength', 2)`,
            params: [program.programId, OWNER],
          }),
          update: () => ({
            sql: "UPDATE training_program_phases SET name = 'Edited phase' WHERE id = $1",
            params: [program.phaseId],
          }),
        },
        {
          table: 'training_program_weeks',
          rowId: () => program.weekId,
          insert: () => ({
            sql: `INSERT INTO training_program_weeks
                    (program_id, phase_id, user_id, start_date, end_date, sort_order)
                  VALUES ($1, $2, $3, '2026-10-11', '2026-10-17', 2)`,
            params: [program.programId, program.phaseId, OWNER],
          }),
          update: () => ({
            sql: 'UPDATE training_program_weeks SET sort_order = 3 WHERE id = $1',
            params: [program.weekId],
          }),
        },
        {
          table: 'training_program_sessions',
          rowId: () => program.sessionId,
          insert: () => ({
            sql: `INSERT INTO training_program_sessions
                    (program_id, week_id, user_id, name, scheduled_date, effective_date, workout_session_id, sort_order)
                  VALUES ($1, $2, $3, 'New Planned Session', '2026-10-12', '2026-10-12', $4, 2)`,
            params: [program.programId, program.weekId, OWNER, plan.sessionId],
          }),
          update: () => ({
            sql: "UPDATE training_program_sessions SET name = 'Edited Planned Session' WHERE id = $1",
            params: [program.sessionId],
          }),
        },
      ]) {
        describe(`${spec.table} owner-only`, () => {
          crudSuite({
            ...spec,
            actors: ACTORS,
            read: ['owner'],
            write: ['owner'],
          });
        });
      }

      describe('consolidation journal owner-only access', () => {
        const journalId = randomUUID();
        const initialResult = { acceptance_note: 'original journal result' };

        beforeAll(async () => {
          const client = await getClient(OWNER, OWNER);
          try {
            await client.query(
              `INSERT INTO workout_program_consolidations
                   (id, user_id, program_id, target_plan_id, manifest, result)
                 VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
              [
                journalId,
                OWNER,
                program.programId,
                plan.planId,
                JSON.stringify({ operation_id: journalId }),
                JSON.stringify(initialResult),
              ]
            );
          } finally {
            client.release();
          }
        });

        afterAll(async () => {
          const client = await getClient(OWNER, OWNER);
          try {
            await client.query(
              'DELETE FROM workout_program_consolidations WHERE id = $1',
              [journalId]
            );
          } finally {
            client.release();
          }
        });

        it('owner can create, read, genuinely edit and delete a journal row', async () => {
          const client = await getClient(OWNER, OWNER);
          const id = randomUUID();
          const editedResult = {
            acceptance_note: 'owner edited the stored result',
            target_plan_id: plan.planId,
          };
          try {
            await client.query('BEGIN');
            await client.query(
              `INSERT INTO workout_program_consolidations
                   (id, user_id, program_id, target_plan_id, manifest, result)
                 VALUES ($1, $2, $3, $4, '{}'::jsonb, $5::jsonb)`,
              [
                id,
                OWNER,
                program.programId,
                plan.planId,
                JSON.stringify(initialResult),
              ]
            );
            const original = await client.query(
              'SELECT id, user_id, program_id, target_plan_id, result FROM workout_program_consolidations WHERE id = $1',
              [id]
            );
            expect(original.rows).toEqual([
              {
                id,
                user_id: OWNER,
                program_id: program.programId,
                target_plan_id: plan.planId,
                result: initialResult,
              },
            ]);
            const edited = await client.query(
              'UPDATE workout_program_consolidations SET result = $2::jsonb WHERE id = $1 RETURNING result',
              [id, JSON.stringify(editedResult)]
            );
            expect(edited.rows).toEqual([{ result: editedResult }]);
            const stored = await client.query(
              'SELECT result FROM workout_program_consolidations WHERE id = $1',
              [id]
            );
            expect(stored.rows).toEqual([{ result: editedResult }]);
            const deleted = await client.query(
              'DELETE FROM workout_program_consolidations WHERE id = $1 RETURNING id',
              [id]
            );
            expect(deleted.rows).toEqual([{ id }]);
            expect(
              (
                await client.query(
                  'SELECT id FROM workout_program_consolidations WHERE id = $1',
                  [id]
                )
              ).rows
            ).toEqual([]);
          } finally {
            await client.query('ROLLBACK');
            client.release();
          }
        });

        it.for(KEYS)(
          'delegate %s cannot access owner journals with or without switched context',
          async (key) => {
            for (const switched of [false, true]) {
              const client = await getClient(switched ? OWNER : D[key], D[key]);
              try {
                await client.query('BEGIN');
                expect(
                  (
                    await client.query(
                      'SELECT id, manifest, result FROM workout_program_consolidations WHERE id = $1',
                      [journalId]
                    )
                  ).rows
                ).toEqual([]);
                expect(
                  (
                    await client.query(
                      'UPDATE workout_program_consolidations SET result = \'{"acceptance_note":"delegate overwrite"}\'::jsonb WHERE id = $1 RETURNING id',
                      [journalId]
                    )
                  ).rows
                ).toEqual([]);
                expect(
                  (
                    await client.query(
                      'DELETE FROM workout_program_consolidations WHERE id = $1 RETURNING id',
                      [journalId]
                    )
                  ).rows
                ).toEqual([]);
                await expect(
                  client.query(
                    `INSERT INTO workout_program_consolidations
                         (id, user_id, program_id, target_plan_id, manifest, result)
                       VALUES ($1, $2, $3, $4, '{}'::jsonb, '{}'::jsonb)`,
                    [randomUUID(), OWNER, program.programId, plan.planId]
                  )
                ).rejects.toMatchObject({ code: RLS_DENIED });
              } finally {
                await client.query('ROLLBACK');
                client.release();
              }
            }
            const ownerClient = await getClient(OWNER, OWNER);
            try {
              expect(
                (
                  await ownerClient.query(
                    'SELECT result FROM workout_program_consolidations WHERE id = $1',
                    [journalId]
                  )
                ).rows
              ).toEqual([{ result: initialResult }]);
            } finally {
              ownerClient.release();
            }
          }
        );
      });

      it('public sources neither expose their consuming hierarchy nor permit another owner Program binding', async () => {
        for (const [table, id] of [
          ['exercises', exerciseId],
          ['workout_presets', presetId],
          ['workout_preset_exercises', presetExerciseId],
          ['workout_preset_exercise_sets', presetSetId],
        ] as const) {
          expect(await canSelect('none', table, id, false)).toBe(true);
        }
        for (const [table, id] of [
          ['workout_plan_templates', plan.planId],
          ['workout_plan_sessions', boundSessionId],
          ['workout_plan_template_assignments', boundAssignmentId],
          ['training_programs', program.programId],
          ['training_program_phases', program.phaseId],
          ['training_program_weeks', program.weekId],
          ['training_program_sessions', program.sessionId],
        ] as const) {
          expect(await canSelect('none', table, id, false)).toBe(false);
        }
        const client: PoolClient = await getClient(D.none, D.none);
        try {
          await client.query('BEGIN');
          await client.query(
            `INSERT INTO training_program_sessions
               (program_id, week_id, user_id, name, scheduled_date, effective_date, workout_session_id, sort_order)
             VALUES ($1, $2, $3, 'Invalid shared-source binding', '2026-10-12', '2026-10-12', $4, 2)`,
            [
              foreignProgram.programId,
              foreignProgram.weekId,
              D.none,
              boundSessionId,
            ]
          );
          await expect(
            client.query('SET CONSTRAINTS ALL IMMEDIATE')
          ).rejects.toMatchObject({ code: '23503' });
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      });
    });

    // -- diary domain: full CRUD for can_manage_diary, read-only for reports ---
    describe('goal_presets (diary)', () => {
      let id = '';
      beforeAll(async () => {
        const sys = await getSystemClient();
        try {
          const r = await sys.query(
            "INSERT INTO public.goal_presets (user_id, preset_name) VALUES ($1, 'rls-matrix') RETURNING id",
            [OWNER]
          );
          id = r.rows[0].id;
        } finally {
          sys.release();
        }
      });
      afterAll(async () => {
        const sys = await getSystemClient();
        try {
          await sys.query('DELETE FROM public.goal_presets WHERE id = $1', [
            id,
          ]);
        } finally {
          sys.release();
        }
      });
      crudSuite({
        table: 'goal_presets',
        read: ['diary', 'reports'],
        write: ['diary'],
        insert: () => ({
          sql: "INSERT INTO public.goal_presets (user_id, preset_name) VALUES ($1, 'rls-matrix-w')",
          params: [OWNER],
        }),
        touchColumn: 'preset_name',
        rowId: () => id,
      });
    });

    // -- check-in domain -----------------------------------------------------
    describe('custom_categories (checkin)', () => {
      let id = '';
      beforeAll(async () => {
        const sys = await getSystemClient();
        try {
          const r = await sys.query(
            "INSERT INTO public.custom_categories (user_id, name, measurement_type, frequency) VALUES ($1, 'rls-matrix', 'numeric', 'Daily') RETURNING id",
            [OWNER]
          );
          id = r.rows[0].id;
        } finally {
          sys.release();
        }
      });
      afterAll(async () => {
        const sys = await getSystemClient();
        try {
          await sys.query(
            'DELETE FROM public.custom_categories WHERE id = $1',
            [id]
          );
        } finally {
          sys.release();
        }
      });
      crudSuite({
        table: 'custom_categories',
        read: ['checkin', 'reports'],
        write: ['checkin'],
        insert: () => ({
          sql: "INSERT INTO public.custom_categories (user_id, name, measurement_type, frequency) VALUES ($1, 'rls-matrix-w', 'numeric', 'Daily')",
          params: [OWNER],
        }),
        touchColumn: 'name',
        rowId: () => id,
      });
    });

    // -- symptom domain: its own permission, and cycle rows are owner-only ----
    describe('symptom_entries (symptom domain, cycle rows owner-only)', () => {
      let manualId = '';
      let cycleId = '';
      beforeAll(async () => {
        const sys = await getSystemClient();
        try {
          const manual = await sys.query(
            "INSERT INTO public.symptom_entries (user_id, symptom_name_snapshot, source) VALUES ($1, 'rls-matrix', 'manual') RETURNING id",
            [OWNER]
          );
          manualId = manual.rows[0].id;
          const cycle = await sys.query(
            "INSERT INTO public.symptom_entries (user_id, symptom_name_snapshot, source) VALUES ($1, 'rls-matrix-cycle', 'cycle') RETURNING id",
            [OWNER]
          );
          cycleId = cycle.rows[0].id;
        } finally {
          sys.release();
        }
      });
      afterAll(async () => {
        const sys = await getSystemClient();
        try {
          await sys.query(
            'DELETE FROM public.symptom_entries WHERE id = ANY($1::uuid[])',
            [[manualId, cycleId]]
          );
        } finally {
          sys.release();
        }
      });

      // Manual rows: the symptoms delegate reads + writes; a reports delegate is
      // read-only; medications and every other domain get nothing.
      crudSuite({
        table: 'symptom_entries',
        read: ['symptoms', 'reports'],
        write: ['symptoms'],
        insert: () => ({
          sql: "INSERT INTO public.symptom_entries (user_id, symptom_name_snapshot, source) VALUES ($1, 'rls-matrix-w', 'manual')",
          params: [OWNER],
        }),
        touchColumn: 'symptom_name_snapshot',
        rowId: () => manualId,
      });

      // Cycle-hub rows are reproductive-health data: no delegate may read,
      // change, delete or create them, whatever permissions they hold.
      it.each(KEYS)('cycle row SELECT is denied to "%s"', async (key) => {
        expect(await canSelect(key, 'symptom_entries', cycleId)).toBe(false);
      });
      it.each(KEYS)('cycle row UPDATE is denied to "%s"', async (key) => {
        expect(
          await canAffect(
            key,
            'UPDATE public.symptom_entries SET symptom_name_snapshot = symptom_name_snapshot WHERE id = $1',
            [cycleId]
          )
        ).toBe(false);
      });
      it.each(KEYS)('cycle row DELETE is denied to "%s"', async (key) => {
        expect(
          await canAffect(
            key,
            'DELETE FROM public.symptom_entries WHERE id = $1',
            [cycleId]
          )
        ).toBe(false);
      });
      it.each(KEYS)('cycle row INSERT is denied to "%s"', async (key) => {
        expect(
          await canInsert(
            key,
            "INSERT INTO public.symptom_entries (user_id, symptom_name_snapshot, source) VALUES ($1, 'rls-matrix-cycle-w', 'cycle')",
            [OWNER]
          )
        ).toBe(false);
      });
    });

    // -- custom/library: delegates read when entitled, only owner writes (F1) -
    describe('food_variants (custom, owner-only write)', () => {
      let foodId = '';
      let variantId = '';
      beforeAll(async () => {
        const sys = await getSystemClient();
        try {
          const f = await sys.query(
            "INSERT INTO public.foods (user_id, name, shared_with_public) VALUES ($1, 'rls-matrix-food', false) RETURNING id",
            [OWNER]
          );
          foodId = f.rows[0].id;
          const v = await sys.query(
            "INSERT INTO public.food_variants (food_id, serving_size, serving_unit) VALUES ($1, 1, 'g') RETURNING id",
            [foodId]
          );
          variantId = v.rows[0].id;
        } finally {
          sys.release();
        }
      });
      afterAll(async () => {
        const sys = await getSystemClient();
        try {
          await sys.query('DELETE FROM public.foods WHERE id = $1', [foodId]);
        } finally {
          sys.release();
        }
      });
      crudSuite({
        table: 'food_variants',
        read: ['diary', 'reports', 'foodlib'],
        write: [], // owner-only; no delegate may write
        insert: () => ({
          sql: "INSERT INTO public.food_variants (food_id, serving_size, serving_unit) VALUES ($1, 2, 'g')",
          params: [foodId],
        }),
        touchColumn: 'serving_size',
        rowId: () => variantId,
      });
    });
  });
});

describe.runIf(RUN)('Active calorie imports with shared exercises', () => {
  const users = [
    '00000000-0000-4000-b300-000000000001',
    '00000000-0000-4000-b300-000000000002',
  ];
  let sys: pg.PoolClient;

  beforeAll(async () => {
    sys = await getSystemClient();
    for (const id of users) {
      await sys.query(
        'INSERT INTO public."user" (id, email, email_verified) VALUES ($1, $2, true)',
        [id, `active-calories-${id}@example.test`]
      );
    }
  });

  beforeEach(async () => {
    await sys.query(
      'DELETE FROM exercise_entries WHERE user_id = ANY($1::uuid[])',
      [users]
    );
    await sys.query(
      'DELETE FROM exercise_preset_entries WHERE user_id = ANY($1::uuid[])',
      [users]
    );
    await sys.query('DELETE FROM exercises WHERE user_id = ANY($1::uuid[])', [
      users,
    ]);
    await sys.query('DELETE FROM family_access WHERE owner_user_id = $1', [
      users[0],
    ]);
  });

  afterAll(async () => {
    try {
      await sys.query(
        'DELETE FROM exercise_entries WHERE user_id = ANY($1::uuid[])',
        [users]
      );
      await sys.query('DELETE FROM exercises WHERE user_id = ANY($1::uuid[])', [
        users,
      ]);
      await sys.query('DELETE FROM public."user" WHERE id = ANY($1::uuid[])', [
        users,
      ]);
    } finally {
      sys.release();
      await endPool();
    }
  });

  /** Imports the same daily HealthKit total through the production repositories. */
  async function sync(calories: number) {
    const exerciseId = await exerciseDb.getOrCreateActiveCaloriesExercise(
      users[1],
      'HealthKit'
    );
    return exerciseEntryDb.upsertExerciseEntryData(
      users[1],
      users[1],
      exerciseId,
      calories,
      '2026-09-10',
      'HealthKit'
    );
  }

  it.each(['family', 'public'])(
    'keeps one owned entry when %s sharing changes',
    async (sharing) => {
      await sys.query('DELETE FROM exercises WHERE user_id = ANY($1::uuid[])', [
        users,
      ]);
      const sharedId = await exerciseDb.getOrCreateActiveCaloriesExercise(
        users[0],
        'HealthKit'
      );
      if (sharing === 'public') {
        await sys.query(
          'UPDATE exercises SET shared_with_public = true WHERE id = $1',
          [sharedId]
        );
      } else {
        await sys.query(
          `INSERT INTO family_access (owner_user_id, family_user_id, family_email, access_permissions, is_active, status)
         VALUES ($1, $2, $3, '{"can_view_exercise_library":true}', true, 'active')`,
          [users[0], users[1], `active-calories-${users[1]}@example.test`]
        );
      }
      expect((await exerciseDb.getExerciseById(sharedId, users[1])).id).toBe(
        sharedId
      );
      const first = await sync(300);
      const firstExercise = await exerciseDb.getExerciseById(
        first.exercise_id,
        users[1]
      );
      await sys.query(
        'UPDATE family_access SET is_active = false WHERE owner_user_id = $1',
        [users[0]]
      );
      await sys.query(
        'UPDATE exercises SET shared_with_public = false WHERE id = $1',
        [sharedId]
      );
      const second = await sync(350);
      const rows = await sys.query(
        `SELECT ee.id, ee.calories_burned, e.user_id AS exercise_owner
       FROM exercise_entries ee JOIN exercises e ON e.id = ee.exercise_id
       WHERE ee.user_id = $1`,
        [users[1]]
      );
      expect(second.id).toBe(first.id);
      expect(firstExercise.user_id).toBe(users[1]);
      expect(rows.rows).toEqual([
        { id: first.id, calories_burned: 350, exercise_owner: users[1] },
      ]);
    }
  );

  it('reuses an old import after its shared exercise becomes inaccessible', async () => {
    const sharedId = await exerciseDb.getOrCreateActiveCaloriesExercise(
      users[0],
      'HealthKit'
    );
    const oldId = randomUUID();
    await sys.query(
      `INSERT INTO exercise_entries (id, user_id, exercise_id, entry_date, calories_burned, duration_minutes, exercise_name, source)
       VALUES ($1, $2, $3, '2026-09-10', 300, 0, 'Active Calories', 'HealthKit')`,
      [oldId, users[1], sharedId]
    );
    expect(
      await exerciseDb.getExerciseById(sharedId, users[1])
    ).toBeUndefined();
    const updated = await sync(350);
    const repeated = await sync(400);
    expect(updated.id).toBe(oldId);
    expect(repeated.id).toBe(oldId);
    expect(repeated.exercise_id).not.toBe(sharedId);
    expect(repeated.calories_burned).toBe(400);
    expect(repeated.updated_by_user_id).toBe(users[1]);
    expect(repeated.notes).toBe(
      'Active calories logged from Apple Health (updated).'
    );
    const rows = await sys.query(
      'SELECT id FROM exercise_entries WHERE user_id = $1',
      [users[1]]
    );
    expect(rows.rows).toEqual([{ id: oldId }]);
  });

  it('updates the exact exercise match without altering an existing legacy duplicate', async () => {
    const sharedId = await exerciseDb.getOrCreateActiveCaloriesExercise(
      users[0],
      'HealthKit'
    );
    const ownedId = await exerciseDb.getOrCreateActiveCaloriesExercise(
      users[1],
      'HealthKit'
    );
    const legacyId = randomUUID();
    const exactId = randomUUID();
    await sys.query(
      `INSERT INTO exercise_entries (id, user_id, exercise_id, entry_date, calories_burned, duration_minutes, exercise_name, source, created_at)
       VALUES ($1, $3, $4, '2026-09-10', 100, 0, 'Active Calories', 'HealthKit', '2026-09-09'),
              ($2, $3, $5, '2026-09-10', 200, 0, 'Active Calories', 'HealthKit', '2026-09-10')`,
      [legacyId, exactId, users[1], sharedId, ownedId]
    );
    const before = await sys.query(
      'SELECT * FROM exercise_entries WHERE id = $1',
      [legacyId]
    );
    const updated = await sync(350);
    expect(updated.id).toBe(exactId);
    expect(updated.calories_burned).toBe(350);
    const after = await sys.query(
      'SELECT * FROM exercise_entries WHERE id = $1',
      [legacyId]
    );
    expect(after.rows).toEqual(before.rows);
  });

  it.each([
    ['another user', { otherUser: true }],
    ['another source', { source: 'Health Connect' }],
    ['another date', { date: '2026-09-09' }],
    ['a workout', { duration: 30 }],
    ['a preset exercise', { preset: true }],
    ['a provider activity', { sourceId: 'activity-1' }],
    ['another exercise name', { name: 'Running' }],
  ])('preserves %s when finding a legacy import', async (_label, change) => {
    const sharedId = await exerciseDb.getOrCreateActiveCaloriesExercise(
      users[0],
      'HealthKit'
    );
    const untouchedId = randomUUID();
    const values = {
      otherUser: false,
      preset: false,
      source: 'HealthKit',
      date: '2026-09-10',
      duration: 0,
      sourceId: null,
      name: 'Active Calories',
      ...change,
    };
    const presetId = values.preset ? randomUUID() : null;
    if (presetId) {
      await sys.query(
        "INSERT INTO exercise_preset_entries (id, user_id, name, entry_date) VALUES ($1, $2, 'Active calorie fixture', '2026-09-10')",
        [presetId, users[1]]
      );
    }
    await sys.query(
      `INSERT INTO exercise_entries (id, user_id, exercise_id, entry_date, calories_burned, duration_minutes, exercise_name, source, source_id, exercise_preset_entry_id)
       VALUES ($1, $2, $3, $4, 123, $5, $6, $7, $8, $9)`,
      [
        untouchedId,
        values.otherUser ? users[0] : users[1],
        sharedId,
        values.date,
        values.duration,
        values.name,
        values.source,
        values.sourceId,
        presetId,
      ]
    );
    const before = await sys.query(
      'SELECT * FROM exercise_entries WHERE id = $1',
      [untouchedId]
    );
    const imported = await sync(350);
    expect(imported.id).not.toBe(untouchedId);
    const after = await sys.query(
      'SELECT * FROM exercise_entries WHERE id = $1',
      [untouchedId]
    );
    expect(after.rows).toEqual(before.rows);
  });

  // This migration is unscoped; namespaced fixture IDs alone cannot protect a normal DB.
  describe.runIf(
    /(^|[_-])test([_-]|$)/i.test(process.env.SPARKY_FITNESS_DB_NAME ?? '')
  )('historical cleanup', () => {
    const migration = readFileSync(
      new URL(
        '../db/migrations/20260910180000_deduplicate_shared_active_calories.sql',
        import.meta.url
      ),
      'utf8'
    );
    let legacyId: string;
    let ownedId: string;

    beforeEach(async () => {
      const sharedExercise = await exerciseDb.getOrCreateActiveCaloriesExercise(
        users[0],
        'HealthKit'
      );
      const owned = await sync(300);
      ownedId = owned.id;
      legacyId = randomUUID();
      await sys.query(
        `INSERT INTO exercise_entries (id, user_id, exercise_id, entry_date, calories_burned, duration_minutes, notes, created_by_user_id, exercise_name, source)
         VALUES ($1, $2, $3, '2026-09-10', 350, 0, 'Active calories logged from Apple Health.', $2, 'Active Calories', 'HealthKit')`,
        [legacyId, users[1], sharedExercise]
      );
    });

    /** Reads complete fixture rows so preservation checks include all metadata. */
    async function entries() {
      return (
        await sys.query(
          'SELECT * FROM exercise_entries WHERE user_id = ANY($1::uuid[]) ORDER BY id',
          [users]
        )
      ).rows;
    }

    it.each([
      ['a newer shared import', 400, '2026-09-09', '2026-09-10', false],
      ['a newer lower owned import', 250, '2026-09-11', '2026-09-10', true],
      [
        'the higher total on tied timestamps',
        300,
        '2026-09-10',
        '2026-09-10',
        false,
      ],
      [
        'the owned exercise on tied timestamps and totals',
        350,
        '2026-09-10',
        '2026-09-10',
        true,
      ],
    ] as const)(
      'keeps %s',
      async (_label, calories, ownedUpdated, legacyUpdated, keepOwned) => {
        await sys.query(
          'UPDATE exercise_entries SET calories_burned = $1, updated_at = $2 WHERE id = $3',
          [calories, ownedUpdated, ownedId]
        );
        await sys.query(
          'UPDATE exercise_entries SET updated_at = $1 WHERE id = $2',
          [legacyUpdated, legacyId]
        );
        const before = await entries();
        const survivor = before.find(
          (row) => row.id === (keepOwned ? ownedId : legacyId)
        );
        await sys.query(migration);
        expect(await entries()).toEqual([survivor]);
        await sys.query(migration);
        expect(await entries()).toEqual([survivor]);
        const corrected = await sync(200);
        expect(corrected.id).toBe(survivor.id);
        expect(corrected.calories_burned).toBe(200);
        expect((await entries()).map((row) => row.id)).toEqual([survivor.id]);
      }
    );

    it.each([
      ['manual notes', "notes = 'Evening walk'"],
      ['missing creator', 'created_by_user_id = NULL'],
      ['different creator', 'created_by_user_id = $2'],
      ['different editor', 'updated_by_user_id = $2'],
      ['workout duration', 'duration_minutes = 30'],
      ['provider identity', "source_id = 'activity-1'"],
      ['entry time', "entry_time = '12:00'"],
      ['snapshot metadata', "image_url = 'https://example.test/workout.png'"],
      ['telemetry', 'steps = 100'],
      ['sort order', 'sort_order = 2'],
      ['negative calories', 'calories_burned = -1'],
      ['nonfinite calories', "calories_burned = 'NaN'::numeric"],
      ['infinite calories', "calories_burned = 'Infinity'::numeric"],
      ['another date', "entry_date = '2026-09-09'"],
      [
        'another source',
        "source = 'Health Connect', notes = 'Active calories logged from Health Connect.'",
      ],
      ['another user', 'user_id = $2, created_by_user_id = $2'],
    ])('preserves groups containing %s', async (_label, change) => {
      await sys.query(
        `UPDATE exercise_entries SET ${change} WHERE id = $1`,
        change.includes('$2') ? [legacyId, users[0]] : [legacyId]
      );
      const before = await entries();
      await sys.query(migration);
      expect(await entries()).toEqual(before);
    });

    it.each([
      [
        'activity_details',
        "INSERT INTO exercise_entry_activity_details (exercise_entry_id, provider_name, detail_type, detail_data) VALUES ($1, 'HealthKit', 'workout', '{}')",
      ],
      [
        'sets',
        'INSERT INTO exercise_entry_sets (exercise_entry_id, set_number) VALUES ($1, 1)',
      ],
      [
        'laps',
        "INSERT INTO exercise_entry_laps (exercise_entry_id, user_id, entry_date, lap_index, start_time, end_time, duration_seconds) VALUES ($1, $2, '2026-09-10', 1, now(), now(), 0)",
      ],
      [
        'gps_points',
        "INSERT INTO exercise_entry_gps_points (exercise_entry_id, user_id, entry_date) VALUES ($1, $2, '2026-09-10')",
      ],
      [
        'hr_zones',
        "INSERT INTO exercise_entry_hr_zones (exercise_entry_id, user_id, entry_date, zone_index, seconds_in_zone) VALUES ($1, $2, '2026-09-10', 1, 60)",
      ],
    ])(
      'preserves attached %s even when its owner differs',
      async (table, insert) => {
        await sys.query(
          insert,
          insert.includes('$2') ? [ownedId, users[0]] : [ownedId]
        );
        const before = await entries();
        const children = await sys.query(
          `SELECT * FROM exercise_entry_${table} WHERE exercise_entry_id = $1`,
          [ownedId]
        );
        await sys.query(migration);
        expect(await entries()).toEqual(before);
        expect(
          (
            await sys.query(
              `SELECT * FROM exercise_entry_${table} WHERE exercise_entry_id = $1`,
              [ownedId]
            )
          ).rows
        ).toEqual(children.rows);
      }
    );

    it('preserves duplicates without evidence of a shared exercise', async () => {
      await sys.query(
        'UPDATE exercise_entries SET exercise_id = (SELECT exercise_id FROM exercise_entries WHERE id = $1) WHERE id = $2',
        [ownedId, legacyId]
      );
      const before = await entries();
      await sys.query(migration);
      expect(await entries()).toEqual(before);
    });
  });
});
