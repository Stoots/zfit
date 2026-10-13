import { renderHook, waitFor } from '@testing-library/react-native';
import { useActiveWorkoutPlans } from '../../src/hooks/useActiveWorkoutPlan';
import { fetchActiveWorkoutPlans } from '../../src/services/api/workoutPlansApi';
import {
  createTestQueryClient,
  createQueryWrapper,
  type QueryClient,
} from './queryTestUtils';

jest.mock('../../src/services/api/workoutPlansApi', () => ({
  fetchActiveWorkoutPlans: jest.fn(),
}));

jest.mock('../../src/hooks/useRefetchOnFocus', () => ({
  useRefetchOnFocus: jest.fn(),
}));

const mockFetchActivePlans = fetchActiveWorkoutPlans as jest.MockedFunction<
  typeof fetchActiveWorkoutPlans
>;

describe('useActiveWorkoutPlans', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('offers no plans while loading', () => {
    mockFetchActivePlans.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useActiveWorkoutPlans('2026-09-21'), {
      wrapper: createQueryWrapper(queryClient),
    });

    expect(result.current.plans).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it('does not fetch when enabled is false', () => {
    const { result } = renderHook(
      () => useActiveWorkoutPlans('2026-09-21', { enabled: false }),
      {
        wrapper: createQueryWrapper(queryClient),
      }
    );

    expect(mockFetchActivePlans).not.toHaveBeenCalled();
    expect(result.current.plans).toEqual([]);
  });

  it('sets isError on failure', async () => {
    mockFetchActivePlans.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useActiveWorkoutPlans('2026-09-21'), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
