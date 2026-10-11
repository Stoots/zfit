import { tool } from 'ai';
import { z } from 'zod';
import { todayInZone, workoutPlanCreateRequestSchema } from '@workspace/shared';
import { log } from '../../config/logging.js';
import workoutPlanTemplateService from '../../services/workoutPlanTemplateService.js';
import workoutPresetRepository from '../../models/workoutPresetRepository.js';
import type { WorkoutPlanSessionInput } from '@workspace/shared';
import { ERRORS, formatZodError } from './errors.js';
import { findExerciseByExactName } from './exerciseLookup.js';
import { formatConfirmation, formatList } from './formatting.js';
import {
  manageWorkoutPlansSchema,
  manageWorkoutPlansInput,
  WORKOUT_PLAN_ACTIONS,
  type ManageWorkoutPlansInput,
  type WorkoutPlanSessionItemInput,
  workoutPlanSessionItemSchema,
} from './schemas/workoutPlans.js';
import { normalizeActionArgs } from './dates.js';

const VALID_ACTIONS = [...WORKOUT_PLAN_ACTIONS];

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

interface WorkoutPlanAssignmentRow {
  id: number | string;
  workout_session_id?: string;
  workout_preset_id?: number | null;
  preset_snapshot?: {
    id: number;
    name: string;
    description: string | null;
    workout_format: string;
    exercises: { exercise_name: string; sets: unknown[] }[];
  } | null;
  exercise_id?: string | null;
  exercise_name?: string | null;
  sets?: unknown[] | null;
}

interface WorkoutPlanSessionRow {
  id: string;
  name: string;
  day_of_week: number | null;
  sort_order: number;
  assignments: WorkoutPlanAssignmentRow[];
}

interface WorkoutPlanTemplateRow {
  id: string | number;
  plan_name: string;
  description?: string | null;
  is_active?: boolean;
  schedule_type?: 'weekly' | 'sequential' | null;
  entry_mode?: 'prompt' | 'prefill' | null;
  sessions?: WorkoutPlanSessionRow[];
  next_session?: WorkoutPlanSessionRow | null;
  next_assignments?: WorkoutPlanAssignmentRow[];
  start_date?: string | null;
  end_date?: string | null;
  sequence_position?: {
    current: number;
    total: number;
  } | null;
}

function planMutationConfirmPrompt(
  confirmed: boolean | undefined,
  action: 'update' | 'delete',
  planId: number
): string | null {
  if (confirmed === true) return null;
  if (action === 'delete') {
    return `Deleting workout plan ${planId} is permanent. Confirm with the user first. If they agree, call delete_workout_plan again with plan_id=${planId} and confirmed=true. Nothing was deleted.`;
  }
  return `Updating workout plan ${planId} can change session prescriptions. Confirm with the user first. If they agree, call update_workout_plan again with the same fields and confirmed=true. Call get_workout_plan with plan_id=${planId} first; retain session IDs, assignment IDs and frozen snapshots for unchanged prescriptions. Nothing was changed.`;
}

function formatPlanAssignmentLine(a: WorkoutPlanAssignmentRow): string {
  const item = a.preset_snapshot?.name ?? a.exercise_name ?? 'Unknown item';
  const format = a.preset_snapshot?.workout_format;
  const formatSuffix = format && format !== 'standard' ? `, ${format}` : '';
  const isPreset = Boolean(a.preset_snapshot || a.workout_preset_id);
  const typeSuffix = isPreset ? ` (preset${formatSuffix})` : '';
  const setCount = a.preset_snapshot
    ? a.preset_snapshot.exercises.reduce(
        (count, exercise) => count + exercise.sets.length,
        0
      )
    : (a.sets?.length ?? 0);
  const setsSuffix =
    setCount > 0 ? ` — ${setCount} set${setCount === 1 ? '' : 's'}` : '';
  return `${item}${typeSuffix}${setsSuffix}`;
}

