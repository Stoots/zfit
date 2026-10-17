import { randomUUID, randomBytes } from 'node:crypto';
import { setImmediate as yieldToRequests } from 'node:timers/promises';
import express from 'express';
// @ts-expect-error TS7016 — package has no declarations.
import request from 'supertest';
// @ts-expect-error TS7016 — package has no declarations.
import cookieParser from 'cookie-parser';
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import {
  workoutPlanAssignmentInputSchema,
  workoutPlanResponseSchema,
  workoutPlanBulkPreviewSchema,
  trainingProgramSchema,
  type WorkoutPlanResponse,
  type WorkoutPlanBulkRequest,
  type WorkoutPlanBulkPreview,
  type TrainingProgram,
} from '@workspace/shared';
import { getClient, getSystemClient, endPool } from '../db/poolManager.js';
import errorHandler from '../middleware/errorHandler.js';

// Opt-in only: this suite installs a rollback fault trigger in a disposable DB.
const run = process.env.RUN_BULK_PRESCRIPTION_DB === '1';
if (
  run &&
  !/^zfit_bulk13_disposable(?:_[a-z0-9]+)?$/.test(
    process.env.SPARKY_FITNESS_DB_NAME ?? ''
  )
)
  throw new Error(
    'Bulk prescription scenarios require a named disposable database.'
  );

