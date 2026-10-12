import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CooperRunAttemptInput } from '@workspace/shared';
import {
  createCooperRunAttempt,
  fetchCooperRunAttempts,
  updateCooperRunAttempt,
} from '../services/api/cardioTestsApi';
import { useRefetchOnFocus } from './useRefetchOnFocus';
import { cooperRunAttemptsQueryKey } from './queryKeys';

export function useCooperRunAttempts(enabled = true) {
  const queryClient = useQueryClient();
  const attempts = useQuery({
    queryKey: cooperRunAttemptsQueryKey,
    queryFn: fetchCooperRunAttempts,
    enabled,
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: cooperRunAttemptsQueryKey });
  const create = useMutation({
    mutationFn: (input: CooperRunAttemptInput) => createCooperRunAttempt(input),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CooperRunAttemptInput }) =>
      updateCooperRunAttempt(id, input),
    onSuccess: invalidate,
  });
  useRefetchOnFocus(attempts.refetch, enabled);
  return { attempts, create, update };
}
