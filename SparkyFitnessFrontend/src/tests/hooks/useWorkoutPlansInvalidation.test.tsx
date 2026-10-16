import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useUpdateWorkoutPlanTemplateMutation,
  useDeleteWorkoutPlanTemplateMutation,
} from '@/hooks/Exercises/useWorkoutPlans';
import {
  updateWorkoutPlanTemplate,
  deleteWorkoutPlanTemplate,
} from '@/api/Exercises/workoutPlanTemplates';
import { exerciseEntryKeys } from '@/api/keys/exercises';
import { dailyProgressKeys } from '@/api/keys/diary';

jest.mock('@/api/Exercises/workoutPlanTemplates', () => ({
  updateWorkoutPlanTemplate: jest.fn(),
  deleteWorkoutPlanTemplate: jest.fn(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

it.each(['update', 'delete'] as const)(
  '%s refreshes diary caches after a plan change',
  async (action) => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const spy = jest.spyOn(client, 'invalidateQueries');
    (updateWorkoutPlanTemplate as jest.Mock).mockResolvedValue({});
    (deleteWorkoutPlanTemplate as jest.Mock).mockResolvedValue({});
    if (action === 'update') {
      const { result } = renderHook(
        () => useUpdateWorkoutPlanTemplateMutation(),
        { wrapper }
      );
      result.current.mutate({ id: '1', data: { plan_name: 'Changed' } });
    } else {
      const { result } = renderHook(
        () => useDeleteWorkoutPlanTemplateMutation(),
        { wrapper }
      );
      result.current.mutate('1');
    }
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: exerciseEntryKeys.all })
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: dailyProgressKeys.all });
  }
);
