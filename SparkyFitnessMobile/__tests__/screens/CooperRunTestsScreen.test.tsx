import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type {
  CooperRunAttempt,
  CooperRunAttemptInput,
  CardioTestAttempt,
  CardioTestAttemptInput,
} from '@workspace/shared';
import CooperRunTestsScreen from '../../src/screens/CooperRunTestsScreen';
import { initializeI18n } from '../../src/localization/i18n';
import {
  createCooperRunAttempt,
  updateCooperRunAttempt,
  fetchProtocolAttempts,
  saveProtocolAttempt,
} from '../../src/services/api/cardioTestsApi';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

let mockRecords: CooperRunAttempt[] = [];
let mockProtocolRecords: CardioTestAttempt[] = [];
let mockServerId = 'server-one';
jest.mock('../../src/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 'user-one' } }),
}));
jest.mock('../../src/hooks/useServerConfigs', () => ({
  useServerConfigs: () => ({ activeConfig: { id: mockServerId } }),
}));

jest.mock('../../src/services/api/cardioTestsApi', () => ({
  fetchProtocolAttempts: jest.fn(async (protocol: string) =>
    mockProtocolRecords.filter((attempt) => attempt.test_type === protocol)
  ),
  saveProtocolAttempt: jest.fn(async (input: CardioTestAttemptInput) => {
    const saved = {
      ...input,
      id: `00000000-0000-4000-a000-0000000000${mockProtocolRecords.length + 20}`,
      user_id: '00000000-0000-4000-a000-000000000001',
      created_at: '2026-10-01T12:00:00Z',
      updated_at: '2026-10-01T12:00:00Z',
    } as CardioTestAttempt;
    mockProtocolRecords = [...mockProtocolRecords, saved];
    return saved;
  }),
  fetchCooperRunAttempts: jest.fn(async () => mockRecords),
  createCooperRunAttempt: jest.fn(async (input: CooperRunAttemptInput) => {
    const timestamp = '2026-10-09T12:00:00.000Z';
    const saved: CooperRunAttempt = {
      id: '00000000-0000-4000-a000-000000000010',
      user_id: '00000000-0000-4000-a000-000000000001',
      test_type: 'cooper_run',
      ...input,
      created_at: timestamp,
      updated_at: timestamp,
    };
    mockRecords = [...mockRecords, saved];
    return saved;
  }),
  updateCooperRunAttempt: jest.fn(
    async (id: string, input: CooperRunAttemptInput) => {
      const existing = mockRecords.find((attempt) => attempt.id === id);
      if (!existing) throw new Error('Attempt not found');
      const saved = {
        ...existing,
        ...input,
        updated_at: '2026-10-10T12:00:00.000Z',
      };
      mockRecords = mockRecords.map((attempt) =>
        attempt.id === id ? saved : attempt
      );
      return saved;
    }
  ),
}));

jest.mock('../../src/hooks/useRefetchOnFocus', () => ({
  useRefetchOnFocus: jest.fn(),
}));
jest.mock('../../src/hooks/useScreenHeader', () => ({
  useScreenHeader: () => null,
}));
jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSHeadersActive: () => false,
}));
jest.mock('uniwind', () => ({
  useCSSVariable: (keys: string | string[]) =>
    Array.isArray(keys) ? keys.map(() => '#111827') : '#111827',
}));
jest.mock('../../src/utils/dateUtils', () => ({
  ...jest.requireActual('../../src/utils/dateUtils'),
  getTodayDate: () => '2026-09-27',
}));
jest.mock('../../src/components/DateSelectRow', () => ({
  __esModule: true,
  default: ({ date, onPress }: { date: string; onPress: () => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable onPress={onPress} accessibilityRole="button">
        <Text>{date}</Text>
      </Pressable>
    );
  },
}));
jest.mock('../../src/components/CalendarSheet', () => {
  const ReactModule = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    default: ReactModule.forwardRef(
      (
        { onSelectDate }: { onSelectDate: (date: string) => void },
        ref: React.ForwardedRef<{ present: () => void; dismiss: () => void }>
      ) => {
        ReactModule.useImperativeHandle(ref, () => ({
          present: () => undefined,
          dismiss: () => undefined,
        }));
        return (
          <Pressable
            accessibilityRole="button"
            onPress={() => onSelectDate('2026-09-22')}
          >
            <Text>Select test date</Text>
          </Pressable>
        );
      }
    ),
  };
});
// Keep Victory's scales, axes and line geometry real; replace only the native
// Skia drawing/font host and supply the dimensions unavailable in Jest.
let mockScales: {
  x: { invert: (value: number) => number };
  y: { invert: (value: number) => number };
};
jest.mock('victory-native', () => {
  const actual = jest.requireActual('victory-native');
  return {
    ...actual,
    CartesianChart: (
      props: React.ComponentProps<typeof actual.CartesianChart>
    ) => (
      <actual.CartesianChart
        {...props}
        explicitSize={{ width: 640, height: 240 }}
        headless
        onScaleChange={(x: typeof mockScales.x, y: typeof mockScales.y) => {
          mockScales = { x, y };
        }}
      />
    ),
  };
});
jest.mock('@shopify/react-native-skia', () => {
  const { View, Text } = require('react-native');
  return {
    Group: ({ children }: { children: React.ReactNode }) => (
      <View>{children}</View>
    ),
    Text: ({ text }: { text: string }) => <Text>{text}</Text>,
    Line: () => null,
    Path: ({ path }: { path: string }) => (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel="Plotted distance line"
        path={path}
      />
    ),
    vec: (x: number, y: number) => ({ x, y }),
    rect: (x: number, y: number, width: number, height: number) => ({
      x,
      y,
      width,
      height,
    }),
    matchFont: ({ fontSize }: { fontSize: number }) => ({
      getSize: () => fontSize,
      getGlyphIDs: (text: string) => Array.from(text).map((_, index) => index),
      getGlyphWidths: (glyphs: number[]) => glyphs.map(() => 6),
    }),
    Skia: {
      Path: { MakeFromSVGString: (svg: string) => svg },
      PathBuilder: {
        Make: () => {
          const paths: string[] = [];
          return {
            addPath: (path: string) => paths.push(path),
            addCircle: (x: number, y: number, radius: number) =>
              paths.push(`M${x},${y} circle ${radius}`),
            build: () => paths.join(''),
          };
        },
      },
    },
  };
});

