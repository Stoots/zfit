import { legacyRpePatch } from '@workspace/shared';
import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/hooks/use-toast';
import { generateClientId } from '@/utils/generateClientId';
import { arrayMove } from '@dnd-kit/sortable';
import type { DragEndEvent } from '@dnd-kit/core';
import type {
  WorkoutPlanTemplate,
  WorkoutPlanDraft,
  WorkoutPlanSession,
  WorkoutPlanAssignment,
  WorkoutPreset,
  WorkoutPresetSet,
} from '@/types/workout';
import type { Exercise } from '@/types/exercises';
import { resolveExerciseModality } from '@workspace/shared';
import { defaultSetForModality } from '@/constants/exercises';

const newSession = (): WorkoutPlanSession => ({
  id: generateClientId(),
  name: 'Session',
  day_of_week: null,
  is_optional: false,
  sort_order: 0,
  assignments: [],
});
const clone = <T,>(value: T): T => structuredClone(value);

export function useWorkoutPlanAssignments(
  initialData?: WorkoutPlanTemplate | null
) {
  const { t } = useTranslation();
  const [scheduleType, setScheduleType] = useState<'weekly' | 'sequential'>(
    initialData?.schedule_type ?? 'sequential'
  );
  const [entryMode, setEntryMode] = useState<'prompt' | 'prefill'>(
    initialData?.entry_mode ?? 'prompt'
  );
  const [sessions, setSessions] = useState<WorkoutPlanSession[]>(() =>
    initialData?.sessions.length
      ? clone(initialData.sessions)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((session) => ({
            ...session,
            assignments: session.assignments.map((a) => ({
              ...a,
              id: a.id ?? generateClientId(),
              workout_session_id: session.id,
              sets: a.sets.map((set) => ({
                ...set,
                id: set.id ?? generateClientId(),
              })),
            })),
          }))
      : [newSession()]
  );
  const assignments = useMemo(
    () => sessions.flatMap((s) => s.assignments),
    [sessions]
  );
  const [copiedAssignment, setCopiedAssignment] =
    useState<WorkoutPlanAssignment | null>(null);
  const [isAddExerciseDialogOpen, setIsAddExerciseDialogOpen] = useState(false);
  const [selectedSessionForAssignment, setSelectedSessionForAssignment] =
    useState<string | null>(null);
  const changeSession = useCallback(
    (
      id: string,
      update: (session: WorkoutPlanSession) => WorkoutPlanSession
    ) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? update(s) : s)));
    },
    []
  );
  const changeAssignment = useCallback(
    (
      index: number,
      update: (a: WorkoutPlanAssignment) => WorkoutPlanAssignment | null
    ) => {
      const target = assignments[index];
      if (!target) return;
      setSessions((prev) =>
        prev.map((s) => ({
          ...s,
          assignments: s.assignments.flatMap((a) => {
            if (a.id !== target.id) return [a];
            const updated = update(a);
            return updated ? [updated] : [];
          }),
        }))
      );
    },
    [assignments]
  );
  const setSessionName = (id: string, name: string) =>
    changeSession(id, (s) => ({ ...s, name }));
  const setSessionDay = (id: string, day: number | null) =>
    changeSession(id, (s) => ({ ...s, day_of_week: day }));
  const setSessionOptional = (id: string, is_optional: boolean) =>
    changeSession(id, (s) => ({ ...s, is_optional }));
  const addSession = () =>
    setSessions((prev) => [
      ...prev,
      {
        ...newSession(),
        name: `Session ${prev.length + 1}`,
        sort_order: prev.length,
      },
    ]);
  const removeSession = (id: string) =>
    setSessions((prev) => prev.filter((s) => s.id !== id));
  const moveSession = (id: string, direction: 'up' | 'down') =>
    setSessions((prev) => {
      const index = prev.findIndex((s) => s.id === id);
      const target = index + (direction === 'up' ? -1 : 1);
      return target < 0 || target >= prev.length
        ? prev
        : arrayMove(prev, index, target);
    });
  const handleRemoveAssignment = (index: number) =>
    changeAssignment(index, () => null);
  const handleSetChangeInPlan = (
    index: number,
    setIndex: number,
    field: keyof WorkoutPresetSet,
    value: WorkoutPresetSet[keyof WorkoutPresetSet]
  ) =>
    changeAssignment(index, (a) => ({
      ...a,
      sets: a.sets.map((s, i) =>
        i === setIndex ? { ...s, ...legacyRpePatch(field), [field]: value } : s
      ),
    }));
  const handleAddSetInPlan = (index: number) =>
    changeAssignment(index, (a) => {
      const last = a.sets.at(-1);
      return {
        ...a,
        sets: [
          ...a.sets,
          {
            ...(last ?? defaultSetForModality(a.modality ?? 'weight_reps')),
            id: generateClientId(),
            set_number: a.sets.length + 1,
          },
        ],
      };
    });
  const handleDuplicateSetInPlan = (index: number, setIndex: number) =>
    changeAssignment(index, (a) => {
      const source = a.sets[setIndex];
      if (!source) return a;
      return {
        ...a,
        sets: [
          ...a.sets.slice(0, setIndex + 1),
          { ...source, id: generateClientId() },
          ...a.sets.slice(setIndex + 1),
        ].map((s, i) => ({ ...s, set_number: i + 1 })),
      };
    });
  const handleRemoveSetInPlan = (index: number, setIndex: number) =>
    changeAssignment(index, (a) => ({
      ...a,
      sets: a.sets
        .filter((_, i) => i !== setIndex)
        .map((s, i) => ({ ...s, set_number: i + 1 })),
    }));
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    // Identity never changes when reordered; dragging stays within one session.
    setSessions((prev) =>
      prev.map((session) => {
        const from = session.assignments.findIndex(
          (a) => String(a.id) === String(active.id)
        );
        const to = session.assignments.findIndex(
          (a) => String(a.id) === String(over.id)
        );
        if (from >= 0 && to >= 0)
          return {
            ...session,
            assignments: arrayMove(session.assignments, from, to),
          };
        return {
          ...session,
          assignments: session.assignments.map((a) => {
            const setFrom = a.sets.findIndex(
              (s) => String(s.id) === String(active.id)
            );
            const setTo = a.sets.findIndex(
              (s) => String(s.id) === String(over.id)
            );
            return setFrom < 0 || setTo < 0
              ? a
              : {
                  ...a,
                  sets: arrayMove(a.sets, setFrom, setTo).map((s, i) => ({
                    ...s,
                    set_number: i + 1,
                  })),
                };
          }),
        };
      })
    );
  };
  const handleAddExerciseOrPreset = (
    item: Exercise | WorkoutPreset,
    sourceMode: 'internal' | 'external' | 'custom' | 'preset',
    targetId = selectedSessionForAssignment
  ) => {
    if (!targetId) return;
    let assignment: WorkoutPlanAssignment;
    if (sourceMode === 'preset') {
      const preset = item as WorkoutPreset;
      assignment = {
        id: generateClientId(),
        workout_session_id: targetId,
        workout_preset_id: String(preset.id),
        workout_preset_name: preset.name,
        preset_snapshot: clone(preset),
        sets: [],
      };
    } else {
      const exercise = item as Exercise;
      const modality = resolveExerciseModality(
        exercise.modality,
        exercise.category
      );
      assignment = {
        id: generateClientId(),
        workout_session_id: targetId,
        exercise_id: exercise.id,
        exercise_name: exercise.name,
        category: exercise.category ?? undefined,
        modality,
        sets: [{ ...defaultSetForModality(modality), id: generateClientId() }],
      };
    }
    changeSession(targetId, (s) => ({
      ...s,
      assignments: [...s.assignments, assignment],
    }));
    setIsAddExerciseDialogOpen(false);
    setSelectedSessionForAssignment(null);
  };
  const handleCopyAssignment = (assignment: WorkoutPlanAssignment) => {
    setCopiedAssignment(clone(assignment));
    toast({ title: t('addWorkoutPlanDialog.copiedToastTitle', 'Copied!') });
  };
  const handlePasteAssignment = (id: string) => {
    if (!copiedAssignment) return;
    const copied = clone(copiedAssignment);
    changeSession(id, (s) => ({
      ...s,
      assignments: [
        ...s.assignments,
        {
          ...copied,
          id: generateClientId(),
          workout_session_id: id,
          sets: copied.sets.map((set) => ({ ...set, id: generateClientId() })),
        },
      ],
    }));
  };
  const handlePresetSnapshotChange = (index: number, snapshot: WorkoutPreset) =>
    changeAssignment(index, (a) => ({
      ...a,
      preset_snapshot: clone(snapshot),
    }));
  const buildSessionsForSave = (): WorkoutPlanDraft['sessions'] => {
    // Only server-loaded sessions carry persisted identities; editor UUIDs stay local.
    const persistedSessionIds = new Set(
      initialData?.sessions.map((session) => session.id)
    );
    return sessions.map((session, index) => ({
      ...session,
      id: persistedSessionIds.has(session.id) ? session.id : undefined,
      name: session.name.trim(),
      sort_order: index,
      day_of_week: scheduleType === 'weekly' ? session.day_of_week : null,
      assignments: session.assignments.map((a, sort_order) => ({
        ...a,
        // UI-only IDs must never be interpreted as existing assignment identities.
        id:
          typeof a.id === 'number' || /^\d+$/.test(String(a.id))
            ? a.id
            : undefined,
        workout_session_id: session.id,
        sort_order,
      })),
    }));
  };
  return {
    sessions,
    assignments,
    setSessionName,
    setSessionDay,
    setSessionOptional,
    addSession,
    removeSession,
    moveSession,
    scheduleType,
    setScheduleType,
    entryMode,
    setEntryMode,
    copiedAssignment,
    isAddExerciseDialogOpen,
    setIsAddExerciseDialogOpen,
    selectedSessionForAssignment,
    setSelectedSessionForAssignment,
    handleRemoveAssignment,
    handleSetChangeInPlan,
    handleAddSetInPlan,
    handleDuplicateSetInPlan,
    handleRemoveSetInPlan,
    handleDragEnd,
    handleAddExerciseOrPreset,
    handleCopyAssignment,
    handlePasteAssignment,
    handlePresetSnapshotChange,
    buildSessionsForSave,
  };
}
