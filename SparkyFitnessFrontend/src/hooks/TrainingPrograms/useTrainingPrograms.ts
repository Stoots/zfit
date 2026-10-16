import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  TrainingProgram,
  TrainingProgramInput,
  TrainingProgramOutcomeInput,
  TrainingProgramCompletionInput,
} from '@workspace/shared';
import {
  getTrainingPrograms,
  getTrainingProgram,
  saveTrainingProgram,
  deleteTrainingProgram,
  recordTrainingProgramOutcome,
  completeTrainingProgramSession,
} from '@/api/TrainingPrograms/trainingPrograms';
import { getWorkoutPlanTemplates } from '@/api/Exercises/workoutPlanTemplates';
import { workoutPlanKeys } from '@/hooks/Exercises/useWorkoutPlans';
import { exerciseEntryKeys, trainingProgramKeys } from '@/api/keys/exercises';
import { dailyProgressKeys } from '@/api/keys/diary';
import { useDiaryInvalidation } from '@/hooks/useInvalidateKeys';

export function useTrainingProgramsList(userId?: string, enabled = true) {
  return useQuery({
    queryKey: trainingProgramKeys.list(userId),
    queryFn: getTrainingPrograms,
    enabled: enabled && !!userId,
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: 'always',
  });
}

export function useTrainingPrograms(
  userId: string,
  enabled: boolean,
  id?: string
) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const invalidateDiary = useDiaryInvalidation();
  const invalidateDependents = () => {
    void client.invalidateQueries({ queryKey: trainingProgramKeys.all });
    void client.invalidateQueries({ queryKey: workoutPlanKeys.all });
    void client.invalidateQueries({ queryKey: exerciseEntryKeys.all });
    void client.invalidateQueries({ queryKey: dailyProgressKeys.all });
  };
  const updateCompletedProgram = async (
    saved: TrainingProgram,
    sessionId: string
  ) => {
    const listKey = trainingProgramKeys.list(saved.user_id);
    await client.cancelQueries({ queryKey: listKey });
    const reconcile = (cached?: TrainingProgram): TrainingProgram => {
      const sessions = new Map(
        cached?.phases.flatMap((phase) =>
          phase.weeks.flatMap((week) =>
            week.sessions.map((session) => [session.id, session] as const)
          )
        )
      );
      return {
        ...saved,
        phases: saved.phases.map((phase) => ({
          ...phase,
          weeks: phase.weeks.map((week) => ({
            ...week,
            sessions: week.sessions.map((session) => {
              const current = sessions.get(session.id);
              // A delayed response must not reopen another session's outcome.
              return session.id !== sessionId &&
                (session.status === 'planned' ||
                  session.status === 'omitted') &&
                current &&
                current.status !== 'planned'
                ? current
                : session;
            }),
          })),
        })),
      };
    };
    client.setQueryData<TrainingProgram[]>(listKey, (programs) =>
      programs?.map((program) =>
        program.id === saved.id ? reconcile(program) : program
      )
    );
    client.setQueryData<TrainingProgram>(
      trainingProgramKeys.detail(saved.user_id, saved.id),
      reconcile
    );
  };
  const programs = useTrainingProgramsList(userId, enabled);
  const program = useQuery({
    queryKey: trainingProgramKeys.detail(userId, id),
    queryFn: () => getTrainingProgram(id!),
    enabled: enabled && !!id,
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: 'always',
  });
  const plans = useQuery({
    queryKey: [...workoutPlanKeys.lists(), 'owned', userId],
    queryFn: async () =>
      (await getWorkoutPlanTemplates()).filter(
        (plan) => plan.user_id === userId
      ),
    enabled,
    refetchOnWindowFocus: 'always',
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
    onSuccess: async (saved, { sessionId }) => {
      await updateCompletedProgram(saved, sessionId);
      invalidateDependents();
    },
    meta: {
      successMessage: t(
        'trainingPrograms.outcomeSaved',
        'Session outcome recorded.'
      ),
    },
  });
  const complete = useMutation({
    mutationFn: ({
      programId,
      sessionId,
      input,
    }: {
      programId: string;
      sessionId: string;
      input: TrainingProgramCompletionInput;
    }) => completeTrainingProgramSession(programId, sessionId, input),
    onSuccess: async (saved, { sessionId }) => {
      await updateCompletedProgram(saved, sessionId);
      invalidateDependents();
      invalidateDiary();
    },
    meta: {
      successMessage: t(
        'trainingPrograms.outcomeSaved',
        'Session outcome recorded.'
      ),
    },
  });
  return { programs, program, plans, save, remove, outcome, complete };
}