function expectTrend(distances: number[]) {
  expect(screen.getByText('Sep 20')).toBeTruthy();
  expect(screen.getByText('Sep 22')).toBeTruthy();
  const path: string = screen.getAllByRole('image', {
    name: 'Plotted distance line',
  })[0]!.props.path;
  const coordinates = Array.from(path.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g));
  expect(coordinates).toHaveLength(2);
  coordinates.forEach((point, index) => {
    expect(mockScales.x.invert(Number(point[1]))).toBeCloseTo(index, 2);
    expect(mockScales.y.invert(Number(point[2]))).toBeCloseTo(
      distances[index]!,
      0
    );
  });
}

const initialMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, bottom: 0, left: 0, right: 0 },
};

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const screenTree = () => (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <CooperRunTestsScreen />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
  const result = render(screenTree());
  return { ...result, rerenderScreen: () => result.rerender(screenTree()) };
}

describe('CooperRunTestsScreen', () => {
  beforeAll(async () => {
    await initializeI18n('en');
  });

  beforeEach(() => {
    mockRecords = [];
    mockProtocolRecords = [];
    mockServerId = 'server-one';
    jest.clearAllMocks();
  });

  it('records sprint and 30-second efforts and shows dated history with trend graphs', async () => {
    renderScreen();
    [900, 800, 700, 600, 500].forEach((value, index) =>
      fireEvent.changeText(
        screen.getAllByLabelText(`Effort ${index + 1} peak (W)`)[0]!,
        String(value)
      )
    );
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Record Sprint' }))
    );
    await waitFor(() =>
      expect(saveProtocolAttempt).toHaveBeenCalledWith(
        {
          test_type: 'sprint_6s',
          attempt_date: '2026-09-27',
          results: { peak_watts: [900, 800, 700, 600, 500] },
        },
        undefined
      )
    );
    expect(await screen.findByText(/Drop-off 400 W \(44\.4%\)/)).toBeTruthy();
    expect(screen.getByTestId('sprint_6s-trend-chart')).toBeTruthy();

    [
      'Effort 1 peak (W)',
      'Effort 1 average (W)',
      'Effort 2 peak (W)',
      'Effort 2 average (W)',
    ].forEach((label, index) =>
      fireEvent.changeText(
        screen.getAllByLabelText(label)[label.includes('peak') ? 1 : 0]!,
        String([700, 450, 650, 425][index])
      )
    );
    await act(async () =>
      fireEvent.press(
        screen.getByRole('button', { name: 'Record 30-second Power' })
      )
    );
    await waitFor(() =>
      expect(saveProtocolAttempt).toHaveBeenCalledWith(
        {
          test_type: 'power_30s',
          attempt_date: '2026-09-27',
          results: {
            efforts: [
              { peak_watts: 700, average_watts: 450 },
              { peak_watts: 650, average_watts: 425 },
            ],
          },
        },
        undefined
      )
    );
    expect(await screen.findByText('700/450 W · 650/425 W')).toBeTruthy();
    expect(screen.getByTestId('power_30s-trend-chart')).toBeTruthy();
    const displayedDate = new Date('2026-09-27T12:00:00').toLocaleDateString(
      'en'
    );
    expect(screen.getAllByText(displayedDate)).toHaveLength(2);
    expect(
      screen.getByRole('button', {
        name: `Edit sprint attempt on ${displayedDate}`,
      })
    ).toBeTruthy();
    expect(fetchProtocolAttempts).toHaveBeenCalledWith('sprint_6s');
    expect(fetchProtocolAttempts).toHaveBeenCalledWith('power_30s');
  });

  it('accepts decimal commas in mobile watt fields', async () => {
    renderScreen();
    ['900,5', '800', '700', '600', '500'].forEach((value, index) =>
      fireEvent.changeText(
        screen.getAllByLabelText(`Effort ${index + 1} peak (W)`)[0]!,
        value
      )
    );
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Record Sprint' }))
    );
    expect(saveProtocolAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        results: { peak_watts: [900.5, 800, 700, 600, 500] },
      }),
      undefined
    );
  });

  it('discards a power draft when the active server changes', () => {
    const view = renderScreen();
    fireEvent.changeText(
      screen.getAllByLabelText('Effort 1 peak (W)')[0]!,
      '900'
    );
    mockServerId = 'server-two';
    act(() => view.rerenderScreen());
    expect(screen.getAllByLabelText('Effort 1 peak (W)')[0]!.props.value).toBe(
      ''
    );
  });

  it('records a dated 12-minute distance, shows the graph and history, and edits it', async () => {
    mockRecords = [
      {
        id: 'earlier',
        user_id: 'owner',
        test_type: 'cooper_run',
        attempt_date: '2026-09-20',
        distance_meters: 2400,
        created_at: '2026-09-20T12:00:00Z',
        updated_at: '2026-09-20T12:00:00Z',
      },
    ];
    renderScreen();
    fireEvent.press(screen.getAllByText('2026-09-27')[0]!);
    fireEvent.press(screen.getAllByText('Select test date').at(-1)!);
    fireEvent.changeText(
      screen.getByLabelText('Distance covered in 12 minutes in meters'),
      '2512'
    );
    await act(async () => {
      fireEvent.press(
        screen.getByRole('button', { name: 'Record Test Attempt' })
      );
    });

    expect(await screen.findByText('2,512 m')).toBeTruthy();
    expect(
      screen.getByText(new Date('2026-09-22T12:00:00').toLocaleDateString('en'))
    ).toBeTruthy();
    expectTrend([2400, 2512]);

    fireEvent.press(
      screen.getByRole('button', {
        name: 'Edit Cooper run attempt on 2026-09-22',
      })
    );
    fireEvent.changeText(
      screen.getByLabelText('Distance covered in 12 minutes in meters'),
      '2600'
    );
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    });

    await waitFor(() => expect(screen.getByText('2,600 m')).toBeTruthy());
    expectTrend([2400, 2600]);
  });

  it.each(['create', 'update'] as const)(
    'locks the draft while a %s save is pending',
    async (mode) => {
      const existing: CooperRunAttempt = {
        id: 'existing',
        user_id: 'owner',
        test_type: 'cooper_run',
        attempt_date: '2026-09-20',
        distance_meters: 2400,
        created_at: '2026-09-20T12:00:00Z',
        updated_at: '2026-09-20T12:00:00Z',
      };
      mockRecords = [existing];
      const { promise, resolve } = deferred<CooperRunAttempt>();
      if (mode === 'create')
        jest
          .mocked(createCooperRunAttempt)
          .mockImplementationOnce(() => promise);
      else
        jest
          .mocked(updateCooperRunAttempt)
          .mockImplementationOnce(() => promise);
      renderScreen();
      const edit = await screen.findByRole('button', {
        name: 'Edit Cooper run attempt on 2026-09-20',
      });
      if (mode === 'update') fireEvent.press(edit);
      else
        fireEvent.changeText(
          screen.getByLabelText('Distance covered in 12 minutes in meters'),
          '2512'
        );
      fireEvent.press(
        screen.getByRole('button', {
          name: mode === 'update' ? 'Save' : 'Record Test Attempt',
        })
      );
      await waitFor(() =>
        expect(
          screen.getByLabelText('Distance covered in 12 minutes in meters')
            .props.editable
        ).toBe(false)
      );
      expect(edit.props.accessibilityState?.disabled).toBe(true);
      fireEvent.press(edit);
      fireEvent.press(screen.getAllByText('Select test date').at(-1)!);
      expect(
        screen.getByLabelText('Distance covered in 12 minutes in meters').props
          .value
      ).toBe(mode === 'update' ? '2400' : '2512');
      if (mode === 'update') {
        const cancel = screen.getByRole('button', { name: 'Cancel' });
        expect(cancel).toBeDisabled();
        fireEvent.press(cancel);
      }
      fireEvent.press(
        screen.getByRole('button', {
          name: mode === 'update' ? 'Save' : 'Record Test Attempt',
        })
      );
      expect(createCooperRunAttempt).toHaveBeenCalledTimes(
        mode === 'create' ? 1 : 0
      );
      expect(updateCooperRunAttempt).toHaveBeenCalledTimes(
        mode === 'update' ? 1 : 0
      );
      await act(async () => {
        resolve(existing);
      });
      await waitFor(() =>
        expect(
          screen.getByLabelText('Distance covered in 12 minutes in meters')
            .props.editable
        ).not.toBe(false)
      );
      fireEvent.changeText(
        screen.getByLabelText('Distance covered in 12 minutes in meters'),
        '2900'
      );
      expect(
        screen.getByLabelText('Distance covered in 12 minutes in meters').props
          .value
      ).toBe('2900');
    }
  );
});
