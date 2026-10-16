import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getClient } from '../db/poolManager.js';

type Row = { id: string | number; [key: string]: unknown };
type Inventory = Record<string, Row[]>;
const id = z.number().int().positive().max(2147483647);
const setMappingSchema = z.strictObject({
  source_set_id: id,
  target_set_id: id,
});
const assignmentMappingSchema = z.strictObject({
  source_assignment_id: id,
  target_assignment_id: id,
  sets: z.array(setMappingSchema),
});
const mappingSchema = z.strictObject({
  source_session_id: z.uuid(),
  source_plan_id: id,
  target_session_id: z.uuid(),
  target_day_of_week: z.null(),
  mode: z.enum(['move', 'clone']),
  sort_order: z.number().int().nonnegative(),
  planned_session_ids: z.array(z.uuid()).min(1),
  assignments: z.array(assignmentMappingSchema),
});
// Validate routing/ownership without interpreting or changing an approved
// recorded manifest. Only new operations use the current write schema.
export const consolidationIdentitySchema = z.object({
  operation_id: z.uuid(),
  user_id: z.uuid(),
  program_id: z.uuid(),
});
export const consolidationManifestSchema = z.strictObject({
  ...consolidationIdentitySchema.shape,
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  target_plan: z.strictObject({
    id,
    name: z.string().trim().min(1).max(200),
    description: z.string().nullable(),
  }),
  retire_plan_ids: z.array(id),
  mapping: z.array(mappingSchema).min(1),
});
export type ConsolidationManifest = z.infer<typeof consolidationManifestSchema>;
export type ConsolidationMapping = z.infer<typeof mappingSchema>;
const inputSchema = z.strictObject({
  program_id: z.uuid(),
  target_plan_name: z.string().trim().min(1).max(200),
  description: z.string().nullable().optional(),
  operation_id: z.uuid().optional(),
  legacy_mapping: z.record(z.string(), id).optional(),
});
export type ConsolidationInput = z.infer<typeof inputSchema>;
export interface ConsolidationResult {
  operation_id: string;
  target_plan_id: number;
  already_applied: boolean;
  mapping: Array<
    Omit<ConsolidationMapping, 'target_day_of_week'> & {
      target_day_of_week?: null;
    }
  >;
}
export interface ConsolidationPreflight {
  schema_state: 'legacy' | 'sessions';
  inventory: Inventory;
  proposal: ConsolidationManifest | null;
  unresolved: Array<{
    planned_session_id: string;
    workout_plan_id: number;
    candidate_assignment_ids: number[];
  }>;
  blockers: string[];
  legacy_mapping: Record<string, number>;
  protections: Record<string, string[]>;
}
function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) fail(400, parsed.error.message);
  return parsed.data;
}
function owner(userId: string, actor: string): void {
  parse(z.uuid(), userId);
  if (actor !== userId)
    fail(404, 'Selected Program is not accessible to this actor.');
}
// Approval covers transactional graph data. Sequence values are deliberately
// excluded: failed/interrupted writes consume values but must not invalidate an
// unchanged approved mapping whose explicit IDs are still unused.
function inventoryRevision(inventory: Inventory): string {
  const revision = createHash('sha256');
  for (const [table, rows] of Object.entries(inventory)) {
    if (table !== 'identity_sequences')
      revision
        .update(table)
        .update('\0')
        .update(JSON.stringify(rows))
        .update('\0');
  }
  return revision.digest('hex');
}
const scopes: Array<[string, string]> = [
  ['training_programs', 't.user_id = $1'],
  ['training_program_phases', 't.user_id = $1'],
  ['training_program_weeks', 't.user_id = $1'],
  ['training_program_sessions', 't.user_id = $1'],
  ['workout_plan_templates', 't.user_id = $1'],
  ['workout_plan_template_assignments', 't.user_id = $1'],
  [
    'workout_plan_assignment_sets',
    'EXISTS (SELECT 1 FROM workout_plan_template_assignments a WHERE a.id = t.assignment_id AND a.user_id = $1)',
  ],
  ['exercise_entries', 't.user_id = $1'],
  ['exercise_preset_entries', 't.user_id = $1'],
  [
    'exercise_entry_sets',
    'EXISTS (SELECT 1 FROM exercise_entries e WHERE e.id = t.exercise_entry_id AND e.user_id = $1)',
  ],
  [
    'exercise_entry_activity_details',
    'EXISTS (SELECT 1 FROM exercise_entries e WHERE e.id = t.exercise_entry_id AND e.user_id = $1) OR EXISTS (SELECT 1 FROM exercise_preset_entries e WHERE e.id = t.exercise_preset_entry_id AND e.user_id = $1)',
  ],
  ['family_access', 't.owner_user_id = $1'],
  [
    'exercises',
    't.user_id = $1 OR EXISTS (SELECT 1 FROM workout_plan_template_assignments a JOIN workout_plan_templates p ON p.id = a.template_id WHERE p.user_id = $1 AND a.exercise_id = t.id)',
  ],
  [
    'workout_presets',
    't.user_id = $1 OR EXISTS (SELECT 1 FROM workout_plan_template_assignments a JOIN workout_plan_templates p ON p.id = a.template_id WHERE p.user_id = $1 AND a.workout_preset_id = t.id)',
  ],
  [
    'workout_preset_exercises',
    'EXISTS (SELECT 1 FROM workout_presets p WHERE p.id = t.workout_preset_id AND (p.user_id = $1 OR EXISTS (SELECT 1 FROM workout_plan_template_assignments a JOIN workout_plan_templates w ON w.id = a.template_id WHERE w.user_id = $1 AND a.workout_preset_id = p.id)))',
  ],
  [
    'workout_preset_exercise_sets',
    'EXISTS (SELECT 1 FROM workout_preset_exercises e JOIN workout_presets p ON p.id = e.workout_preset_id WHERE e.id = t.workout_preset_exercise_id AND (p.user_id = $1 OR EXISTS (SELECT 1 FROM workout_plan_template_assignments a JOIN workout_plan_templates w ON w.id = a.template_id WHERE w.user_id = $1 AND a.workout_preset_id = p.id)))',
  ],
];
const identityTables = [
  'workout_plan_templates',
  'workout_plan_template_assignments',
  'workout_plan_assignment_sets',
] as const;
async function capture(
  client: PoolClient,
  userId: string,
  sessions: boolean
): Promise<Inventory> {
  const inventory: Inventory = {};
  for (const [table, configuredWhere] of scopes) {
    // Legacy assignments gain user_id only in #11. Use their real parent
    // ownership before that cutover rather than inventing a parallel upgrade.
    const where =
      !sessions && table === 'workout_plan_template_assignments'
        ? 'EXISTS (SELECT 1 FROM workout_plan_templates p WHERE p.id = t.template_id AND p.user_id = $1)'
        : !sessions && table === 'workout_plan_assignment_sets'
          ? 'EXISTS (SELECT 1 FROM workout_plan_template_assignments a JOIN workout_plan_templates p ON p.id = a.template_id WHERE a.id = t.assignment_id AND p.user_id = $1)'
          : configuredWhere;
    // Identifiers and predicates are module constants, never operator input.
    const result = await client.query<{ row: Row }>(
      `SELECT to_jsonb(t) AS row FROM public.${table} t WHERE ${where} ORDER BY t.id`,
      [userId]
    );
    inventory[table] = result.rows.map(({ row }) => row);
  }
  const journal = await client.query<{ ready: boolean }>(
    "SELECT to_regclass('public.workout_program_consolidations') IS NOT NULL AS ready"
  );
  inventory.workout_program_consolidations = journal.rows[0].ready
    ? (
        await client.query<{ row: Row }>(
          'SELECT to_jsonb(t) AS row FROM workout_program_consolidations t WHERE user_id = $1 ORDER BY id',
          [userId]
        )
      ).rows.map(({ row }) => row)
    : [];
  if (sessions) {
    const result = await client.query<{ row: Row }>(
      'SELECT to_jsonb(t) AS row FROM workout_plan_sessions t WHERE user_id = $1 ORDER BY id',
      [userId]
    );
    inventory.workout_plan_sessions = result.rows.map(({ row }) => row);
    inventory.identity_sequences = [];
    for (const table of identityTables) {
      const sequence = await client.query<{
        start: string;
        increment: string;
        cache: string;
        cycle: boolean;
        last: string | null;
      }>(
        `SELECT seqstart::text AS start, seqincrement::text AS increment, seqcache::text AS cache, seqcycle AS cycle,
          pg_sequence_last_value(seqrelid)::text AS last FROM pg_sequence
          WHERE seqrelid = pg_get_serial_sequence($1, 'id')::regclass`,
        [`public.${table}`]
      );
      const state = sequence.rows[0];
      if (
        !state ||
        state.increment !== '1' ||
        state.cache !== '1' ||
        state.cycle
      )
        fail(
          409,
          'Consolidation requires normal increment-one, uncached identity sequences.'
        );
      inventory.identity_sequences.push({
        id: table,
        next_id:
          state.last === null ? Number(state.start) : Number(state.last) + 1,
      });
    }
  }
  return inventory;
}
function selected(inventory: Inventory, programId: string): Row[] {
  if (!inventory.training_programs.some((p) => p.id === programId))
    fail(404, 'Selected Program was not found.');
  const weeks = new Map(inventory.training_program_weeks.map((w) => [w.id, w]));
  const phases = new Map(
    inventory.training_program_phases.map((p) => [p.id, p])
  );
  return inventory.training_program_sessions
    .filter((s) => s.program_id === programId)
    .sort((a, b) => {
      const aw = weeks.get(String(a.week_id));
      const bw = weeks.get(String(b.week_id));
      const ap = aw && phases.get(String(aw.phase_id));
      const bp = bw && phases.get(String(bw.phase_id));
      return (
        Number(ap?.sort_order) - Number(bp?.sort_order) ||
        Number(aw?.sort_order) - Number(bw?.sort_order) ||
        Number(a.sort_order) - Number(b.sort_order) ||
        String(a.id).localeCompare(String(b.id))
      );
    });
}
function workoutBindings(bindings: Row[]): Row[] {
  return bindings.filter((s) => s.workout_session_id !== null);
}
function protections(
  inventory: Inventory,
  bindings: Row[]
): Record<string, string[]> {
  const sourceIds = new Set(bindings.map((s) => s.workout_session_id));
  const selectedIds = new Set(bindings.map((s) => s.id));
  const hasReader = inventory.family_access.some((f) => {
    const permissions = f.access_permissions as Record<string, unknown> | null;
    return (
      f.is_active === true &&
      (!f.access_end_date ||
        new Date(String(f.access_end_date)).getTime() > Date.now()) &&
      (permissions?.can_view_reports === true ||
        permissions?.can_view_reports === 'true' ||
        permissions?.can_view_exercise_library === true ||
        permissions?.can_view_exercise_library === 'true')
    );
  });
  const result: Record<string, string[]> = {};
  for (const sessionId of sourceIds) {
    const session = inventory.workout_plan_sessions.find(
      (s) => s.id === sessionId
    );
    if (!session)
      fail(409, 'A selected binding has no owner-consistent Workout Session.');
    const plan = inventory.workout_plan_templates.find(
      (p) => p.id === session.template_id
    );
    if (!plan)
      fail(409, 'A selected Workout Session has no owned parent plan.');
    const reasons: string[] = [];
    if (plan.is_active === true) reasons.push('active standalone plan');
    if (hasReader) reasons.push('active family library/report reader');
    if (
      inventory.workout_plan_sessions.some(
        (s) => s.template_id === plan.id && !sourceIds.has(s.id)
      )
    )
      reasons.push('unselected library sessions in source plan');
    if (
      inventory.training_program_sessions.some(
        (s) => s.workout_session_id === sessionId && !selectedIds.has(s.id)
      )
    )
      reasons.push('another Program binding');
    if (
      inventory.workout_program_consolidations.some(
        (c) => c.target_plan_id === plan.id
      )
    )
      reasons.push('retained consolidation rollback journal');
    const assignmentIds = new Set(
      inventory.workout_plan_template_assignments
        .filter((a) => a.workout_session_id === sessionId)
        .map((a) => a.id)
    );
    const sourceBindings = bindings.filter(
      (s) => s.workout_session_id === sessionId
    );
    const entryIds = new Set(
      sourceBindings.map((s) => s.exercise_entry_id).filter(Boolean)
    );
    const parentIds = new Set(
      sourceBindings.map((s) => s.exercise_preset_entry_id).filter(Boolean)
    );
    if (
      inventory.exercise_entries.some(
        (e) =>
          assignmentIds.has(e.workout_plan_assignment_id as number) &&
          !entryIds.has(e.id) &&
          !parentIds.has(e.exercise_preset_entry_id)
      )
    )
      reasons.push('diary assignment links outside recorded selected outcomes');
    result[String(sessionId)] = reasons;
  }
  return result;
}
function next(inventory: Inventory, table: string): number {
  const value = Number(
    inventory.identity_sequences.find((s) => s.id === table)?.next_id
  );
  return parse(id, value);
}
function assignmentMaps(
  inventory: Inventory,
  sourceId: string,
  mode: 'move' | 'clone',
  counters: { assignment: number; set: number }
): ConsolidationMapping['assignments'] {
  return inventory.workout_plan_template_assignments
    .filter((a) => a.workout_session_id === sourceId)
    .sort(
      (a, b) =>
        Number(a.sort_order ?? Number.MAX_SAFE_INTEGER) -
          Number(b.sort_order ?? Number.MAX_SAFE_INTEGER) ||
        Number(a.id) - Number(b.id)
    )
    .map((a) => ({
      source_assignment_id: Number(a.id),
      target_assignment_id:
        mode === 'move' ? Number(a.id) : parse(id, counters.assignment++),
      sets: inventory.workout_plan_assignment_sets
        .filter((s) => s.assignment_id === a.id)
        .sort(
          (a, b) =>
            Number(a.set_number) - Number(b.set_number) ||
            Number(a.id) - Number(b.id)
        )
        .map((s) => ({
          source_set_id: Number(s.id),
          target_set_id:
            mode === 'move' ? Number(s.id) : parse(id, counters.set++),
        })),
    }));
}
function report(
  inventory: Inventory,
  input: ConsolidationInput,
  userId: string,
  sessions: boolean
): ConsolidationPreflight {
  const bindings = selected(inventory, input.program_id);
  const output: ConsolidationPreflight = {
    schema_state: sessions ? 'sessions' : 'legacy',
    inventory,
    proposal: null,
    unresolved: [],
    blockers: [],
    legacy_mapping: input.legacy_mapping ?? {},
    protections: {},
  };
  if (!bindings.length) {
    output.blockers.push('Selected Program has no Planned Sessions.');
    return output;
  }
  if (!sessions) {
    for (const key of Object.keys(output.legacy_mapping))
      if (!bindings.some((s) => s.id === key))
        fail(
          400,
          'Legacy mapping contains a Planned Session outside the selected Program.'
        );
    for (const binding of bindings) {
      const plan = inventory.workout_plan_templates.find(
        (p) => p.id === binding.workout_plan_id
      );
      if (!plan) fail(409, 'Legacy Program reference has no owned plan.');
      const assignments = inventory.workout_plan_template_assignments.filter(
        (a) => a.template_id === plan.id
      );
      const groupKeys = new Set(
        assignments.map((a) =>
          plan.schedule_type === 'weekly'
            ? (a.day_of_week ?? null)
            : (a.session_index ?? 1)
        )
      );
      const anchor = output.legacy_mapping[String(binding.id)];
      if (anchor !== undefined && !assignments.some((a) => a.id === anchor))
        fail(400, 'Legacy assignment anchor belongs to another plan or owner.');
      if (groupKeys.size > 1 && anchor === undefined)
        output.unresolved.push({
          planned_session_id: String(binding.id),
          workout_plan_id: Number(plan.id),
          candidate_assignment_ids: assignments.map((a) => Number(a.id)),
        });
    }
    output.blockers.push(
      'Apply the existing #11 generic upgrade with explicit reviewed legacy mapping, then #12/#14 startup migrations and rerun this preflight. No schema changes are made by this operator.'
    );
    return output;
  }
  const selectedWorkouts = workoutBindings(bindings);
  if (!selectedWorkouts.length) {
    output.blockers.push(
      'Selected Program has no Workout Sessions to consolidate.'
    );
    return output;
  }
  output.protections = protections(inventory, selectedWorkouts);
  const sourceIds = [
    ...new Set(selectedWorkouts.map((s) => String(s.workout_session_id))),
  ];
  const counters = {
    assignment: next(inventory, 'workout_plan_template_assignments'),
    set: next(inventory, 'workout_plan_assignment_sets'),
  };
  const mapping: ConsolidationMapping[] = sourceIds.map(
    (sourceId, sort_order) => {
      const session = inventory.workout_plan_sessions.find(
        (s) => s.id === sourceId
      )!;
      const mode = output.protections[sourceId].length ? 'clone' : 'move';
      return {
        source_session_id: sourceId,
        source_plan_id: Number(session.template_id),
        target_session_id: mode === 'move' ? sourceId : randomUUID(),
        target_day_of_week: null,
        mode,
        sort_order,
        planned_session_ids: selectedWorkouts
          .filter((s) => s.workout_session_id === sourceId)
          .map((s) => String(s.id))
          .sort(),
        assignments: assignmentMaps(inventory, sourceId, mode, counters),
      };
    }
  );
  output.proposal = parse(consolidationManifestSchema, {
    operation_id: input.operation_id ?? randomUUID(),
    user_id: userId,
    program_id: input.program_id,
    revision: inventoryRevision(inventory),
    target_plan: {
      id: next(inventory, 'workout_plan_templates'),
      name: input.target_plan_name,
      description: input.description ?? null,
    },
    retire_plan_ids: [],
    mapping,
  });
  return output;
}
export async function preflightWorkoutProgramConsolidation(
  userId: string,
  input: ConsolidationInput,
  authenticatedUserId = userId
): Promise<ConsolidationPreflight> {
  owner(userId, authenticatedUserId);
  input = parse(inputSchema, input);
  const client: PoolClient = await getClient(userId, authenticatedUserId);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await assertApplicationRole(client);
    const state = await client.query<{
      ready: boolean;
      journal_ready: boolean;
    }>(
      "SELECT to_regclass('public.workout_plan_sessions') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'training_program_sessions' AND column_name = 'workout_plan_id') AS ready, to_regclass('public.workout_program_consolidations') IS NOT NULL AS journal_ready"
    );
    const output = report(
      await capture(client, userId, state.rows[0].ready),
      input,
      userId,
      state.rows[0].ready
    );
    if (state.rows[0].ready && !state.rows[0].journal_ready)
      output.blockers.push(
        'Normal startup must apply migration20261011140000 before this proposal can be applied.'
      );
    await client.query('COMMIT');
    return output;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function assertApplicationRole(client: PoolClient): Promise<void> {
  const role = await client.query<{
    unsafe: boolean;
  }>(`SELECT r.rolsuper OR r.rolbypassrls OR pg_has_role(current_user, c.relowner, 'USAGE') AS unsafe
    FROM pg_roles r JOIN pg_class c ON c.oid = 'public.training_programs'::regclass WHERE r.rolname = current_user`);
  if (!role.rows.length || role.rows[0].unsafe)
    fail(
      403,
      'Consolidation requires the non-owner, non-BYPASSRLS application database role.'
    );
}

async function lockScope(client: PoolClient, userId: string): Promise<void> {
  // Matches Program/bulk authoring and logging's parent-to-child lock order.
  await client.query(
    'SELECT id FROM training_programs WHERE user_id = $1 ORDER BY id FOR UPDATE',
    [userId]
  );
  await client.query(
    'SELECT id FROM workout_plan_templates WHERE user_id = $1 ORDER BY id FOR UPDATE',
    [userId]
  );
  await client.query(
    'SELECT id FROM workout_plan_sessions WHERE user_id = $1 ORDER BY id FOR UPDATE',
    [userId]
  );
  await client.query(
    'SELECT id FROM workout_plan_template_assignments WHERE user_id = $1 ORDER BY id FOR UPDATE',
    [userId]
  );
  await client.query(
    'SELECT s.id FROM workout_plan_assignment_sets s JOIN workout_plan_template_assignments a ON a.id = s.assignment_id WHERE a.user_id = $1 ORDER BY s.id FOR UPDATE OF s',
    [userId]
  );
}
function validateManifest(
  inventory: Inventory,
  manifest: ConsolidationManifest
): void {
  if (inventoryRevision(inventory) !== manifest.revision)
    fail(409, 'Preflight is stale; export and approve a new manifest.');
  const bindings = workoutBindings(selected(inventory, manifest.program_id));
  const sourceIds = new Set(bindings.map((s) => s.workout_session_id));
  const protection = protections(inventory, bindings);
  if (
    manifest.mapping.length !== sourceIds.size ||
    new Set(manifest.mapping.map((m) => m.source_session_id)).size !==
      sourceIds.size ||
    new Set(manifest.mapping.map((m) => m.target_session_id)).size !==
      sourceIds.size
  )
    fail(400, 'Mapping must cover each exact source Session once.');
  if (
    inventory.workout_plan_templates.some(
      (p) => p.id === manifest.target_plan.id
    )
  )
    fail(409, 'Proposed target plan identity already exists.');
  const cloneAssignments = manifest.mapping
    .filter((m) => m.mode === 'clone')
    .flatMap((m) => m.assignments);
  const cloneSets = cloneAssignments.flatMap((a) => a.sets);
  if (
    new Set(cloneAssignments.map((a) => a.target_assignment_id)).size !==
      cloneAssignments.length ||
    new Set(cloneSets.map((s) => s.target_set_id)).size !== cloneSets.length
  )
    fail(400, 'Clone assignment/set target identities must be unique.');
  if (
    cloneAssignments.some((a) =>
      inventory.workout_plan_template_assignments.some(
        (existing) => existing.id === a.target_assignment_id
      )
    ) ||
    cloneSets.some((s) =>
      inventory.workout_plan_assignment_sets.some(
        (existing) => existing.id === s.target_set_id
      )
    )
  )
    fail(409, 'A proposed clone assignment/set identity already exists.');
  for (const [ordinal, mapping] of manifest.mapping.entries()) {
    const session = inventory.workout_plan_sessions.find(
      (s) => s.id === mapping.source_session_id
    );
    if (
      !sourceIds.has(mapping.source_session_id) ||
      !session ||
      session.template_id !== mapping.source_plan_id
    )
      fail(
        400,
        'Mapping contains a Session outside the selected Program/plan/owner.'
      );
    if (
      mapping.sort_order !== ordinal ||
      mapping.source_session_id !== [...sourceIds][ordinal]
    )
      fail(
        400,
        'Mapping target order must retain explicit Program occurrence order.'
      );
    const expected = bindings
      .filter((s) => s.workout_session_id === mapping.source_session_id)
      .map((s) => String(s.id))
      .sort();
    if (!isDeepStrictEqual(expected, mapping.planned_session_ids))
      fail(
        400,
        'Mapping must retain every exact Planned Session relationship.'
      );
    if (
      mapping.mode === 'move' &&
      (mapping.target_session_id !== mapping.source_session_id ||
        protection[mapping.source_session_id].length)
    )
      fail(
        409,
        'An outside consumer protects this source; use an explicit clone and retain its container.'
      );
    if (
      mapping.mode === 'clone' &&
      inventory.workout_plan_sessions.some(
        (s) => s.id === mapping.target_session_id
      )
    )
      fail(400, 'Clone identity already exists.');
    const original = assignmentMaps(
      inventory,
      mapping.source_session_id,
      'move',
      { assignment: 0, set: 0 }
    );
    const membership = mapping.assignments.map((a) => ({
      source_assignment_id: a.source_assignment_id,
      target_assignment_id: a.source_assignment_id,
      sets: a.sets.map((s) => ({
        source_set_id: s.source_set_id,
        target_set_id: s.source_set_id,
      })),
    }));
    if (
      !isDeepStrictEqual(original, membership) ||
      (mapping.mode === 'move' &&
        !isDeepStrictEqual(original, mapping.assignments))
    )
      fail(
        400,
        'Assignment/set mapping does not preserve every exact source membership and retained move identity.'
      );
  }
  if (
    new Set(manifest.retire_plan_ids).size !== manifest.retire_plan_ids.length
  )
    fail(400, 'Retirement IDs must be unique.');
  for (const planId of manifest.retire_plan_ids) {
    const mappings = manifest.mapping.filter(
      (m) => m.source_plan_id === planId
    );
    const plan = inventory.workout_plan_templates.find((p) => p.id === planId);
    if (
      !plan ||
      !mappings.length ||
      plan.is_active === true ||
      mappings.some(
        (m) => m.mode !== 'move' || protection[m.source_session_id].length
      ) ||
      inventory.workout_plan_sessions.some(
        (s) =>
          s.template_id === planId &&
          !mappings.some((m) => m.source_session_id === s.id)
      )
    )
      fail(
        409,
        'Retirement would remove a container still required outside approved moves.'
      );
  }
}
async function allocate(
  client: PoolClient,
  table: (typeof identityTables)[number],
  expected: number
): Promise<void> {
  const value = await client.query<{ id: number }>(
    "SELECT nextval(pg_get_serial_sequence($1, 'id'))::integer AS id",
    [`public.${table}`]
  );
  // An unused approved slot may be below the sequence after an interrupted
  // transaction. Advancing once keeps future defaults above the inserted ID;
  // the primary key rejects an intervening claimant without overwriting it.
  if (value.rows[0].id < expected)
    fail(
      409,
      'The approved identity is ahead of its allocator; export a fresh explicit mapping.'
    );
}
export async function applyWorkoutProgramConsolidation(
  userId: string,
  input: unknown,
  authenticatedUserId = userId
): Promise<ConsolidationResult> {
  owner(userId, authenticatedUserId);
  const identity = parse(consolidationIdentitySchema, input);
  if (identity.user_id !== userId)
    fail(404, 'Manifest belongs to another owner.');
  const client: PoolClient = await getClient(userId, authenticatedUserId);
  try {
    await client.query('BEGIN');
    await assertApplicationRole(client);
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`${userId}:${identity.operation_id}`]
    );
    const prior = await client.query<{
      manifest: unknown;
      result: ConsolidationResult;
    }>(
      'SELECT manifest, result FROM workout_program_consolidations WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [identity.operation_id, userId]
    );
    if (prior.rows.length) {
      if (!isDeepStrictEqual(prior.rows[0].manifest, input))
        fail(
          409,
          'Operation identity already records a different explicit manifest.'
        );
      await client.query('COMMIT');
      return { ...prior.rows[0].result, already_applied: true };
    }
    const manifest = parse(consolidationManifestSchema, input);
    await lockScope(client, userId);
    const inventory = await capture(client, userId, true);
    validateManifest(inventory, manifest);
    await allocate(client, 'workout_plan_templates', manifest.target_plan.id);
    // The target is an inactive library container, not a second scheduler.
    // Do not copy the owner-only Program calendar into family-readable plan dates.
    await client.query(
      `INSERT INTO workout_plan_templates(id,user_id,plan_name,description,start_date,end_date,is_active,schedule_type,entry_mode)
      VALUES($1,$2,$3,$4,null,null,false,'sequential','prompt')`,
      [
        manifest.target_plan.id,
        userId,
        manifest.target_plan.name,
        manifest.target_plan.description,
      ]
    );
    await client.query(
      'SET CONSTRAINTS workout_plan_assignment_session_fk DEFERRED'
    );
    for (const mapping of manifest.mapping) {
      if (mapping.mode === 'move') {
        await client.query(
          'UPDATE workout_plan_sessions SET template_id = $1, sort_order = $2, day_of_week = $5 WHERE id = $3 AND user_id = $4',
          [
            manifest.target_plan.id,
            mapping.sort_order,
            mapping.source_session_id,
            userId,
            mapping.target_day_of_week,
          ]
        );
        await client.query(
          'UPDATE workout_plan_template_assignments SET template_id = $1 WHERE workout_session_id = $2 AND user_id = $3',
          [manifest.target_plan.id, mapping.source_session_id, userId]
        );
      } else {
        await client.query(
          `INSERT INTO workout_plan_sessions SELECT (jsonb_populate_record(NULL::workout_plan_sessions,
          to_jsonb(s) || jsonb_build_object('id',$1::text,'template_id',$2::integer,'sort_order',$3::integer,'day_of_week',$6::integer))).*
          FROM workout_plan_sessions s WHERE s.id = $4 AND s.user_id = $5`,
          [
            mapping.target_session_id,
            manifest.target_plan.id,
            mapping.sort_order,
            mapping.source_session_id,
            userId,
            mapping.target_day_of_week,
          ]
        );
        for (const assignment of mapping.assignments) {
          await allocate(
            client,
            'workout_plan_template_assignments',
            assignment.target_assignment_id
          );
          await client.query(
            `INSERT INTO workout_plan_template_assignments SELECT (jsonb_populate_record(NULL::workout_plan_template_assignments,
            to_jsonb(a) || jsonb_build_object('id',$1::integer,'template_id',$2::integer,'workout_session_id',$3::text))).*
            FROM workout_plan_template_assignments a WHERE a.id = $4 AND a.user_id = $5`,
            [
              assignment.target_assignment_id,
              manifest.target_plan.id,
              mapping.target_session_id,
              assignment.source_assignment_id,
              userId,
            ]
          );
          for (const set of assignment.sets) {
            await allocate(
              client,
              'workout_plan_assignment_sets',
              set.target_set_id
            );
            await client.query(
              `INSERT INTO workout_plan_assignment_sets SELECT (jsonb_populate_record(NULL::workout_plan_assignment_sets,
              to_jsonb(s) || jsonb_build_object('id',$1::integer,'assignment_id',$2::integer))).*
              FROM workout_plan_assignment_sets s WHERE s.id = $3 AND s.assignment_id = $4`,
              [
                set.target_set_id,
                assignment.target_assignment_id,
                set.source_set_id,
                assignment.source_assignment_id,
              ]
            );
          }
        }
        await client.query(
          'UPDATE training_program_sessions SET workout_session_id = $1 WHERE id = ANY($2::uuid[]) AND program_id = $3 AND user_id = $4',
          [
            mapping.target_session_id,
            mapping.planned_session_ids,
            manifest.program_id,
            userId,
          ]
        );
      }
    }
    await client.query(
      'SET CONSTRAINTS workout_plan_assignment_session_fk IMMEDIATE'
    );
    for (const planId of manifest.retire_plan_ids) {
      const removed = await client.query(
        'DELETE FROM workout_plan_templates WHERE id = $1 AND user_id = $2 AND NOT EXISTS (SELECT 1 FROM workout_plan_sessions WHERE template_id = $1)',
        [planId, userId]
      );
      if (removed.rowCount !== 1)
        fail(409, 'Source container is no longer safely empty.');
    }
    const result: ConsolidationResult = {
      operation_id: manifest.operation_id,
      target_plan_id: manifest.target_plan.id,
      already_applied: false,
      mapping: manifest.mapping,
    };
    await client.query(
      'INSERT INTO workout_program_consolidations(id,user_id,program_id,target_plan_id,manifest,result) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
      [
        manifest.operation_id,
        userId,
        manifest.program_id,
        manifest.target_plan.id,
        JSON.stringify(manifest),
        JSON.stringify(result),
      ]
    );
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error && typeof error === 'object' && 'status' in error) throw error;
    if (error && typeof error === 'object' && 'code' in error)
      fail(
        409,
        `Consolidation transaction rejected (${String(error.code)}). Replay the same approved operation to recover its journal before preparing any new operation.`
      );
    throw error;
  } finally {
    client.release();
  }
}
