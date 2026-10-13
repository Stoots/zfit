import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  CooperRunAttemptInput,
  CardioTestAttemptInput,
} from '@workspace/shared';
import {
  createCooperRunAttempt,
  getCooperRunAttempts,
  updateCooperRunAttempt,
  getProtocolAttempts,
  saveProtocolAttempt,
} from '@/api/CardioTests/cardioTests';
import { trainingProgramKeys } from '@/api/keys/exercises';

export function cooperRunAttemptsQueryKey(userId: string) {
  return ['cardioTestAttempts', userId, 'cooperRun'] as const;
}

export function usePowerTestAttempts(
  userId: string,
  protocol: 'sprint_6s' | 'power_30s'
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ['cardioTestAttempts', userId, protocol];
  const attempts = useQuery({
    queryKey,
    queryFn: () => getProtocolAttempts(protocol),
  });
  const save = useMutation({
    mutationFn: ({
      input,
      id,
    }: {
      input: CardioTestAttemptInput;
      id?: string;
    }) => saveProtocolAttempt(input, id),
    onSuccess: async () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: trainingProgramKeys.all }),
      ]),
    meta: {
      successMessage: t('cardioTests.saved', 'Test Attempt saved.'),
    },
  });
  return { attempts, save };
}

export function useCooperRunAttempts(userId: string, enabled: boolean) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = cooperRunAttemptsQueryKey(userId);
  const attempts = useQuery({
    queryKey,
    queryFn: getCooperRunAttempts,
    enabled: enabled && userId.length > 0,
  });
  const create = useMutation({
    mutationFn: (input: CooperRunAttemptInput) => createCooperRunAttempt(input),
    onSuccess: async () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: trainingProgramKeys.all }),
      ]),
    meta: {
      successMessage: t('cardioTests.saved', 'Test Attempt saved.'),
    },
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CooperRunAttemptInput }) =>
      updateCooperRunAttempt(id, input),
    onSuccess: async () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: trainingProgramKeys.all }),
      ]),
    meta: {
      successMessage: t('cardioTests.saved', 'Test Attempt saved.'),
    },
  });
  return { attempts, create, update };
}