async function resolvePlanSessions(
  userId: string,
  rawSessions: WorkoutPlanSessionItemInput[],
  scheduleType: 'sequential' | 'weekly'
): Promise<WorkoutPlanSessionInput[]> {
  const sessions: WorkoutPlanSessionInput[] = [];
  for (const [sessionPosition, session] of rawSessions.entries()) {
    if (scheduleType === 'weekly' && session.day_of_week === null) {
      throw new Error(
        `Weekly session "${session.name}" requires day_of_week (0-6).`
      );
    }
    const assignments: WorkoutPlanSessionInput['assignments'] = [];
    for (const [position, item] of session.assignments.entries()) {
      let presetId = item.workout_preset_id ?? null;
      let exerciseId = item.exercise_id ?? null;
      let snapshot = item.preset_snapshot;
      if (item.preset_name && !presetId && !snapshot) {
        const preset = await workoutPresetRepository.getWorkoutPresetByName(
          userId,
          item.preset_name
        );
        if (!preset)
          throw new Error(`Preset with name "${item.preset_name}" not found.`);
        presetId = preset.id;
      }
      if (item.exercise_name && !exerciseId) {
        const exercise = await findExerciseByExactName(
          userId,
          item.exercise_name
        );
        if (!exercise)
          throw new Error(
            `Exercise with name "${item.exercise_name}" not found. Search exercises for the exact name or ID.`
          );
        exerciseId = String(exercise.id);
      }
      if (Boolean(presetId || snapshot) === Boolean(exerciseId)) {
        throw new Error(
          `Assignment ${position + 1} in "${session.name}" must specify exactly one preset or exercise.`
        );
      }
      if (item.workout_session_id && item.workout_session_id !== session.id) {
        throw new Error(
          'Assignment workout_session_id must match its containing session.'
        );
      }
      if (presetId && !snapshot) {
        if (item.id)
          throw new Error(
            'Existing preset assignments must retain their frozen preset_snapshot when editing.'
          );
        const preset = await workoutPresetRepository.getWorkoutPresetById(
          presetId,
          userId
        );
        if (!preset)
          throw new Error(`Workout Preset with ID ${presetId} not found.`);
        snapshot = {
          id: preset.id,
          name: preset.name,
          description: preset.description ?? null,
          workout_format: preset.workout_format ?? 'standard',
          ...(preset.time_cap_seconds === undefined
            ? {}
            : { time_cap_seconds: preset.time_cap_seconds }),
          exercises: structuredClone(preset.exercises),
        };
      }
      if (presetId && snapshot && snapshot.id !== presetId) {
        throw new Error('preset_snapshot.id must match workout_preset_id.');
      }
      if (exerciseId && snapshot)
        throw new Error('Exercise assignments cannot carry preset_snapshot.');
      assignments.push({
        ...(item.id === undefined ? {} : { id: item.id }),
        workout_preset_id: presetId,
        exercise_id: exerciseId,
        sort_order: item.sort_order ?? position,
        sets: item.sets?.map((set, index) => ({
          ...set,
          set_number: set.set_number ?? index + 1,
          set_type: set.set_type === undefined ? 'Working Set' : set.set_type,
          reps: set.reps ?? null,
          weight: set.weight ?? null,
          duration: set.duration ?? null,
          distance: set.distance ?? null,
          rest_time: set.rest_time ?? null,
          notes: set.notes ?? null,
        })),
        ...(snapshot ? { preset_snapshot: snapshot } : {}),
      });
    }
    sessions.push({
      ...(session.id === undefined ? {} : { id: session.id }),
      name: session.name,
      day_of_week: session.day_of_week,
      sort_order: session.sort_order ?? sessionPosition,
      assignments,
    });
  }
  const validated = workoutPlanCreateRequestSchema.safeParse({
    plan_name: 'Session prescription',
    schedule_type: scheduleType,
    sessions,
  });
  if (!validated.success) {
    throw new Error(
      validated.error.issues.map((issue) => issue.message).join('; ')
    );
  }
  return validated.data.sessions;
}

