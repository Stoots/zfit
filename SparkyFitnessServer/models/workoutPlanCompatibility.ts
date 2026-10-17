import type { PoolClient } from 'pg';
import {
  workoutPlanPresetSnapshotSchema,
  type WorkoutPlanSessionInput,
  type WorkoutPlanSessionResponse,
  type WorkoutPlanPresetSnapshot,
} from '@workspace/shared';
import type { LegacyPlanAssignments } from '../schemas/workoutPlanCompatibility.js';
import { HttpError } from '../utils/errors.js';

export async function legacyPlanSessions(
  client: PoolClient,
  assignments: LegacyPlanAssignments,
  scheduleType: 'weekly' | 'sequential',
  previous: WorkoutPlanSessionResponse[] = []
): Promise<WorkoutPlanSessionInput[]> {
  if (
    previous.some((session) =>
      session.assignments.some(
        (assignment) =>
          !assignment.workout_preset_id &&
          !assignment.exercise_id &&
          assignment.preset_snapshot
      )
    )
  )
    throw new HttpError(
      'This plan has detached frozen assignments that the App Store editor cannot represent. Edit it on the web.',
      409
    );
  if (previous.some((session) => session.assignments.length === 0))
    throw new HttpError(
      'This plan has empty sessions that the App Store editor cannot represent. Edit it on the web.',
      409
    );
  if (
    scheduleType === 'weekly' &&
    new Set(previous.map((session) => session.day_of_week)).size !==
      previous.length
  )
    throw new HttpError(
      'Multiple sessions on one weekday cannot be edited with flat assignments. Edit this plan on the web.',
      409
    );
  if (
    scheduleType === 'weekly' &&
    previous.some((session) => session.day_of_week === null)
  )
    throw new HttpError(
      'Unscheduled weekly sessions cannot be edited with flat assignments. Edit this plan on the web.',
      409
    );
  const sessions = new Map<number, WorkoutPlanSessionInput>();
  for (const assignment of assignments) {
    const slot =
      scheduleType === 'weekly'
        ? assignment.day_of_week
        : assignment.session_index;
    if (
      slot === null ||
      (scheduleType === 'weekly'
        ? assignment.session_index !== null
        : assignment.day_of_week !== null)
    )
      throw new HttpError(
        'Assignments must specify a weekday or sequential session index matching the schedule.',
        400
      );
    const oldById =
      assignment.id === undefined
        ? undefined
        : previous.find((session) =>
            session.assignments.some((row) => row.id === assignment.id)
          );
    if (assignment.id !== undefined && !oldById)
      throw new HttpError('Assignment ID does not belong to this plan.', 400);
    const oldSession =
      oldById ??
      previous.find((session, index) =>
        scheduleType === 'weekly'
          ? session.day_of_week === slot
          : index + 1 === slot
      );
    const oldAssignment = oldById?.assignments.find(
      (row) => row.id === assignment.id
    );
    let session = sessions.get(slot);
    const name =
      assignment.session_name ??
      oldSession?.name ??
      `Session ${slot + (scheduleType === 'weekly' ? 1 : 0)}`;
    if (!session) {
      session = {
        id: oldSession?.id,
        name,
        day_of_week: scheduleType === 'weekly' ? slot : null,
        sort_order: slot,
        is_optional: oldSession?.is_optional ?? false,
        assignments: [],
      };
      sessions.set(slot, session);
    } else if (session.id !== oldSession?.id || session.name !== name) {
      throw new HttpError('Conflicting names for one legacy session.', 400);
    }
    let snapshot: WorkoutPlanPresetSnapshot | undefined =
      oldAssignment?.workout_preset_id === assignment.workout_preset_id
        ? (oldAssignment?.preset_snapshot ?? undefined)
        : undefined;
    if (assignment.workout_preset_id && !snapshot) {
      const result = await client.query<{ snapshot: unknown }>(
        `SELECT jsonb_build_object('id', wp.id, 'name', wp.name, 'description', wp.description,
          'workout_format', wp.workout_format, 'time_cap_seconds', wp.time_cap_seconds,
          'exercises', COALESCE((SELECT jsonb_agg(
            (to_jsonb(wpe) - 'workout_preset_id' - 'created_at' - 'updated_at') ||
            jsonb_build_object('exercise_name', e.name, 'category', e.category, 'modality', e.modality,
              'sets', COALESCE((SELECT jsonb_agg(to_jsonb(ps) - 'workout_preset_exercise_id' - 'created_at' - 'updated_at' ORDER BY ps.set_number, ps.id)
                FROM workout_preset_exercise_sets ps WHERE ps.workout_preset_exercise_id = wpe.id), '[]'::jsonb))
            ORDER BY wpe.sort_order, wpe.id)
            FROM workout_preset_exercises wpe JOIN exercises e ON e.id = wpe.exercise_id
            WHERE wpe.workout_preset_id = wp.id), '[]'::jsonb)) AS snapshot
          FROM workout_presets wp WHERE wp.id = $1 FOR SHARE`,
        [assignment.workout_preset_id]
      );
      if (!result.rowCount)
        throw new HttpError('Workout preset not found or not accessible.', 400);
      snapshot = workoutPlanPresetSnapshotSchema.parse(
        result.rows[0]!.snapshot
      );
    }
    session.assignments.push({
      id: assignment.id,
      exercise_id: assignment.exercise_id,
      workout_preset_id: assignment.workout_preset_id,
      sort_order: assignment.sort_order,
      sets: assignment.sets?.map((set) => ({
        ...(oldAssignment?.exercise_id === assignment.exercise_id
          ? oldAssignment?.sets.find((old) => old.set_number === set.set_number)
          : undefined),
        ...set,
      })),
      ...(snapshot ? { preset_snapshot: snapshot } : {}),
    });
  }
  const retainedIds = [...sessions.values()].flatMap((session) =>
    session.id ? [session.id] : []
  );
  if (new Set(retainedIds).size !== retainedIds.length)
    throw new HttpError(
      'A canonical session cannot be split across legacy slots. Edit this plan on the web.',
      409
    );
  return [...sessions.values()].sort((a, b) => a.sort_order - b.sort_order);
}