describe.runIf(run)('persisted authenticated bulk prescription APIs', () => {
  const app = express();
  let owner: string, other: string, token: string, otherToken: string;
  let exerciseId: string, differentExerciseId: string;
  let plan: WorkoutPlanResponse, program: TrainingProgram;
  const planned = () =>
    program.phases.flatMap((p) => p.weeks.flatMap((w) => w.sessions));
  const endpoint = '/api/workout-plan-templates/bulk-prescriptions';
  const call = (path: string, body: unknown, actor = token) =>
    request(app).post(path).set('Authorization', `Bearer ${actor}`).send(body);
  async function fullState() {
    const db = await getSystemClient();
    try {
      const state: Record<string, unknown> = {};
      for (const table of [
        'workout_plan_templates',
        'workout_plan_sessions',
        'workout_plan_template_assignments',
        'training_programs',
        'training_program_phases',
        'training_program_weeks',
        'training_program_sessions',
        'exercise_entries',
        'exercise_entry_sets',
        'exercise_preset_entries',
        'exercise_entry_activity_details',
      ]) {
        const result = await db.query(
          `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) AS rows FROM ${table} t`
        );
        state[table] = result.rows[0].rows;
      }
      state.sets = (
        await db.query(
          "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) AS rows FROM workout_plan_assignment_sets t"
        )
      ).rows[0].rows;
      return state;
    } finally {
      db.release();
    }
  }
  const input = (): WorkoutPlanBulkRequest => {
    const source = plan.sessions[0]!;
    const prescription = workoutPlanAssignmentInputSchema.parse({
      ...source.assignments[0]!,
      preset_snapshot: source.assignments[0]!.preset_snapshot ?? undefined,
    });
    prescription.sets = prescription.sets!.map((s) => ({
      ...s,
      reps: 11,
      weight: null,
      notes: 'Source-only notes must not spread',
    }));
    return {
      plan_id: plan.id,
      program_id: program.id,
      source_session_id: source.id,
      source_assignment_id: source.assignments[0]!.id,
      prescription,
      fields: ['reps', 'weight'],
      targets: plan.sessions.slice(1, 3).map((s) => ({
        workout_session_id: s.id,
        assignment_id: s.assignments[0]!.id,
        planned_session_ids: planned()
          .filter((p) => p.workout_session_id === s.id)
          .map((p) => p.id),
      })),
    };
  };
  async function preview(body = input()): Promise<WorkoutPlanBulkPreview> {
    const response = await call(`${endpoint}/preview`, body);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return workoutPlanBulkPreviewSchema.parse(response.body);
  }
  const apply = (p: WorkoutPlanBulkPreview) =>
    call(`${endpoint}/apply`, { request: p.request, revision: p.revision });
  async function reload() {
    const response = await request(app)
      .get(`/api/workout-plan-templates/${plan.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return workoutPlanResponseSchema.parse(response.body);
  }
  async function outcome(index: number) {
    const started = await call(
      `/api/workout-plan-templates/sessions/${plan.sessions[index]!.id}/start`,
      { entry_date: '2099-10-12' }
    );
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const result = await call(
      `/api/training-programs/${program.id}/sessions/${planned()[index]!.id}/outcome`,
      {
        status: 'completed',
        workout: { type: 'preset', id: started.body.session.id },
      }
    );
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return started.body;
  }
  beforeAll(async () => {
    const { auth } = await import('../auth.js');
    const accounts = await Promise.all(
      ['owner', 'delegate'].map((name) =>
        auth.api.signUpEmail({
          body: {
            name,
            email: `bulk13-${name}-${randomUUID()}@example.test`,
            password: randomBytes(24).toString('base64'),
          },
        })
      )
    );
    owner = accounts[0]!.user.id;
    token = accounts[0]!.token!;
    other = accounts[1]!.user.id;
    otherToken = accounts[1]!.token!;
    const db = await getSystemClient();
    try {
      exerciseId = (
        await db.query(
          "INSERT INTO exercises(user_id,name,category,modality,is_custom,source) VALUES ($1,'Split squat','Strength','weight_reps',true,'custom') RETURNING id",
          [owner]
        )
      ).rows[0].id;
      differentExerciseId = (
        await db.query(
          "INSERT INTO exercises(user_id,name,category,modality,is_custom,source) VALUES ($1,'Row','Strength','weight_reps',true,'custom') RETURNING id",
          [owner]
        )
      ).rows[0].id;
      await db.query(
        'INSERT INTO family_access(owner_user_id,family_user_id,family_email,access_permissions,is_active,status) VALUES($1,$2,$3,$4,true,$5)',
        [
          owner,
          other,
          accounts[1]!.user.email,
          JSON.stringify({
            can_manage_diary: true,
            can_view_exercise_library: true,
          }),
          'active',
        ]
      );
    } finally {
      db.release();
    }
    const { default: plans } =
      await import('../routes/workoutPlanTemplateRoutes.js');
    const { default: programs } =
      await import('../routes/trainingProgramRoutes.js');
    app.use(express.json(), cookieParser());
    app.use('/api/workout-plan-templates', plans);
    app.use('/api/training-programs', programs);
    app.use(errorHandler);
  }, 30000);
  beforeEach(async () => {
    const response = await call('/api/workout-plan-templates', {
      plan_name: 'Bulk independent weeks',
      start_date: '2099-10-11',
      end_date: '2099-10-18',
      is_active: false,
      schedule_type: 'sequential',
      entry_mode: 'prompt',
      sessions: Array.from({ length: 4 }, (_, i) => ({
        name: 'A',
        day_of_week: null,
        sort_order: i,
        assignments: [
          {
            exercise_id: exerciseId,
            sort_order: 0,
            sets: [
              {
                set_number: 1,
                reps: 5 + i,
                weight: i === 0 ? null : 20 + i,
                rest_time: 75 + i,
                notes: `Week ${i}: 5–8 each side; RPE 7`,
                effort: 'RPE 7',
                per_side: true,
                rpe: 5 + i,
                rir: 3 + i,
              },
              {
                set_number: 2,
                reps: 6 + i,
                weight: null,
                rest_time: 90,
                notes: `Second set ${i}`,
                rpe: 9,
                ...(i === 2 ? {} : { rir: 1 }),
              },
            ],
          },
          {
            exercise_id: differentExerciseId,
            sort_order: 1,
            sets: [
              {
                set_number: 1,
                reps: 12,
                weight: null,
                notes: `Untargeted row ${i}`,
              },
            ],
          },
        ],
      })),
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    plan = workoutPlanResponseSchema.parse(response.body);
    const created = await call('/api/training-programs', {
      name: 'Bulk Program',
      goal: 'Preserve weeks',
      start_date: '2099-10-11',
      end_date: '2099-10-18',
      schedule_type: 'fixed',
      phases: [
        {
          name: 'Base',
          goal: 'Strength',
          weeks: [
            {
              start_date: '2099-10-11',
              end_date: '2099-10-17',
              sessions: plan.sessions.map((s, i) => ({
                name: 'A',
                scheduled_date: `2099-10-${11 + i}`,
                workout_session_id: s.id,
              })),
            },
          ],
        },
      ],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    program = trainingProgramSchema.parse(created.body);
  });
  it('projects omitted history and preserves independent optional overrides through athlete-local future bulk apply', async () => {
    const db = await getSystemClient();
    const previousZone = (
      await db.query(
        'SELECT timezone FROM user_preferences WHERE user_id = $1',
        [owner]
      )
    ).rows[0];
    try {
      await db.query(
        `INSERT INTO user_preferences (user_id, timezone) VALUES ($1, 'America/Los_Angeles')
         ON CONFLICT (user_id) DO UPDATE SET timezone = EXCLUDED.timezone`,
        [owner]
      );
      await db.query(
        'UPDATE workout_plan_sessions SET is_optional = (id = $2) WHERE template_id = $1',
        [plan.id, plan.sessions[1]!.id]
      );
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-11T05:00:00Z'));
      const phase = program.phases[0]!;
      const week = phase.weeks[0]!;
      const dates = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-09'];
      const changed = await request(app)
        .put(`/api/training-programs/${program.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: program.name,
          goal: program.goal,
          start_date: '2026-10-08',
          end_date: '2026-10-14',
          schedule_type: 'fixed',
          auto_shift: false,
          phases: [
            {
              id: phase.id,
              name: phase.name,
              goal: phase.goal,
              weeks: [
                {
                  id: week.id,
                  start_date: '2026-10-08',
                  end_date: '2026-10-14',
                  sessions: week.sessions.map((s, i) => ({
                    id: s.id,
                    name: s.name,
                    scheduled_date: dates[i],
                    workout_session_id: s.workout_session_id,
                    is_optional: i >= 2,
                  })),
                },
              ],
            },
          ],
        });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      program = trainingProgramSchema.parse(changed.body);
      expect(planned()[3]!.status).toBe('omitted');
      const before = await fullState();
      const response = await request(app)
        .get(
          `/api/workout-plan-templates/${plan.id}/bulk-prescriptions/candidates?program_id=${program.id}`
        )
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(200);
      const expired = response.body.find(
        (c: { workout_session_id: string }) =>
          c.workout_session_id === plan.sessions[3]!.id
      );
      expect(expired.eligible).toBe(false);
      expect(expired.bindings[0].status).toBe('omitted');
      expect(expired.bindings[0].outcome_at).toBe(planned()[3]!.outcome_at);
      const tomorrowLocal = response.body.find(
        (c: { workout_session_id: string }) =>
          c.workout_session_id === plan.sessions[1]!.id
      );
      expect(tomorrowLocal.eligible).toBe(true);
      const body = input();
      body.fields = ['rpe', 'rir'];
      const p = await preview(body);
      const omittedRequest = {
        ...body,
        targets: [
          {
            workout_session_id: plan.sessions[3]!.id,
            assignment_id: plan.sessions[3]!.assignments[0]!.id,
            planned_session_ids: [planned()[3]!.id],
          },
        ],
      };
      expect((await call(`${endpoint}/preview`, omittedRequest)).status).toBe(
        409
      );
      expect(
        (
          await call(`${endpoint}/apply`, {
            request: omittedRequest,
            revision: p.revision,
          })
        ).status
      ).toBe(409);
      expect(await fullState()).toEqual(before);
      expect((await apply(p)).status).toBe(200);
      const after = await fullState();
      for (const [table, rows] of Object.entries(before)) {
        if (table !== 'sets') expect(after[table]).toEqual(rows);
      }
      const physical = await db.query(
        'SELECT status, outcome_at, is_optional FROM training_program_sessions WHERE id = $1',
        [planned()[3]!.id]
      );
      expect(physical.rows[0]).toEqual({
        status: 'planned',
        outcome_at: null,
        is_optional: true,
      });
    } finally {
      vi.useRealTimers();
      if (previousZone) {
        await db.query(
          'UPDATE user_preferences SET timezone = $2 WHERE user_id = $1',
          [owner, previousZone.timezone]
        );
      } else {
        await db.query('DELETE FROM user_preferences WHERE user_id = $1', [
          owner,
        ]);
      }
      db.release();
    }
  });
  afterAll(async () => {
    const db = await getSystemClient();
    try {
      await db.query(
        'DROP TRIGGER IF EXISTS bulk13_fault ON workout_plan_assignment_sets'
      );
      await db.query('DROP FUNCTION IF EXISTS bulk13_fault()');
      await db.query(
        'DELETE FROM training_programs WHERE user_id = ANY($1::uuid[])',
        [[owner, other]]
      );
      await db.query(
        'DELETE FROM exercise_entries WHERE user_id = ANY($1::uuid[])',
        [[owner, other]]
      );
      await db.query(
        'DELETE FROM exercise_preset_entries WHERE user_id = ANY($1::uuid[])',
        [[owner, other]]
      );
      await db.query(
        'DELETE FROM workout_plan_templates WHERE user_id = ANY($1::uuid[])',
        [[owner, other]]
      );
      await db.query('DELETE FROM exercises WHERE user_id = ANY($1::uuid[])', [
        [owner, other],
      ]);
      await db.query('DELETE FROM family_access WHERE owner_user_id = $1', [
        owner,
      ]);
      await db.query('DELETE FROM "user" WHERE id = ANY($1::uuid[])', [
        [owner, other],
      ]);
    } finally {
      db.release();
      await endPool();
    }
  });
  it('preview and cancellation preserve complete storage; apply changes only explicit fields and sessions', async () => {
    await outcome(3);
    const before = await fullState();
    const p = await preview();
    expect(await fullState()).toEqual(before);
    // Cancel is discarding the preview, not an API mutation. Re-preview remains identical.
    const again = await preview();
    expect(again).toEqual(p);
    expect(await fullState()).toEqual(before);
    expect(p.targets.map((t) => t.before.sets)).toEqual(
      plan.sessions.slice(1, 3).map((s) => s.assignments[0]!.sets)
    );
    const applied = await apply(p);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    const saved = await reload();
    expect(workoutPlanResponseSchema.parse(applied.body.plan)).toEqual(saved);
    expect(saved.sessions[0]).toEqual(plan.sessions[0]);
    expect(saved.sessions[3]).toEqual(plan.sessions[3]);
    for (const i of [1, 2]) {
      const expected = structuredClone(plan.sessions[i]!);
      expected.assignments[0]!.sets = expected.assignments[0]!.sets.map(
        (s) => ({ ...s, reps: 11, weight: null })
      );
      expect(saved.sessions[i]).toEqual(expected);
    }
    const after = await fullState();
    const rawBefore = before.sets as Array<Record<string, unknown>>;
    const rawAfter = after.sets as Array<Record<string, unknown>>;
    for (const old of rawBefore) {
      const row = rawAfter.find((s) => s.id === old.id)!;
      if (
        p.request.targets.some((t) => t.assignment_id === old.assignment_id)
      ) {
        expect(row).toEqual({
          ...old,
          reps: 11,
          weight: null,
          updated_at: row.updated_at,
          prescription: {
            ...(old.prescription as Record<string, unknown>),
            reps: 11,
            weight: null,
          },
        });
      } else expect(row).toEqual(old);
    }
    for (const table of [
      'training_programs',
      'training_program_phases',
      'training_program_weeks',
      'training_program_sessions',
      'exercise_entries',
      'exercise_entry_sets',
      'exercise_preset_entries',
    ])
      expect(after[table]).toEqual(before[table]);
    const repeat = await apply(p);
    expect(repeat.status).toBe(409);
    expect(await fullState()).toEqual(after);
  });

  it.each(['individual', 'frozen preset'] as const)(
    '%s effort-only edits copy numeric/null RPE and RIR without changing any other stored key or scalar',
    async (kind) => {
      await outcome(3);
      let effortPlan = plan;
      if (kind === 'frozen preset') {
        const created = await call('/api/workout-plan-templates', {
          plan_name: 'Effort-only frozen future sets',
          start_date: '2099-10-11',
          is_active: false,
          schedule_type: 'sequential',
          sessions: [0, 1, 2].map((i) => ({
            name: 'A',
            day_of_week: null,
            sort_order: i,
            assignments: [
              {
                sort_order: 0,
                sets: [],
                preset_snapshot: {
                  id: 701,
                  name: `Frozen effort ${i}`,
                  description: `Target-local description ${i}`,
                  workout_format: 'amrap',
                  time_cap_seconds: 600 + i,
                  exercises: [exerciseId, differentExerciseId].map((id, e) => ({
                    id: 80 + e,
                    exercise_id: id,
                    exercise_name: e ? 'Row' : 'Split squat',
                    image_url: null,
                    category: 'Strength',
                    superset_group: null,
                    equipment_brand: `Target-local equipment ${i}`,
                    sets: [1, 2].map((set_number) => ({
                      set_number,
                      reps: 5 + i + e + set_number,
                      weight: i === 0 ? null : 20 + i,
                      rest_time: 45 + i,
                      notes: `Keep notes ${i}/${e}/${set_number}`,
                      per_side: true,
                      effort: 'Keep authored effort wording',
                      rpe: 5 + i,
                      ...(i === 2 && set_number === 2 ? {} : { rir: 3 + i }),
                    })),
                  })),
                },
              },
            ],
          })),
        });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        effortPlan = workoutPlanResponseSchema.parse(created.body);
      }
      const source = effortPlan.sessions[0]!;
      const targets = effortPlan.sessions.slice(1, 3).map((session) => ({
        workout_session_id: session.id,
        assignment_id: session.assignments[0]!.id,
        planned_session_ids:
          kind === 'individual'
            ? planned()
                .filter((p) => p.workout_session_id === session.id)
                .map((p) => p.id)
            : [],
      }));
      for (const field of ['rpe', 'rir'] as const) {
        const value = field === 'rpe' ? 8.5 : 2.5;
        const prescription = workoutPlanAssignmentInputSchema.parse({
          ...source.assignments[0]!,
          preset_snapshot: source.assignments[0]!.preset_snapshot ?? undefined,
        });
        const sourceSets = prescription.preset_snapshot
          ? prescription.preset_snapshot.exercises.flatMap((e) => e.sets)
          : prescription.sets!;
        sourceSets.forEach((set) => {
          set[field] = set.set_number === 1 ? value : null;
        });
        const body: WorkoutPlanBulkRequest = {
          plan_id: effortPlan.id,
          program_id: kind === 'individual' ? program.id : null,
          source_session_id: source.id,
          source_assignment_id: source.assignments[0]!.id,
          prescription,
          fields: [field],
          targets,
        };
        const before = await fullState();
        const p = await preview(body);
        expect(await fullState()).toEqual(before);
        for (const target of p.targets) {
          const sets = target.after.preset_snapshot
            ? target.after.preset_snapshot.exercises.flatMap((e) => e.sets)
            : target.after.sets;
          expect(sets.map((set) => set[field])).toEqual(
            kind === 'individual' ? [value, null] : [value, null, value, null]
          );
        }
        const result = await apply(p);
        expect(result.status, JSON.stringify(result.body)).toBe(200);
        const after = await fullState();
        const expected = structuredClone(before);
        const table =
          kind === 'individual' ? 'sets' : 'workout_plan_template_assignments';
        type RawRow = Record<string, unknown> & {
          id: number;
          assignment_id: number;
          set_number: number;
          prescription: Record<string, unknown>;
          preset_snapshot: { exercises: { sets: Record<string, unknown>[] }[] };
        };
        const rows = expected[table] as RawRow[];
        const stored = after[table] as RawRow[];
        for (const row of rows) {
          if (
            !targets.some(
              (target) =>
                target.assignment_id ===
                (kind === 'individual' ? row.assignment_id : row.id)
            )
          )
            continue;
          row.updated_at = stored.find(
            (saved) => saved.id === row.id
          )!.updated_at;
          if (kind === 'individual') {
            row.prescription[field] = row.set_number === 1 ? value : null;
          } else {
            row.preset_snapshot.exercises.forEach((exercise) =>
              exercise.sets.forEach((set) => {
                set[field] = set.set_number === 1 ? value : null;
              })
            );
          }
        }
        // Exact raw SQL rows: all scalar columns, absent JSON keys, unrelated
        // prescriptions, source, completed snapshots, outcomes and links.
        expect(after).toEqual(expected);
        expect((await apply(p)).status).toBe(409);
        expect(await fullState()).toEqual(after);
      }
    }
  );
  it('ordinary single-session edits keep other weeks and completed diary/history exact after reload', async () => {
    await outcome(3);
    const before = await fullState();
    const edited = structuredClone(plan.sessions);
    edited[0]!.assignments[0]!.sets[0]!.reps = 13;
    const sessions = edited.map((s) => ({
      ...s,
      assignments: s.assignments.map((a) =>
        workoutPlanAssignmentInputSchema.parse({
          ...a,
          preset_snapshot: a.preset_snapshot ?? undefined,
        })
      ),
    }));
    const result = await request(app)
      .put(`/api/workout-plan-templates/${plan.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sessions });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const saved = await reload();
    expect(saved.sessions[0]!.assignments[0]!.sets[0]!.reps).toBe(13);
    expect(saved.sessions.slice(1)).toEqual(plan.sessions.slice(1));
    const after = await fullState();
    for (const table of [
      'training_program_sessions',
      'exercise_entries',
      'exercise_entry_sets',
      'exercise_preset_entries',
    ])
      expect(after[table]).toEqual(before[table]);
  });
  it.each(['source', 'target'])(
    'rejects stale %s state atomically even for an untargeted field',
    async (side) => {
      const p = await preview();
      const db = await getSystemClient();
      try {
        await db.query(
          'UPDATE workout_plan_assignment_sets SET notes = $2 WHERE assignment_id = $1',
          [
            plan.sessions[side === 'source' ? 0 : 2]!.assignments[0]!.id,
            'Concurrent note',
          ]
        );
      } finally {
        db.release();
      }
      const before = await fullState();
      expect((await apply(p)).status).toBe(409);
      expect(await fullState()).toEqual(before);
    }
  );
  it('rejects completion after preview without applying an earlier compatible target', async () => {
    const p = await preview();
    await outcome(2);
    const before = await fullState();
    expect((await apply(p)).status).toBe(409);
    expect(await fullState()).toEqual(before);
  });
  it('rejects altered confirmation fields and mismatched set-number shapes atomically', async () => {
    const p = await preview();
    const before = await fullState();
    const altered = structuredClone(p);
    altered.request.fields = ['notes'];
    expect((await apply(altered)).status).toBe(409);
    expect(await fullState()).toEqual(before);
    const body = input();
    body.prescription.sets = body.prescription.sets!.slice(0, 1);
    expect((await call(`${endpoint}/preview`, body)).status).toBe(409);
    expect(await fullState()).toEqual(before);
  });
  it('serializes authenticated completion ahead of apply and rejects the entire waiting batch', async () => {
    const p = await preview();
    const db = await getSystemClient();
    let completion: PromiseLike<{ status: number; body: unknown }> | undefined;
    let applying: PromiseLike<{ status: number; body: unknown }> | undefined;
    async function waitForBlocked(fragment: string) {
      for (let attempt = 0; attempt < 1000; attempt++) {
        // PostgreSQL caches activity observations inside this blocker transaction.
        await db.query('SELECT pg_stat_clear_snapshot()');
        const waiting = await db.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND strpos(query,$1) > 0",
          [fragment]
        );
        if (waiting.rowCount) return;
        await yieldToRequests();
      }
      throw new Error(`Expected authenticated request blocked at ${fragment}`);
    }
    try {
      const diary = await db.query(
        "INSERT INTO exercise_preset_entries(user_id,name,entry_date,source) VALUES ($1,'Separate actual workout','2099-10-13','manual') RETURNING id",
        [owner]
      );
      const entry = await db.query(
        "INSERT INTO exercise_entries(user_id,exercise_name,entry_date,duration_minutes,calories_burned,exercise_preset_entry_id) VALUES ($1,'Performed lift','2099-10-13',0,0,$2) RETURNING id",
        [owner, diary.rows[0].id]
      );
      await db.query(
        'INSERT INTO exercise_entry_sets(exercise_entry_id,set_number,reps,weight) VALUES ($1,1,8,50)',
        [entry.rows[0].id]
      );
      await db.query('BEGIN');
      await db.query(
        'SELECT id FROM training_programs WHERE id = $1 FOR UPDATE',
        [program.id]
      );
      completion = call(
        `/api/training-programs/${program.id}/sessions/${planned()[2]!.id}/outcome`,
        {
          status: 'completed',
          workout: { type: 'preset', id: diary.rows[0].id },
        }
      ).then((response: { status: number; body: unknown }) => response);
      await waitForBlocked('SELECT id, auto_shift FROM training_programs');
      applying = apply(p).then(
        (response: { status: number; body: unknown }) => response
      );
      await waitForBlocked('SELECT id FROM training_programs WHERE user_id');
      await db.query('COMMIT');
      expect((await completion!).status).toBe(200);
      const afterCompletion = await fullState();
      expect((await applying!).status).toBe(409);
      expect(await fullState()).toEqual(afterCompletion);
    } finally {
      await db.query('ROLLBACK');
      await Promise.all([completion, applying].filter(Boolean));
      db.release();
    }
  });
  it('rejects incompatible and invalid explicit exercise mappings without writes', async () => {
    for (const invalid of [plan.sessions[2]!.assignments[1]!.id, 2147483647]) {
      const body = input();
      body.targets[1]!.assignment_id = invalid;
      const before = await fullState();
      expect([400, 404, 409]).toContain(
        (await call(`${endpoint}/preview`, body)).status
      );
      expect(await fullState()).toEqual(before);
    }
  });
  it('refuses incomplete bindings and targets reused by another Program', async () => {
    const body = input();
    body.targets[0]!.planned_session_ids = [];
    const before = await fullState();
    expect((await call(`${endpoint}/preview`, body)).status).toBe(409);
    expect(await fullState()).toEqual(before);
    const created = await call('/api/training-programs', {
      name: 'Unselected Program',
      goal: 'Separate',
      start_date: '2099-10-11',
      end_date: '2099-10-18',
      schedule_type: 'fixed',
      phases: [
        {
          name: 'Other',
          goal: 'Other',
          weeks: [
            {
              start_date: '2099-10-11',
              end_date: '2099-10-17',
              sessions: [
                {
                  name: 'Same identity',
                  scheduled_date: '2099-10-15',
                  workout_session_id: plan.sessions[1]!.id,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(created.status).toBe(201);
    const shared = await fullState();
    expect((await call(`${endpoint}/preview`, input())).status).toBe(409);
    expect(await fullState()).toEqual(shared);
  });
  it('enforces authenticated owner-only bulk access and direct RLS against a diary delegate', async () => {
    const body = input();
    expect((await call(`${endpoint}/preview`, body, otherToken)).status).toBe(
      404
    );
    const delegated = await request(app)
      .post(`${endpoint}/preview`)
      .set('Authorization', `Bearer ${otherToken}`)
      .set('Cookie', `sparky_active_user_id=${owner}`)
      .send(body);
    expect(delegated.status).toBe(403);
    const candidates = await request(app)
      .get(
        `/api/workout-plan-templates/${plan.id}/bulk-prescriptions/candidates?program_id=${program.id}`
      )
      .set('Authorization', `Bearer ${otherToken}`)
      .set('Cookie', `sparky_active_user_id=${owner}`);
    expect(candidates.status).toBe(403);
    const db = await getClient(owner, other);
    try {
      expect(
        (
          await db.query(
            'UPDATE workout_plan_sessions SET name = $2 WHERE id = $1 RETURNING id',
            [plan.sessions[1]!.id, 'Forbidden']
          )
        ).rowCount
      ).toBe(0);
      expect(
        (
          await db.query(
            'SELECT id FROM training_program_sessions WHERE program_id = $1',
            [program.id]
          )
        ).rowCount
      ).toBe(0);
    } finally {
      db.release();
    }
  });
  it('copies only chosen frozen preset fields, preserving target notes, metadata and uncapped null', async () => {
    const created = await call('/api/workout-plan-templates', {
      plan_name: 'Frozen standalone future prescriptions',
      start_date: '2099-10-11',
      end_date: '2099-10-18',
      is_active: false,
      schedule_type: 'sequential',
      sessions: [0, 1, 2].map((i) => ({
        name: 'Conditioning',
        day_of_week: null,
        sort_order: i,
        assignments: [
          {
            sort_order: 0,
            sets: [],
            preset_snapshot: {
              id: 700,
              name: `Local conditioning ${i}`,
              description: `Keep description ${i}`,
              workout_format: i === 0 ? 'amrap' : 'interval',
              time_cap_seconds: i === 0 ? null : 600 + i,
              exercises: [exerciseId, differentExerciseId].map((id, e) => ({
                id: 70 + e,
                exercise_id: id,
                exercise_name: e ? 'Row' : 'Split squat',
                image_url: null,
                category: 'Strength',
                superset_group: null,
                equipment_brand: `Keep equipment ${i}`,
                sets: [
                  {
                    set_number: 1,
                    reps: 5 + i,
                    weight: null,
                    notes: `Keep per-side range ${i}/${e}`,
                    rest_time: 45 + i,
                  },
                ],
              })),
            },
          },
        ],
      })),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const frozen = workoutPlanResponseSchema.parse(created.body);
    const source = frozen.sessions[0]!;
    const body: WorkoutPlanBulkRequest = {
      plan_id: frozen.id,
      program_id: null,
      source_session_id: source.id,
      source_assignment_id: source.assignments[0]!.id,
      prescription: workoutPlanAssignmentInputSchema.parse({
        ...source.assignments[0]!,
        preset_snapshot: source.assignments[0]!.preset_snapshot ?? undefined,
      }),
      fields: ['reps', 'workout_format', 'time_cap_seconds'],
      targets: [
        {
          workout_session_id: frozen.sessions[1]!.id,
          assignment_id: frozen.sessions[1]!.assignments[0]!.id,
          planned_session_ids: [],
        },
      ],
    };
    const before = await fullState();
    const p = await preview(body);
    expect(await fullState()).toEqual(before);
    const result = await apply(p);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const saved = workoutPlanResponseSchema.parse(result.body.plan);
    const expected = structuredClone(frozen);
    const target = expected.sessions[1]!.assignments[0]!.preset_snapshot!;
    target.workout_format = 'amrap';
    expected.sessions[1]!.assignments[0]!.workout_preset_format = 'amrap';
    target.time_cap_seconds = null;
    target.exercises.forEach((e) => {
      e.sets[0]!.reps = 5;
    });
    expect(saved.sessions).toEqual(expected.sessions);
    const incompatible = structuredClone(body);
    incompatible.fields = ['notes'];
    const db = await getSystemClient();
    try {
      const changed = structuredClone(
        saved.sessions[1]!.assignments[0]!.preset_snapshot!
      );
      changed.exercises.reverse();
      await db.query(
        'UPDATE workout_plan_template_assignments SET preset_snapshot = $2 WHERE id = $1',
        [body.targets[0]!.assignment_id, JSON.stringify(changed)]
      );
    } finally {
      db.release();
    }
    const unchanged = await fullState();
    expect([400, 409]).toContain(
      (await call(`${endpoint}/preview`, incompatible)).status
    );
    expect(await fullState()).toEqual(unchanged);
  });
  it('rolls back writes to earlier targets when PostgreSQL fails later in the batch', async () => {
    const body = input();
    body.fields = ['rpe', 'rir'];
    body.prescription.sets!.forEach((set) => {
      set.rpe = 8.5;
      set.rir = null;
    });
    const p = await preview(body);
    const db = await getSystemClient();
    const failedId = plan.sessions[2]!.assignments[0]!.id;
    try {
      await db.query(
        `CREATE FUNCTION bulk13_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.assignment_id = ${failedId} THEN RAISE EXCEPTION 'bulk13 injected transactional fault'; END IF; RETURN NEW; END $$`
      );
      await db.query(
        'CREATE TRIGGER bulk13_fault BEFORE UPDATE ON workout_plan_assignment_sets FOR EACH ROW EXECUTE FUNCTION bulk13_fault()'
      );
      const before = await fullState();
      expect((await apply(p)).status).toBe(500);
      expect(await fullState()).toEqual(before);
    } finally {
      await db.query(
        'DROP TRIGGER IF EXISTS bulk13_fault ON workout_plan_assignment_sets'
      );
      await db.query('DROP FUNCTION IF EXISTS bulk13_fault()');
      db.release();
    }
  });
  it('preserves the full 12-week 57-session prescription fixture outside two explicit future identities', async () => {
    const day = (offset: number) =>
      new Date(Date.UTC(2099, 9, 11 + offset)).toISOString().slice(0, 10);
    const authored = Array.from({ length: 12 }, (_, week) => {
      const labels = [
        'A',
        'Conditioning',
        'B',
        'Conditioning',
        ...([3, 7, 11].includes(week) ? [] : ['C (optional)']),
      ];
      return labels.map((name, order) => ({
        name,
        day_of_week: null,
        sort_order: week * 5 + order,
        assignments: [
          {
            exercise_id:
              name === 'Conditioning' ? differentExerciseId : exerciseId,
            sort_order: 0,
            sets: [
              {
                set_number: 1,
                set_type: 'working',
                reps: 5 + week,
                weight: null,
                rest_time: 60 + week,
                duration: name === 'Conditioning' ? 120 + week : null,
                notes: `Week ${week + 1}: 5–8 each side; effort ${7 + (week % 2)}; preserve range and null load`,
                per_side: name !== 'Conditioning',
                effort: `RPE ${7 + (week % 2)}`,
              },
            ],
          },
        ],
      }));
    });
    const created = await call('/api/workout-plan-templates', {
      plan_name: 'Synthetic twelve-week acceptance',
      start_date: day(0),
      end_date: day(83),
      schedule_type: 'sequential',
      is_active: false,
      sessions: authored.flat(),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const fixture = workoutPlanResponseSchema.parse(created.body);
    expect(fixture.sessions).toHaveLength(57);
    const weekSessions = authored.map((week, index) =>
      fixture.sessions.filter(
        (s) =>
          s.sort_order >= index * 5 && s.sort_order < index * 5 + week.length
      )
    );
    const createdProgram = await call('/api/training-programs', {
      name: 'Synthetic twelve-week Program',
      goal: 'Independent prescriptions',
      start_date: day(0),
      end_date: day(83),
      schedule_type: 'fixed',
      phases: [
        {
          name: 'Twelve weeks',
          goal: 'Preserve progression',
          weeks: weekSessions.map((sessions, index) => ({
            start_date: day(index * 7),
            end_date: day(index * 7 + 6),
            sessions: sessions.map((s, order) => ({
              name: s.name,
              scheduled_date: day(index * 7 + order),
              workout_session_id: s.id,
            })),
          })),
        },
      ],
    });
    expect(createdProgram.status, JSON.stringify(createdProgram.body)).toBe(
      201
    );
    const bound = trainingProgramSchema.parse(createdProgram.body);
    const source = weekSessions[0]![0]!;
    const targets = [weekSessions[1]![0]!, weekSessions[2]![0]!];
    const body: WorkoutPlanBulkRequest = {
      plan_id: fixture.id,
      program_id: bound.id,
      source_session_id: source.id,
      source_assignment_id: source.assignments[0]!.id,
      prescription: workoutPlanAssignmentInputSchema.parse({
        ...source.assignments[0]!,
        preset_snapshot: undefined,
      }),
      fields: ['rest_time'],
      targets: targets.map((s) => ({
        workout_session_id: s.id,
        assignment_id: s.assignments[0]!.id,
        planned_session_ids: bound.phases.flatMap((p) =>
          p.weeks.flatMap((w) =>
            w.sessions
              .filter((b) => b.workout_session_id === s.id)
              .map((b) => b.id)
          )
        ),
      })),
    };
    const before = await fullState();
    const p = await preview(body);
    expect(await fullState()).toEqual(before);
    const result = await apply(p);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const saved = workoutPlanResponseSchema.parse(result.body.plan);
    const expected = structuredClone(fixture.sessions);
    for (const target of targets)
      expected.find(
        (s) => s.id === target.id
      )!.assignments[0]!.sets[0]!.rest_time = 60;
    expect(saved.sessions).toEqual(expected);
    const after = await fullState();
    for (const table of [
      'training_programs',
      'training_program_phases',
      'training_program_weeks',
      'training_program_sessions',
      'exercise_entries',
      'exercise_entry_sets',
      'exercise_preset_entries',
    ])
      expect(after[table]).toEqual(before[table]);
  });
});
