import { useQuery } from '@tanstack/react-query';
import { fetchTrainingPrograms } from '../services/api/trainingProgramsApi';
import { trainingProgramsQueryKey } from './queryKeys';
import { useRefetchOnFocus } from './useRefetchOnFocus';

export function useTrainingPrograms(options?: { enabled?: boolean }) {
  const query = useQuery({
    queryKey: trainingProgramsQueryKey,
    queryFn: fetchTrainingPrograms,
    staleTime: 1000 * 60 * 5,
    refetchInterval: 60_000,
    enabled: options?.enabled ?? true,
  });
  useRefetchOnFocus(query.refetch, options?.enabled ?? true, 0, true);
  return query;
}
