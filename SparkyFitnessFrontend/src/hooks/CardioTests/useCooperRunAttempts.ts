import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { CooperRunAttemptInput } from '@workspace/shared';
import {
  createCooperRunAttempt,
  getCooperRunAttempts,
  updateCooperRunAttempt,
} from '@/api/CardioTests/cardioTests';

export function cooperRunAttemptsQueryKey(userId: string) {
  return ['cardioTestAttempts', userId, 'cooperRun'] as const;
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
    onSuccess: async () => queryClient.invalidateQueries({ queryKey }),
    meta: {
      successMessage: t('cardioTests.saved', 'Test Attempt saved.'),
    },
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CooperRunAttemptInput }) =>
      updateCooperRunAttempt(id, input),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey }),
    meta: {
      successMessage: t('cardioTests.saved', 'Test Attempt saved.'),
    },
  });
  return { attempts, create, update };
}
