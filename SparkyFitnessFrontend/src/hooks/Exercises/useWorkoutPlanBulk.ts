import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getBulkPrescriptionCandidates,
  previewBulkPrescriptions,
  applyBulkPrescriptions,
  planPayload,
} from '@/api/Exercises/workoutPlanTemplates';
import { workoutPlanKeys } from './useWorkoutPlans';
import { trainingProgramKeys } from '@/api/keys/exercises';
import {
  displaySetRir,
  setEffortField,
  workoutPlanAssignmentInputSchema,
} from '@workspace/shared';
import type { WorkoutPlanDraft } from '@/types/workout';

export function buildBulkSourcePrescription(
  session: WorkoutPlanDraft['sessions'][number],
  assignmentId: number
) {
  const serialized = planPayload({
    sessions: [session],
  }).sessions?.[0]?.assignments.find(
    (assignment) => assignment.id === assignmentId
  );
  const prescription = workoutPlanAssignmentInputSchema.parse(serialized);
  const source = session.assignments.find(
    (assignment) => Number(assignment.id) === assignmentId
  );
  if (prescription.preset_snapshot) {
    for (const exercise of prescription.preset_snapshot.exercises) {
      if (setEffortField(exercise) === 'rir') {
        exercise.sets = exercise.sets.map((set) => ({
          ...set,
          rir: displaySetRir(set),
        }));
      }
    }
  } else if (source && setEffortField(source) === 'rir') {
    prescription.sets = prescription.sets?.map((set) => ({
      ...set,
      rir: displaySetRir(set),
    }));
  }
  return prescription;
}

export function useWorkoutPlanBulk(
  planId: number,
  programId: string | null,
  enabled: boolean
) {
  const client = useQueryClient();
  const candidates = useQuery({
    queryKey: [...workoutPlanKeys.all, 'bulkCandidates', planId, programId],
    queryFn: () => getBulkPrescriptionCandidates(planId, programId),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
  const preview = useMutation({ mutationFn: previewBulkPrescriptions });
  const apply = useMutation({
    mutationFn: applyBulkPrescriptions,
    onSuccess: ({ plan }) => {
      const canonical = { ...plan, id: String(plan.id) };
      client.setQueryData(workoutPlanKeys.detail(canonical.id), canonical);
      client.setQueriesData<Array<{ id: string | number }>>(
        { queryKey: workoutPlanKeys.all },
        (current) =>
          Array.isArray(current)
            ? current.map((item) =>
                String(item.id) === canonical.id ? canonical : item
              )
            : current
      );
      // The diary/dashboard reads the active/library plan and Program queries.
      void client.invalidateQueries({ queryKey: workoutPlanKeys.all });
      void client.invalidateQueries({ queryKey: trainingProgramKeys.all });
    },
  });
  return { candidates, preview, apply };
}
