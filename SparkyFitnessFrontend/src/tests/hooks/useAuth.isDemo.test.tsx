import {
  createWorkoutPlaybackDraftFromExercise,
  saveWorkoutPlaybackDraftToStorage,
  loadWorkoutPlaybackDraftFromStorage,
} from '@/utils/workoutPlayback';
import type { Exercise } from '@/types/exercises';
import { act, renderHook, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { fetchIdentityUser } from '@/api/Auth/auth';
import { apiCall } from '@/api/api';

let sessionState: { data: unknown; isPending: boolean } = {
  data: null,
  isPending: false,
};

jest.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => sessionState,
    signOut: jest.fn(),
    getSession: jest.fn(),
  },
}));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ clear: jest.fn() }),
}));
jest.mock('@/api/Auth/auth', () => ({
  fetchIdentityUser: jest.fn(),
  switchUserContext: jest.fn(),
}));
jest.mock('@/api/api', () => ({
  apiCall: jest.fn().mockResolvedValue({}),
  clearDemoRestrictions: jest.fn(),
}));

const mockFetchIdentityUser = jest.mocked(fetchIdentityUser);
const mockApiCall = jest.mocked(apiCall);

const renderProvider = () =>
  renderHook(() => useAuth(), { wrapper: AuthProvider });

describe('AuthProvider demo status resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiCall.mockResolvedValue({});
    sessionState = { data: null, isPending: false };
    mockFetchIdentityUser.mockResolvedValue({
      activeUserId: 'u1',
      activeUserEmail: 'real@example.com',
      activeUserFullName: 'Real User',
      fullName: 'Real User',
      isDemo: false,
    });
  });

  it('clears every acting-profile draft for the account on sign-out', async () => {
    const { result } = renderProvider();
    act(() =>
      result.current.signIn('u1', 'family', 'real@example.com', 'user', false)
    );
    const draft = createWorkoutPlaybackDraftFromExercise(
      { id: 'ex1', name: 'Walk' } as Exercise,
      '2026-04-27'
    );
    const own = { userId: 'u1', activeUserId: 'u1' };
    const family = { userId: 'u1', activeUserId: 'family' };
    const other = { userId: 'u2', activeUserId: 'u2' };
    const legacyKey = 'sparky.workoutPlaybackDraft.v1:2026-04-27';
    const legacyRaw = JSON.stringify(draft);
    window.localStorage.setItem(legacyKey, legacyRaw);
    saveWorkoutPlaybackDraftToStorage(draft, own);
    saveWorkoutPlaybackDraftToStorage(draft, family);
    saveWorkoutPlaybackDraftToStorage(draft, other);
    await act(() => result.current.signOut());
    expect(window.localStorage.getItem(legacyKey)).toBe(legacyRaw);
    expect(loadWorkoutPlaybackDraftFromStorage('2026-04-27', own)).toBeNull();
    expect(
      loadWorkoutPlaybackDraftFromStorage('2026-04-27', family)
    ).toBeNull();
    expect(
      loadWorkoutPlaybackDraftFromStorage('2026-04-27', other)
    ).not.toBeNull();
  });

  // The manual signIn writes the same id with both MFA flags false, so for an
  // account without 2FA the session that follows matches what is already in
  // state and the sync effect skips its identity fetch. isDemo has to be
  // resolved anyway, or every feature gated on it stays dark until a reload.
  it('resolves isDemo after a manual sign-in the session sync does not re-fetch', async () => {
    const { result, rerender } = renderProvider();

    act(() => {
      result.current.signIn(
        'u1',
        'u1',
        'real@example.com',
        'user',
        false,
        'Real User'
      );
    });

    sessionState = {
      data: {
        user: {
          id: 'u1',
          email: 'real@example.com',
          name: 'Real User',
          role: 'user',
          activeUserId: 'u1',
          twoFactorEnabled: false,
          mfaEmailEnabled: false,
        },
      },
      isPending: false,
    };
    rerender();

    await waitFor(() => expect(result.current.user?.isDemo).toBe(false));
    expect(mockFetchIdentityUser).toHaveBeenCalled();
  });

  it('treats a failed identity lookup as a regular account', async () => {
    mockFetchIdentityUser.mockRejectedValue(new Error('offline'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderProvider();
    act(() => {
      result.current.signIn('u1', 'u1', 'real@example.com', 'user', false);
    });

    await waitFor(() => expect(result.current.user?.isDemo).toBe(false));
  });

  it('marks the demo sandbox so gated features can skip their requests', async () => {
    mockFetchIdentityUser.mockResolvedValue({
      activeUserId: 'demo',
      activeUserEmail: 'demo@sparkyfitness.com',
      activeUserFullName: 'Demo',
      fullName: 'Demo',
      isDemo: true,
    });

    const { result } = renderProvider();
    act(() => {
      result.current.signIn(
        'demo',
        'demo',
        'demo@sparkyfitness.com',
        'user',
        false
      );
    });

    await waitFor(() => expect(result.current.user?.isDemo).toBe(true));
  });
});

