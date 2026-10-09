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

export function useTrainingPrograms(
  userId: string,
  enabled: boolean,
  id?: string
) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const key = ['trainingPrograms', userId];
  const programs = useQuery({
    queryKey: [...key, 'list'],
    queryFn: getTrainingPrograms,
    enabled,
  });
  const program = useQuery({
    queryKey: [...key, 'detail', id],
    queryFn: () => getTrainingProgram(id!),
    enabled: enabled && !!id,
  });
  const plans = useQuery({
    queryKey: ['workoutPlanTemplates', 'trainingPrograms', userId],
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
      client.setQueryData([...key, 'detail', saved.id], saved);
      void client.invalidateQueries({ queryKey: key });
    },
    meta: {
      successMessage: t('trainingPrograms.saved', 'Training Program saved.'),
    },
  });
  const remove = useMutation({
    mutationFn: deleteTrainingProgram,
    onSuccess: (_data, programId) => {
      client.removeQueries({ queryKey: [...key, 'detail', programId] });
      void client.invalidateQueries({ queryKey: key });
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
      client.setQueryData([...key, 'detail', saved.id], saved);
      void client.invalidateQueries({ queryKey: key });
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
