import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchActiveWorkoutPlans,
  fetchWorkoutPlans,
} from '../services/api/workoutPlansApi';
import {
  activeWorkoutPlanQueryKey,
  workoutPlanLibraryQueryKey,
} from './queryKeys';
import { useRefetchOnFocus } from './useRefetchOnFocus';
import { getTodayDate } from '../utils/dateUtils';
import { useTrainingPrograms } from './useTrainingPrograms';
import { getWorkoutPlanCandidates } from '../utils/workoutPlanSchedule';

export function useActiveWorkoutPlans(
  date?: string,
  options?: { enabled?: boolean }
) {
  const { enabled = true } = options ?? {};
  const queryDate = date || getTodayDate();

  const query = useQuery({
    queryKey: activeWorkoutPlanQueryKey(queryDate),
    queryFn: () => fetchActiveWorkoutPlans(queryDate),
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled,
  });

  useRefetchOnFocus(query.refetch, enabled);

  return {
    plans: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/** Reuses the active, library and Program caches without guessing session identity. */
export function useWorkoutPlanCandidates(
  date?: string,
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled ?? true;
  const active = useActiveWorkoutPlans(date, { enabled });
  const library = useQuery({
    queryKey: workoutPlanLibraryQueryKey,
    queryFn: fetchWorkoutPlans,
    staleTime: 1000 * 60 * 5,
    enabled,
  });
  const programs = useTrainingPrograms({ enabled });
  useRefetchOnFocus(library.refetch, enabled);
  const plans = useMemo(
    () =>
      getWorkoutPlanCandidates(
        active.plans,
        library.data ?? [],
        programs.data ?? []
      ),
    [active.plans, library.data, programs.data]
  );
  return {
    plans,
    programs: programs.data,
    isLoading: active.isLoading || library.isLoading || programs.isLoading,
    isError: active.isError || library.isError || programs.isError,
    refetch: async () =>
      Promise.all([active.refetch(), library.refetch(), programs.refetch()]),
  };
}
