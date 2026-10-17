import { useEffect, useState } from 'react';
import type { ExerciseEntryResponse } from '@workspace/shared';
import { fetchLastExercisePerformance } from '@/api/Exercises/exerciseEntryService';

export function useLastExercisePerformance(
  exerciseId: string,
  beforeDate: string
) {
  const [previous, setPrevious] = useState<ExerciseEntryResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchLastExercisePerformance(exerciseId, beforeDate, controller.signal)
      .then((entry) => {
        if (!controller.signal.aborted) setPrevious(entry);
      })
      .catch(() => {
        // Optional history must never interrupt logging a workout.
      });
    return () => controller.abort();
  }, [exerciseId, beforeDate]);

  return previous;
}
