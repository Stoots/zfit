import '@testing-library/jest-dom';
import { useEffect } from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import MainLayout from '@/layouts/MainLayout';

let acting = false;
let permissions: string[] = [];
const signOut = jest.fn().mockResolvedValue(undefined);
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: 'admin' }, signOut }),
}));
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({
    isActingOnBehalf: acting,
    activeUserName: 'Owner',
    hasPermission: (key: string) => !acting || permissions.includes(key),
    hasWritePermission: (key: string) => !acting || permissions.includes(key),
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    getDateRelationToToday: () => 'today',
    loggingLevel: 'silent',
  }),
}));
jest.mock('@/hooks/Diary/useMealTypes', () => ({
  useMealTypes: () => ({ data: [{ id: 'breakfast', name: 'Breakfast' }] }),
}));
jest.mock('@/hooks/useGeneralQueries', () => ({
  useCurrentVersionQuery: () => ({ data: { version: '1' } }),
}));
jest.mock('@/hooks/useCycle', () => ({
  useCycleSettings: () => ({ data: { enabled: true } }),
}));
jest.mock('@/pages/Chat/SparkyChat', () => () => <div data-testid="chat" />);
jest.mock('@/components/ThemeToggle', () => () => <button>Theme</button>);
jest.mock('@/components/ProfileSwitcher', () => () => (
  <button>Switch profile</button>
));
jest.mock('@/components/GlobalSyncButton', () => () => <button>Sync</button>);
jest.mock('@/components/GlobalNotificationIcon', () => () => (
  <button>Notifications</button>
));
jest.mock('@/components/GitHubStarCounter', () => () => null);
jest.mock('@/components/GitHubSponsorButton', () => () => null);
jest.mock('@/components/HeaderLinkPill', () => () => null);

function mount(path = '/') {
  const routeState: { location: Location | null } = { location: null };
  function LocationProbe() {
    const location = useLocation();
    useEffect(() => {
      routeState.location = location;
    }, [location]);
    return null;
  }
  render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/"
          element={
            <MainLayout
              onShowAboutDialog={jest.fn()}
              onShowNewReleaseDialog={jest.fn()}
            />
          }
        >
          <Route index element={<div>Diary content</div>} />
          <Route path="*" element={<div>Other content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
  return routeState;
}

beforeEach(() => {
  acting = false;
  permissions = [];
  signOut.mockClear();
});

it('offers four mobile tabs and both training destinations', () => {
  const router = mount();
  const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
  expect(within(nav).getAllByRole('button')).toHaveLength(4);
  fireEvent.click(within(nav).getByRole('button', { name: 'Training' }));
  const dialog = screen.getByRole('dialog');
  expect(
    within(dialog).getByRole('button', { name: 'Exercises' })
  ).toBeInTheDocument();
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Training Programs' })
  );
  expect(router.location?.pathname).toBe('/training-programs');
  expect(
    screen.getByRole('button', { name: 'Switch profile' })
  ).toBeInTheDocument();
  expect(screen.getByTestId('chat')).toBeInTheDocument();
});

it('keeps all secondary destinations and the meal quick-log flow reachable', () => {
  const router = mount();
  const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
  fireEvent.click(within(nav).getByRole('button', { name: 'More' }));
  const dialog = screen.getByRole('dialog');
  for (const name of [
    'nav.reports',
    'nav.foods',
    'nav.goals',
    'nav.settings',
    'nav.admin',
    'Medications',
    'Cycle',
    'Cardio Tests',
  ]) {
    expect(within(dialog).getByRole('button', { name })).toBeInTheDocument();
  }
  fireEvent.click(within(dialog).getByRole('button', { name: 'Food Log' }));
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Breakfast',
    })
  );
  expect(router.location?.state).toEqual({
    openFoodSearchForMeal: 'breakfast',
  });
});

it('redirects delegates before mounting a disallowed page and hides owner navigation', async () => {
  acting = true;
  permissions = ['checkin', 'can_manage_medications'];
  const router = mount();
  expect(screen.queryByText('Diary content')).not.toBeInTheDocument();
  await waitFor(() => expect(router.location?.pathname).toBe('/checkin'));
  const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
  expect(
    within(nav).queryByRole('button', { name: 'Training' })
  ).not.toBeInTheDocument();
  fireEvent.click(within(nav).getByRole('button', { name: 'More' }));
  const dialog = screen.getByRole('dialog');
  expect(
    within(dialog).getByRole('button', { name: 'Medications' })
  ).toBeInTheDocument();
  expect(
    within(dialog).queryByRole('button', { name: 'nav.admin' })
  ).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole('button', { name: 'Food Log' })
  ).not.toBeInTheDocument();
});

it('keeps the symptoms-only delegate destination reachable', async () => {
  acting = true;
  permissions = ['can_manage_symptoms'];
  const router = mount();
  await waitFor(() => expect(router.location?.pathname).toBe('/symptoms'));
  fireEvent.click(
    within(
      screen.getByRole('navigation', { name: 'Primary navigation' })
    ).getByRole('button', { name: 'More' })
  );
  expect(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Symptoms' })
  ).toBeInTheDocument();
});