describe('AuthProvider session cleanup probe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    jest.useFakeTimers();
    sessionState = { data: null, isPending: false };
    mockFetchIdentityUser.mockResolvedValue({
      activeUserId: 'u1',
      activeUserEmail: 'a@example.com',
      activeUserFullName: 'A',
      fullName: 'A',
      isDemo: false,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(['expired', 'failed', 'recovered', 'other-account'] as const)(
    'preserves drafts unless expiry is still authoritative: %s',
    async (outcome) => {
      let resolveProbe: (() => void) | undefined;
      let rejectProbe: (() => void) | undefined;
      mockApiCall.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            resolveProbe = () => resolve({});
            rejectProbe = () => reject(new Error('gateway/offline'));
          })
      );
      const { result, rerender } = renderProvider();
      act(() => {
        result.current.signIn('u1', 'u1', 'a@example.com', 'user', false);
      });
      const draft = createWorkoutPlaybackDraftFromExercise(
        { id: 'ex1', name: 'Walk' } as Exercise,
        '2026-04-27'
      );
      const own = { userId: 'u1', activeUserId: 'u1' };
      const family = { userId: 'u1', activeUserId: 'family' };
      const other = { userId: 'u2', activeUserId: 'u2' };
      for (const identity of [own, family, other])
        saveWorkoutPlaybackDraftToStorage(draft, identity);
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });
      rerender();
      await waitFor(() => expect(resolveProbe).toBeDefined());
      if (outcome === 'recovered' || outcome === 'other-account') {
        sessionState = {
          data: {
            user: {
              id: outcome === 'recovered' ? 'u1' : 'u2',
              email: 'a@example.com',
              name: 'A',
            },
          },
          isPending: false,
        };
        await act(async () => {
          rerender();
        });
      }
      await act(async () => {
        if (outcome === 'failed') rejectProbe!();
        else resolveProbe!();
      });
      for (const identity of [own, family]) {
        expect(
          loadWorkoutPlaybackDraftFromStorage('2026-04-27', identity) === null
        ).toBe(outcome === 'expired');
      }
      expect(
        loadWorkoutPlaybackDraftFromStorage('2026-04-27', other)
      ).not.toBeNull();
      expect(result.current.user?.id ?? null).toBe(
        outcome === 'expired' ? null : outcome === 'other-account' ? 'u2' : 'u1'
      );
    }
  );

  // The probe confirms a vanished session is a real logout rather than a
  // gateway swallowing the session fetch. It can outlive the account it was
  // asking about, and logging out whoever signed in meanwhile is worse than
  // leaving a stale user on screen for one more tick.
  it('does not log out an account that signed in while the probe was in flight', async () => {
    let finishProbe: (() => void) | undefined;
    mockApiCall.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishProbe = () => resolve({});
        })
    );

    const { result } = renderProvider();

    act(() => {
      result.current.signIn('a', 'a', 'a@example.com', 'user', false);
    });
    expect(result.current.user?.id).toBe('a');

    // Past the manual sign-in grace window, so the cleanup effect runs.
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    await act(async () => {
      result.current.signIn('a', 'a', 'a@example.com', 'user', false);
      jest.advanceTimersByTime(3000);
    });

    await waitFor(() => expect(finishProbe).toBeDefined());

    // A different account arrives before the probe answers.
    act(() => {
      result.current.signIn('b', 'b', 'b@example.com', 'user', false);
    });

    await act(async () => {
      finishProbe!();
    });

    expect(result.current.user?.id).toBe('b');
  });
});
