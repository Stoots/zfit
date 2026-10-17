import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
  hasServicesEnabledAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
}));
jest.mock('../../src/services/LogService', () => ({ addLog: jest.fn() }));
jest.mock('../../src/services/haptics', () => ({
  fireImpactHaptic: jest.fn(),
}));
jest.mock('../../src/services/recordingCues', () => ({
  beginRecordingCues: jest.fn(),
  endRecordingCues: jest.fn(),
  stopRecordingCues: jest.fn(),
  speakRecordingCue: jest.fn(),
}));

import { fireImpactHaptic } from '../../src/services/haptics';
import { speakRecordingCue } from '../../src/services/recordingCues';
import {
  markLap,
  pauseRecording,
  resetRecordingStateForTests,
  resumeRecording,
  startRecording,
  tickIntervals,
  type RecordingSession,
} from '../../src/services/gpsRecordingService';
import { buildIntervalPlan } from '@workspace/shared';

const notification = { title: 'Recording', body: 'Tracking' };
const T0 = new Date(2026, 9, 10, 8, 0, 0).getTime();

const plan = buildIntervalPlan({
  style: 'runWalk',
  warmupSeconds: 0,
  workSeconds: 60,
  recoverySeconds: 90,
  rounds: 2,
  cooldownSeconds: 0,
});

async function stored(): Promise<RecordingSession | null> {
  const raw = await AsyncStorage.getItem('@SparkyFitness/gpsRecording/session');
  return raw ? (JSON.parse(raw) as RecordingSession) : null;
}

const at = (seconds: number) => jest.setSystemTime(T0 + seconds * 1000);

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  at(0);
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetRecordingStateForTests();
  const location = Location as jest.Mocked<typeof Location>;
  location.hasServicesEnabledAsync.mockResolvedValue(true);
  location.requestForegroundPermissionsAsync.mockResolvedValue({
    granted: true,
  } as Location.LocationPermissionResponse);
  location.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
  location.startLocationUpdatesAsync.mockResolvedValue(undefined);
});

afterEach(() => jest.useRealTimers());

describe('interval plans', () => {
  test('start the first step at once and cue it', async () => {
    await startRecording({
      activity: 'run',
      audioCues: 'km',
      intervals: plan,
      notification,
    });
    expect((await stored())?.intervals?.cued).toBe(0);
    expect(speakRecordingCue).toHaveBeenCalledTimes(1);
    expect(speakRecordingCue).toHaveBeenCalledWith(
      expect.stringContaining('Run')
    );
    expect(fireImpactHaptic).toHaveBeenCalledTimes(1);
  });

  test('mark a lap at each step boundary, not when it was noticed', async () => {
    await startRecording({ activity: 'run', intervals: plan, notification });
    at(62); // two seconds late
    await tickIntervals();
    const session = await stored();
    expect(session?.intervals?.cued).toBe(1);
    expect(session?.laps).toEqual([T0 + 60_000]);
  });

  test('do not repeat a step that was already announced', async () => {
    await startRecording({
      activity: 'run',
      audioCues: 'km',
      intervals: plan,
      notification,
    });
    at(10);
    await tickIntervals();
    await tickIntervals();
    expect(speakRecordingCue).toHaveBeenCalledTimes(1);
  });

  test('say only the latest of several steps passed together', async () => {
    await startRecording({
      activity: 'run',
      audioCues: 'km',
      intervals: plan,
      notification,
    });
    jest.mocked(speakRecordingCue).mockClear();
    at(300); // past all but the end
    await tickIntervals();
    const session = await stored();
    expect(session?.laps).toHaveLength(3);
    expect(speakRecordingCue).toHaveBeenCalledTimes(1);
    expect(speakRecordingCue).toHaveBeenCalledWith(
      expect.stringContaining('complete')
    );
  });

  test('a manual lap does not swallow the next step boundary', async () => {
    await startRecording({ activity: 'run', intervals: plan, notification });
    at(58);
    await markLap();
    at(62);
    await tickIntervals();
    expect((await stored())?.laps).toEqual([T0 + 58_000, T0 + 60_000]);
  });

  test('a pause after a missed boundary does not shift that lap', async () => {
    await startRecording({ activity: 'run', intervals: plan, notification });
    at(70); // the 60 s step ended, and nothing ticked
    await pauseRecording();
    at(90);
    await resumeRecording({ title: 'Recording', body: 'Tracking' });
    at(95);
    await tickIntervals();
    expect((await stored())?.laps).toEqual([T0 + 60_000]);
  });

  test('stop counting while paused', async () => {
    await startRecording({ activity: 'run', intervals: plan, notification });
    at(30);
    await pauseRecording();
    at(300); // a long pause
    await tickIntervals();
    expect((await stored())?.intervals?.cued).toBe(0);
    await resumeRecording({ title: 'Recording', body: 'Tracking' });
    at(300 + 20); // 50 s of running in total
    await tickIntervals();
    expect((await stored())?.intervals?.cued).toBe(0);
    at(300 + 40); // 70 s
    await tickIntervals();
    expect((await stored())?.intervals?.cued).toBe(1);
  });

  test('ignore an invalid plan', async () => {
    await startRecording({
      activity: 'run',
      intervals: { style: 'runWalk', steps: [] },
      notification,
    });
    expect((await stored())?.intervals).toBeUndefined();
  });
});
