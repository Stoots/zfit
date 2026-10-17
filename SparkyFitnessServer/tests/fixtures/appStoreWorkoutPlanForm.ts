// Unchanged upstream createWorkoutPlanDraft/buildWorkoutPlanPayload from
// SparkyFitnessMobile/src/utils/workoutPlanForm.ts (upstream 5364674f53d6ac7a7a3403f06dcaf98473699438).
import type {
  SaveWorkoutPlanPayload,
  WorkoutPlanDraft,
  WorkoutPlanScheduleType,
  WorkoutPlanTemplate,
} from './appStoreWorkoutPlanTypes.js';

function calendarDay(value: string | null | undefined): string {
  return value?.slice(0, 10) ?? '';
}

export function createWorkoutPlanDraft(
  today: string,
  template?: WorkoutPlanTemplate
): WorkoutPlanDraft {
  if (!template) {
    return {
      planName: '',
      description: '',
      scheduleType: 'weekly',
      entryMode: 'prompt',
      startDate: today,
      endDate: '',
      isActive: true,
      sessionNames: {},
      sessionCount: 1,
      assignments: [],
    };
  }

  const scheduleType: WorkoutPlanScheduleType =
    template.schedule_type === 'sequential' ? 'sequential' : 'weekly';
  const sessionNames: Record<number, string> = {};
  let sessionCount = 1;
  const assignments = (template.assignments ?? []).map((assignment) => {
    const sessionIndex =
      scheduleType === 'sequential' ? (assignment.session_index ?? 1) : null;
    if (sessionIndex !== null) {
      sessionCount = Math.max(sessionCount, sessionIndex);
      if (assignment.session_name && !sessionNames[sessionIndex]) {
        sessionNames[sessionIndex] = assignment.session_name;
      }
    }
    return {
      id: assignment.id,
      key: String(assignment.id),
      day_of_week: scheduleType === 'weekly' ? assignment.day_of_week : null,
      session_index: sessionIndex,
      workout_preset_id: assignment.workout_preset_id
        ? String(assignment.workout_preset_id)
        : null,
      workout_preset_name: assignment.workout_preset_name ?? null,
      exercise_id: assignment.exercise_id ?? null,
      exercise_name: assignment.exercise_name ?? null,
      sets: assignment.sets ?? [],
    };
  });

  return {
    planName: template.plan_name,
    description: template.description ?? '',
    scheduleType,
    entryMode: template.entry_mode === 'prefill' ? 'prefill' : 'prompt',
    startDate: calendarDay(template.start_date),
    endDate: calendarDay(template.end_date),
    isActive: template.is_active,
    sessionNames,
    sessionCount,
    assignments,
  };
}

export function buildWorkoutPlanPayload(
  draft: WorkoutPlanDraft
): SaveWorkoutPlanPayload {
  const sequential = draft.scheduleType === 'sequential';
  const assignments = draft.assignments
    .filter(
      (assignment) => assignment.workout_preset_id || assignment.exercise_id
    )
    .map((assignment) => {
      const sameSlot = draft.assignments.filter((other) =>
        sequential
          ? other.session_index === assignment.session_index
          : other.day_of_week === assignment.day_of_week
      );
      const sessionName = sequential
        ? draft.sessionNames[assignment.session_index ?? 1]?.trim() || null
        : null;
      return {
        ...(assignment.id !== undefined ? { id: assignment.id } : {}),
        day_of_week: sequential ? null : assignment.day_of_week,
        session_index: sequential ? (assignment.session_index ?? 1) : null,
        session_name: sessionName,
        sort_order: sameSlot.indexOf(assignment),
        ...(assignment.workout_preset_id
          ? { workout_preset_id: assignment.workout_preset_id }
          : { exercise_id: assignment.exercise_id as string }),
        sets: assignment.exercise_id
          ? assignment.sets.map(({ id: _id, ...set }) => set)
          : [],
      };
    });

  return {
    plan_name: draft.planName.trim(),
    description: draft.description.trim(),
    start_date: draft.startDate,
    end_date: draft.endDate || null,
    is_active: draft.isActive,
    schedule_type: draft.scheduleType,
    entry_mode: sequential ? 'prompt' : draft.entryMode,
    assignments,
  };
}
