import { useQuery } from '@tanstack/react-query';
import { fetchTrainingPrograms } from '../services/api/trainingProgramsApi';
import { trainingProgramsQueryKey } from './queryKeys';
import { useRefetchOnFocus } from './useRefetchOnFocus';

export function useTrainingPrograms() {
  const query = useQuery({
    queryKey: trainingProgramsQueryKey,
    queryFn: fetchTrainingPrograms,
    staleTime: 1000 * 60 * 5,
  });
  useRefetchOnFocus(query.refetch);
  return query;
}