// `sessions` arrives as an array or a JSON string. A JSON string skips the
// published schema, so every item is validated here either way.
function parseSessionsInput(
  raw: string | WorkoutPlanSessionItemInput[] | undefined
):
  | { ok: true; sessions: WorkoutPlanSessionItemInput[] | undefined }
  | {
      ok: false;
      error: string;
    } {
  if (raw === undefined) return { ok: true, sessions: undefined };
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        error: ERRORS.VALIDATION('Invalid JSON format for sessions'),
      };
    }
  }
  const result = z.array(workoutPlanSessionItemSchema).safeParse(value);
  if (!result.success) {
    return { ok: false, error: formatZodError(result.error) };
  }
  return { ok: true, sessions: result.data };
}

// Service-side assignment validation errors (unknown preset/exercise ID,
// missing weekday) are input problems, not a missing plan.
function isAssignmentValidationError(message: string): boolean {
  return (
    message.startsWith('Workout Preset with ID') ||
    message.startsWith('Exercise with ID') ||
    message.includes('Changing schedule_type requires') ||
    message.includes('Weekly workout plan sessions must have')
  );
}

export function buildWorkoutPlanTools(userId: string, tz: string) {
  return {
    sparky_manage_workout_plans: tool({
      description: `Workout plan templates: list, inspect, create, update, delete workout plans, or check active plan progression.

This tool takes a FLAT object with an "action" field. Do NOT nest fields under the action name.

Workout plans support two schedule types:
1. "sequential" (DEFAULT) — Sessions are ordered (Session 1 -> Session 2 -> ... -> Session N -> wraps). Missed days do NOT skip sessions; the next incomplete session is always ready. Ideal for PPL, Upper/Lower, or full-body cycles.
2. "weekly" — Tied to specific weekdays (Mon, Wed, Fri). Missed weekdays are skipped.

Actions:
- action: 'list_workout_plans' — returns every saved workout plan template (name, active state, mode, session/day count, ID)
- action: 'get_workout_plan' (fields: plan_id) — returns one plan with its full session/day assignments
- action: 'get_active_workout_plan' (fields: date?) — returns the user's active workout plan progression and upcoming session/assignments for today or the specified date
- action: 'create_workout_plan' (fields: plan_name, schedule_type?, is_active?, description?, start_date?, end_date?, sessions) — creates a plan. sessions is [{name,day_of_week:null|0..6,sort_order?,assignments:[{preset_name/workout_preset_id OR exercise_name/exercise_id,sets?}]}]. Every array entry is an independent session, even with repeated names. New preset assignments snapshot their complete prescriptions at authoring.
- action: 'update_workout_plan' (fields: plan_id, confirmed, plan_name?, schedule_type?, is_active?, description?, start_date?, end_date?, sessions?) — confirmed=true required. Supply nested sessions retaining existing session/assignment IDs and preset_snapshot. Edit only the intended session prescription; do not refresh frozen presets from the library. Omit sessions for metadata-only edits.
- action: 'delete_workout_plan' (fields: plan_id, confirmed) — permanently deletes the plan with the given ID. confirmed=true required.`,
      inputSchema: manageWorkoutPlansInput,
      execute: async (rawArgs) => {
        const normalized = normalizeActionArgs(
          rawArgs,
          tz,
          VALID_ACTIONS,
          () => 'list_workout_plans'
        );
        const parsed = manageWorkoutPlansSchema.safeParse(normalized);
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        const args: ManageWorkoutPlansInput = parsed.data;
        try {
          switch (args.action) {
            case 'list_workout_plans': {
              const rows =
                (await workoutPlanTemplateService.getWorkoutPlanTemplatesByUserId(
                  userId
                )) as unknown as WorkoutPlanTemplateRow[];
              return formatList(rows, 'Workout Plans', (row) => {
                const state = row.is_active ? 'active' : 'inactive';
                const count = row.sessions?.length ?? 0;
                return `**${row.plan_name}** (${state}, ${row.schedule_type}, ${count} session${count === 1 ? '' : 's'})\n  ID: ${row.id}`;
              });
            }

            case 'get_workout_plan': {
              const plan =
                (await workoutPlanTemplateService.getWorkoutPlanTemplateById(
                  userId,
                  args.plan_id
                )) as unknown as WorkoutPlanTemplateRow;
              const sessions = plan.sessions ?? [];
              const lines = [
                `# Workout Plan: ${plan.plan_name} (${plan.schedule_type === 'sequential' ? 'Sequential' : 'Weekly'})\n`,
              ];
              if (!sessions.length)
                return `${lines[0]}\n_No sessions in this plan._`;
              for (const session of [...sessions].sort(
                (a, b) => a.sort_order - b.sort_order
              )) {
                const day =
                  session.day_of_week === null
                    ? ''
                    : ` — ${DAY_NAMES[session.day_of_week]}`;
                lines.push(
                  `Session ${session.sort_order + 1} — ${session.name}${day} (ID: ${session.id}):`
                );
                session.assignments.forEach((assignment, index) => {
                  lines.push(
                    `  ${index + 1}. ${formatPlanAssignmentLine(assignment)}`
                  );
                });
                lines.push('');
              }
              return lines.join('\n').trim();
            }

            case 'get_active_workout_plan': {
              const targetDate = args.date || todayInZone(tz);
              const plans =
                (await workoutPlanTemplateService.getActiveWorkoutPlanForDate(
                  userId,
                  targetDate
                )) as unknown as WorkoutPlanTemplateRow[];
              if (!plans || plans.length === 0) {
                return `No active workout plan found for ${targetDate}.`;
              }
              const lines: string[] = [];
              for (const plan of plans) {
                const isSequential = plan.schedule_type === 'sequential';
                if (isSequential) {
                  const pos = plan.sequence_position;
                  const posStr = pos
                    ? `Session ${pos.current} of ${pos.total}${plan.next_session ? ' — ' + plan.next_session.name : ''}`
                    : 'Next session';
                  lines.push(
                    `# Active Plan: **${plan.plan_name}** (Sequential)`
                  );
                  lines.push(`Next up: ${posStr}`);
                  const nextList = plan.next_assignments ?? [];
                  if (nextList.length > 0) {
                    lines.push('\n**Assignments in this session:**');
                    nextList.forEach((a, idx) => {
                      lines.push(`${idx + 1}. ${formatPlanAssignmentLine(a)}`);
                    });
                  } else {
                    lines.push('\n_No assignments remaining in this cycle._');
                  }
                } else {
                  // The repository already selects this date's weekday
                  // assignments into next_assignments.
                  const dayAssignments = plan.next_assignments ?? [];
                  const dayOfWeek =
                    plan.next_session?.day_of_week ??
                    new Date(`${targetDate}T12:00:00Z`).getUTCDay();
                  const dayName = DAY_NAMES[dayOfWeek] ?? `Day ${dayOfWeek}`;
                  lines.push(`# Active Plan: **${plan.plan_name}** (Weekly)`);
                  if (dayAssignments.length > 0) {
                    lines.push(`\n**Session for ${dayName} (${targetDate}):**`);
                    dayAssignments.forEach((a, idx) => {
                      lines.push(`${idx + 1}. ${formatPlanAssignmentLine(a)}`);
                    });
                  } else {
                    lines.push(
                      `\nRest day: nothing scheduled for ${dayName} (${targetDate}).`
                    );
                  }
                }
              }
              return lines.join('\n');
            }

            case 'create_workout_plan': {
              const sessionsResult = parseSessionsInput(args.sessions);
              if (!sessionsResult.ok) return sessionsResult.error;
              const parsedSessions = sessionsResult.sessions ?? [];

              const scheduleType = args.schedule_type || 'sequential';
              let entryMode = args.entry_mode;
              let notice = '';
              if (scheduleType === 'sequential') {
                if (entryMode === 'prefill') {
                  notice =
                    ' Note: Sequential plans only support "prompt" entry mode (coerced to prompt).';
                }
                entryMode = 'prompt';
              }

              let resolvedSessions: WorkoutPlanSessionInput[] = [];
              if (parsedSessions.length > 0) {
                try {
                  resolvedSessions = await resolvePlanSessions(
                    userId,
                    parsedSessions,
                    scheduleType
                  );
                } catch (err) {
                  return ERRORS.VALIDATION(
                    err instanceof Error ? err.message : String(err)
                  );
                }
              }

              const created =
                await workoutPlanTemplateService.createWorkoutPlanTemplate(
                  userId,
                  {
                    plan_name: args.plan_name,
                    description: args.description,
                    schedule_type: scheduleType,
                    entry_mode: entryMode,
                    is_active: args.is_active ?? false,
                    start_date: args.start_date,
                    end_date: args.end_date,
                    sessions: resolvedSessions,
                    currentClientDate: todayInZone(tz),
                  }
                );

              return formatConfirmation(
                `Workout plan "${created.plan_name}" created (ID: ${created.id}, ${scheduleType}, ${resolvedSessions.length} session${resolvedSessions.length === 1 ? '' : 's'}).${notice}`
              );
            }

            case 'update_workout_plan': {
              const blocked = planMutationConfirmPrompt(
                args.confirmed,
                'update',
                args.plan_id
              );
              if (blocked) return blocked;

              const sessionsResult = parseSessionsInput(args.sessions);
              if (!sessionsResult.ok) return sessionsResult.error;
              const parsedSessions = sessionsResult.sessions;

              // Always load the plan: the effective schedule type decides how
              // sessions resolve and whether entry_mode is forced to prompt.
              // Guessing 'sequential' here would flip a weekly prefill plan to
              // prompt on an unrelated edit (e.g. renaming it).
              const existing =
                (await workoutPlanTemplateService.getWorkoutPlanTemplateById(
                  userId,
                  args.plan_id
                )) as unknown as WorkoutPlanTemplateRow;

              const targetScheduleType =
                args.schedule_type ?? existing.schedule_type ?? 'weekly';

              let resolvedSessions: WorkoutPlanSessionInput[] | undefined;
              if (parsedSessions !== undefined) {
                try {
                  resolvedSessions = await resolvePlanSessions(
                    userId,
                    parsedSessions,
                    targetScheduleType
                  );
                } catch (err) {
                  return ERRORS.VALIDATION(
                    err instanceof Error ? err.message : String(err)
                  );
                }
              }

              let entryMode = args.entry_mode;
              let notice = '';
              if (targetScheduleType === 'sequential' && entryMode) {
                if (entryMode === 'prefill') {
                  notice =
                    ' Note: Sequential plans only support "prompt" entry mode (coerced to prompt).';
                }
                entryMode = 'prompt';
              }

              const updated =
                await workoutPlanTemplateService.updateWorkoutPlanTemplate(
                  userId,
                  args.plan_id,
                  {
                    plan_name: args.plan_name ?? existing.plan_name,
                    description:
                      args.description !== undefined
                        ? args.description
                        : (existing.description ?? null),
                    schedule_type:
                      args.schedule_type ?? existing.schedule_type ?? undefined,
                    entry_mode: entryMode ?? existing.entry_mode ?? undefined,
                    is_active: args.is_active ?? existing.is_active ?? false,
                    start_date:
                      args.start_date !== undefined
                        ? args.start_date
                        : (existing.start_date ?? null),
                    end_date:
                      args.end_date !== undefined
                        ? args.end_date
                        : (existing.end_date ?? null),
                    sessions: resolvedSessions,
                    currentClientDate: todayInZone(tz),
                  }
                );

              return formatConfirmation(
                `Workout plan "${updated.plan_name}" updated.${notice}`
              );
            }

            case 'delete_workout_plan': {
              const blocked = planMutationConfirmPrompt(
                args.confirmed,
                'delete',
                args.plan_id
              );
              if (blocked) return blocked;

              await workoutPlanTemplateService.deleteWorkoutPlanTemplate(
                userId,
                args.plan_id
              );
              return formatConfirmation('Workout plan deleted.');
            }

            default:
              return ERRORS.INVALID_ACTION(
                String((args as ManageWorkoutPlansInput).action),
                VALID_ACTIONS
              );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          if (
            (error instanceof Error &&
              'status' in error &&
              (error.status === 400 || error.status === 409)) ||
            isAssignmentValidationError(message)
          ) {
            return ERRORS.VALIDATION(message);
          }
          if (message.includes('not found')) {
            return ERRORS.NOT_FOUND(
              'Workout plan',
              'plan_id' in args ? String(args.plan_id) : ''
            );
          }
          log('error', '[Workout Plan Tool] Error:', error);
          return ERRORS.DB_ERROR(error);
        }
      },
    }),
  };
}
