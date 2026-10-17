import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { programStatus } from '@workspace/shared';
import RunProgramsScreen from '../../src/screens/RunProgramsScreen';
import {
  setProgramEnabled,
  setProgramSchedule,
  startProgram,
  useRunProgram,
} from '../../src/services/runProgramService';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const metrics = {
  insets: { top: 0, bottom: 0, left: 0, right: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};
const renderScreen = (props: React.ComponentProps<typeof RunProgramsScreen>) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <RunProgramsScreen {...props} />
    </SafeAreaProvider>
  );

jest.mock('../../src/services/runProgramService', () => ({
  useRunProgram: jest.fn(),
  startProgram: jest.fn(() => Promise.resolve()),
  setProgramEnabled: jest.fn(() => Promise.resolve()),
  setProgramPosition: jest.fn(() => Promise.resolve()),
  restartProgram: jest.fn(() => Promise.resolve()),
  skipProgramWorkout: jest.fn(() => Promise.resolve()),
  setProgramSchedule: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../src/services/LogService', () => ({ addLog: jest.fn() }));
jest.mock('../../src/hooks/useScreenHeader', () => ({
  useScreenHeader: () => null,
}));

/** Minimal navigation props for rendering the screen in a test. */
const RunProgramsProps = () =>
  ({
    navigation: { navigate: jest.fn(), goBack: jest.fn() },
    route: { key: 'RunPrograms', name: 'RunPrograms' },
  }) as unknown as React.ComponentProps<typeof RunProgramsScreen>;

jest.mock('../../src/components/CalendarSheet', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ReactModule.forwardRef(
      (props: unknown, ref: React.Ref<unknown>) => {
        (globalThis as { __calendarProps?: unknown }).__calendarProps = props;
        ReactModule.useImperativeHandle(ref, () => ({
          present: jest.fn(),
          dismiss: jest.fn(),
        }));
        return <View testID="calendar-sheet" />;
      }
    ),
  };
});

const mockedUse = jest.mocked(useRunProgram);

describe('RunProgramsScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists every program and starts the one chosen', () => {
    mockedUse.mockReturnValue({
      status: null,
      enabled: false,
      lastAdjustment: null,
      schedule: { days: [], startDay: null, endDay: null },
      doneDay: null,
      loaded: true,
    });
    renderScreen(RunProgramsProps());
    expect(screen.getByTestId('run-program-beginner5k')).toBeTruthy();
    expect(screen.getByTestId('run-program-marathon')).toBeTruthy();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(screen.getAllByText('Start program')[0]);
    const buttons = alert.mock.calls[0][2] ?? [];
    expect(buttons.map((b) => b.text)).toEqual([
      'Cancel',
      'Pick a date',
      'Start today',
    ]);
    buttons[2].onPress?.();
    expect(startProgram).toHaveBeenCalledWith('walkFit', null);
    alert.mockRestore();
  });

  it('starts on a date picked from the calendar', () => {
    mockedUse.mockReturnValue({
      status: null,
      enabled: false,
      lastAdjustment: null,
      schedule: { days: [], startDay: null, endDay: null },
      doneDay: null,
      loaded: true,
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderScreen(RunProgramsProps());
    fireEvent.press(screen.getAllByText('Start program')[0]);
    act(() => alert.mock.calls[0][2]?.[1].onPress?.());
    expect(startProgram).not.toHaveBeenCalled();
    const { onSelectDate } = (
      globalThis as {
        __calendarProps?: { onSelectDate: (day: string) => void };
      }
    ).__calendarProps!;
    act(() => onSelectDate('2099-01-05'));
    expect(startProgram).toHaveBeenCalledWith('walkFit', '2099-01-05');
    alert.mockRestore();
  });

  it("shows the program being followed and starts today's workout from Record", () => {
    mockedUse.mockReturnValue({
      status: programStatus({ programId: 'beginner5k', next: 2 })!,
      enabled: true,
      lastAdjustment: null,
      schedule: { days: [], startDay: null, endDay: null },
      doneDay: null,
      loaded: true,
    });
    const props = RunProgramsProps();
    renderScreen(props);
    expect(screen.queryByTestId('run-program-marathon')).toBeNull();
    fireEvent.press(screen.getByText("Start today's workout"));
    expect(props.navigation.navigate).toHaveBeenCalledWith('RecordActivity', {
      programWorkout: true,
    });
  });

  it('saves the Diary days with the program', () => {
    mockedUse.mockReturnValue({
      status: programStatus({ programId: 'beginner5k', next: 2 })!,
      enabled: true,
      lastAdjustment: null,
      schedule: { days: [], startDay: null, endDay: null },
      doneDay: null,
      loaded: true,
    });
    renderScreen(RunProgramsProps());
    fireEvent.press(screen.getByLabelText('Monday'));
    expect(setProgramSchedule).toHaveBeenCalledWith({ toggleDay: 1 });
  });

  it('keeps the place and offers to resume a program that is switched off', () => {
    mockedUse.mockReturnValue({
      status: programStatus({ programId: 'beginner5k', next: 2 })!,
      enabled: false,
      lastAdjustment: null,
      schedule: { days: [], startDay: null, endDay: null },
      doneDay: null,
      loaded: true,
    });
    renderScreen(RunProgramsProps());
    fireEvent(
      screen.getByLabelText('Use a training program'),
      'valueChange',
      true
    );
    expect(setProgramEnabled).toHaveBeenCalledWith(true, 'beginner5k');
  });
});
