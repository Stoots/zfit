import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  TrainingProgramInput,
  TrainingProgramOutcomeInput,
} from '@workspace/shared';
import {
  getTrainingPrograms,
  getTrainingProgram,
  saveTrainingProgram,
  deleteTrainingProgram,
  recordTrainingProgramOutcome,
} from '@/api/TrainingPrograms/trainingPrograms';
import { getWorkoutPlanTemplates } from '@/api/Exercises/workoutPlanTemplates';
import { workoutPlanKeys } from '@/hooks/Exercises/useWorkoutPlans';
import { exerciseEntryKeys, trainingProgramKeys } from '@/api/keys/exercises';
import { dailyProgressKeys } from '@/api/keys/diary';

export function useTrainingProgramsList(userId?: string, enabled = true) {
  return useQuery({
    queryKey: trainingProgramKeys.list(userId),
    queryFn: getTrainingPrograms,
    enabled: enabled && !!userId,
  });
}

export function useTrainingPrograms(
  userId: string,
  enabled: boolean,
  id?: string
) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const invalidateDependents = () => {
    void client.invalidateQueries({ queryKey: trainingProgramKeys.all });
    void client.invalidateQueries({ queryKey: workoutPlanKeys.all });
    void client.invalidateQueries({ queryKey: exerciseEntryKeys.all });
    void client.invalidateQueries({ queryKey: dailyProgressKeys.all });
  };
  const programs = useTrainingProgramsList(userId, enabled);
  const program = useQuery({
    queryKey: trainingProgramKeys.detail(userId, id),
    queryFn: () => getTrainingProgram(id!),
    enabled: enabled && !!id,
  });
  const plans = useQuery({
    queryKey: [...workoutPlanKeys.lists(), 'owned', userId],
    queryFn: async () =>
      (await getWorkoutPlanTemplates()).filter(
        (plan) => plan.user_id === userId
      ),
    enabled,
  });
  const save = useMutation({
    mutationFn: ({
      input,
      id: programId,
    }: {
      input: TrainingProgramInput;
      id?: string;
    }) => saveTrainingProgram(input, programId),
    onSuccess: (saved) => {
      client.setQueryData(trainingProgramKeys.detail(userId, saved.id), saved);
      invalidateDependents();
    },
    meta: {
      successMessage: t('trainingPrograms.saved', 'Training Program saved.'),
    },
  });
  const remove = useMutation({
    mutationFn: deleteTrainingProgram,
    onSuccess: (_data, programId) => {
      client.removeQueries({
        queryKey: trainingProgramKeys.detail(userId, programId),
      });
      invalidateDependents();
    },
    meta: {
      successMessage: t(
        'trainingPrograms.deleted',
        'Training Program deleted. Workout Plans were kept.'
      ),
    },
  });
  const outcome = useMutation({
    mutationFn: ({
      programId,
      sessionId,
      input,
    }: {
      programId: string;
      sessionId: string;
      input: TrainingProgramOutcomeInput;
    }) => recordTrainingProgramOutcome(programId, sessionId, input),
    onSuccess: (saved) => {
      client.setQueryData(trainingProgramKeys.detail(userId, saved.id), saved);
      invalidateDependents();
    },
    meta: {
      successMessage: t(
        'trainingPrograms.outcomeSaved',
        'Session outcome recorded.'
      ),
    },
  });
  return { programs, program, plans, save, remove, outcome };
}
