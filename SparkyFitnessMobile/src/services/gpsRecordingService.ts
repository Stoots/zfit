import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import i18n from '../localization/i18n';
import { addLog } from './LogService';
import {
  beginRecordingCues,
  endRecordingCues,
  speakRecordingCue,
  stopRecordingCues,
} from './recordingCues';
import {
  acceptFix,
  computeLaps,
  computeSplits,
  currentPaceSecondsPerUnit,
  summarizeRecording,
  type RawFix,
  type RecordedPoint,
  type RecordingActivity,
} from '../utils/gpsRecording';
import { isStepActivity } from '../utils/stride';
import { captureStepCounterBaseline } from './stepCounter';
import {
  INITIAL_AUTO_PAUSE_STATE,
  stepAutoPause,
  type AutoPauseState,
} from '../utils/autoPause';
import {
  INITIAL_HEART_RATE_ALERT_STATE,
  INITIAL_PACE_ALERT_STATE,
  intervalPosition,
  isValidIntervalPlan,
  normalizeHeartRateBand,
  normalizePaceBand,
  stepHeartRateAlert,
  stepPaceAlert,
  stepStartSeconds,
  type HeartRateAlertState,
  type HeartRateBand,
  type IntervalPlan,
  type PaceAlertState,
  type PaceBand,
} from '@workspace/shared';
import { fireImpactHaptic } from './haptics';
import {
  cueUnitMeters,
  eventCue,
  finishCue,
  intervalCue,
  intervalsDoneCue,
  heartRateAlertCue,
  lapCue,
  paceAlertCue,
  splitCue,
  type CueEvent,
  type CueUnit,
} from '../utils/recordingCues';

/**
 * Records a walk, run or ride from the phone's GPS.
 *
 * A location task (`expo-location` on `expo-task-manager`) receives the fixes,
 * so recording carries on with the screen locked: a foreground service on
 * Android, the `location` background mode on iOS. Both start while the app is
 * on screen, so only the while-using-the-app permission is needed.
 *
 * Every accepted fix is written to AsyncStorage in small chunks as it
 * arrives. A dropped connection never touches the track (nothing is sent until
 * the person finishes), and an app killed mid-recording leaves the session and
 * its points on disk for `hydrate()` to pick up.
 */

export const GPS_RECORDING_TASK_NAME = 'sparky-gps-recording';

const SESSION_KEY = '@SparkyFitness/gpsRecording/session';
const AUTO_PAUSE_PREF_KEY = '@SparkyFitness/gpsRecording/autoPause';
const AUDIO_CUES_PREF_KEY = '@SparkyFitness/gpsRecording/audioCues';
const HEART_RATE_KEY = '@SparkyFitness/gpsRecording/heartRate';
const chunkKey = (index: number) =>
  `@SparkyFitness/gpsRecording/chunk/${index}`;
/** Points per stored chunk: bounds how much is rewritten on each fix. */
const CHUNK_SIZE = 100;

export type RecordingStatus = 'recording' | 'paused' | 'finished';

export interface RecordingSession {
  id: string;
  activity: RecordingActivity;
  status: RecordingStatus;
  /** Epoch ms of the first Start press. */
  startedAt: number;
  /** Epoch ms the recording ended (finished status only). */
  finishedAt: number | null;
  /** Epoch ms the current pause began (paused status only). */
  pausedAt: number | null;
  /** Total time spent paused before the current pause, in ms. */
  pausedMs: number;
  /**
   * Set when the session paused at least once, including a finish while
   * paused. The final pause is not added to `pausedMs`, so that field alone
   * cannot say whether a finished session ever stopped.
   */
  hadPause?: boolean;
  /** Current stretch; goes up on every resume. */
  seg: number;
  /** Whether the recording pauses itself when the person stops moving. */
  autoPause?: boolean;
  /** True while paused by auto-pause rather than by the person. */
  autoPaused?: boolean;
  /** Speak split times and pauses; the unit the splits are announced in. */
  audioCues?: CueUnit;
  /** Epoch ms of each press of the Lap button, oldest first. */
  laps?: number[];
  /** Full splits already announced, so a restored session does not repeat one. */
  cuedSplits?: number;
  /**
   * Future mark whose trailing partial lap was already announced. While it is
   * still at or beyond the newest fix, another late press must not say it again.
   */
  cuedPartialLapMark?: number;
  /**
   * A timed interval plan. `cued` is the index of the last step started (-1
   * before the first), so a restored session never repeats a cue.
   */
  intervals?: { plan: IntervalPlan; cued: number };
  /** The program workout this recording is, so finishing it can tick it off. */
  program?: { id: string; index: number };
  /**
   * A pace band to stay inside: the phone buzzes, and speaks when voice cues
   * are on, after the pace has been outside it for a few seconds.
   */
  paceBand?: PaceBand;
  /** A heart-rate range to stay inside, read from a paired watch. */
  heartRateBand?: HeartRateBand;
  /**
   * The runner turned the pace alert off mid-run, which also silences the
   * ranges on a plan's own steps. Absent means on.
   */
  paceStepsOff?: boolean;
  /** Likewise for the heart-rate alert. */
  heartRateStepsOff?: boolean;
  /** Set once the diary entry exists, so a retried save never duplicates it. */
  savedEntryId: string | null;
  /**
   * A treadmill or other indoor session: no location task and no route, just
   * the clock (and a paired watch's heart rate). Absent on sessions saved by
   * an earlier build, which were all outdoors.
   */
  indoor?: boolean;
  /**
   * Android hardware step counter (steps since boot) when this walk or run
   * started. Finish subtracts a new reading. Absent on iOS, on a ride, and
   * when the counter could not be read. A reboot resets it.
   */
  stepCounterAtStart?: number;
}

/** One heart-rate reading from a paired watch during the recording. */
export interface RecordedHeartRate {
  /** Epoch ms. */
  t: number;
  bpm: number;
}

interface StoredHeartRate {
  samples: RecordedHeartRate[];
  /** Batches already taken, so a re-delivered queued batch is not added twice. */
  batchIds: string[];
}

/** Batch ids remembered; far more than a recording ever produces. */
const MAX_BATCH_IDS = 500;

export interface RecordingSnapshot {
  session: RecordingSession | null;
  points: readonly RecordedPoint[];
}

export class RecordingPermissionError extends Error {
  constructor(
    readonly reason: 'denied' | 'services-disabled',
    message: string
  ) {
    super(message);
    this.name = 'RecordingPermissionError';
  }
}

let session: RecordingSession | null = null;
let points: RecordedPoint[] = [];
let snapshot: RecordingSnapshot = { session: null, points: [] };
let heartRate: StoredHeartRate = { samples: [], batchIds: [] };
let hydrated: Promise<void> | null = null;
// Detector memory for auto-pause. Not persisted: after a relaunch it just
// starts watching again.
let autoPauseState: AutoPauseState = INITIAL_AUTO_PAUSE_STATE;
// What the fixes auto-pause looked at carried, logged once at Finish so a
// recording that never paused can be explained from the app log.
let autoPauseFixStats = { withSpeed: 0, withoutSpeed: 0, inaccurate: 0 };

function countAutoPauseFix(fix: RawFix): void {
  if (typeof fix.hacc === 'number' && fix.hacc > 30) {
    autoPauseFixStats.inaccurate++;
  } else if (
    typeof fix.speed === 'number' &&
    Number.isFinite(fix.speed) &&
    fix.speed >= 0
  ) {
    autoPauseFixStats.withSpeed++;
  } else {
    autoPauseFixStats.withoutSpeed++;
  }
}
/**
 * The newest fix's accuracy radius and time, for the GPS signal bars. Kept
 * apart from the session with its own listeners so the bars can follow every
 * fix without re-rendering the whole recording screen.
 */
export interface GpsFixQuality {
  hacc: number;
  t: number;
}
let latestFix: GpsFixQuality | null = null;
const fixListeners = new Set<() => void>();

function noteLatestFix(fixes: readonly RawFix[]): void {
  const last = fixes[fixes.length - 1];
  if (!last || last.hacc == null) return;
  latestFix = { hacc: last.hacc, t: last.t };
  fixListeners.forEach((listener) => listener());
}

function clearLatestFix(): void {
  latestFix = null;
  fixListeners.forEach((listener) => listener());
}

const subscribeFix = (listener: () => void): (() => void) => {
  fixListeners.add(listener);
  return () => fixListeners.delete(listener);
};
const getLatestFix = (): GpsFixQuality | null => latestFix;

/** The newest GPS fix's accuracy and time, or null before the first one. */
export function useLatestGpsFix(): GpsFixQuality | null {
  return useSyncExternalStore(subscribeFix, getLatestFix, getLatestFix);
}

const listeners = new Set<() => void>();
// The task callback and the screen's own writes share one session, so every
// read-modify-write runs on this chain instead of overlapping.
let queue: Promise<unknown> = Promise.resolve();

const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
};

function publish(): void {
  snapshot = { session, points: points.slice() };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = (): RecordingSnapshot => snapshot;

/** The live recording outside React, for the Lock Screen Live Activity. */
export const subscribeGpsRecording = subscribe;
export const getGpsRecordingSnapshot = getSnapshot;

/** Live recording state for the screen. */
export function useGpsRecording(): RecordingSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const getHasRecording = (): boolean => snapshot.session != null;

/**
 * Whether a recording exists (running, paused or finished but unsaved). A
 * boolean, so a screen that only reserves room for the recording bar does not
 * re-render on every location fix the way `useGpsRecording` would.
 */
export function useHasGpsRecording(): boolean {
  return useSyncExternalStore(subscribe, getHasRecording, getHasRecording);
}

async function persistSession(): Promise<void> {
  if (session) {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    await AsyncStorage.removeItem(SESSION_KEY);
  }
}

async function persistChunk(index: number): Promise<void> {
  const chunk = points.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
  await AsyncStorage.setItem(chunkKey(index), JSON.stringify(chunk));
}

async function clearStoredPoints(): Promise<void> {
  await removeChunksAfter(-1);
}

/** Drops chunk files after `lastKept`. `-1` drops every chunk. */
async function removeChunksAfter(lastKept: number): Promise<void> {
  // Chunk count cannot come from `points.length`. A failed hydrate leaves
  // that array short of what is still on disk, and the next recording would
  // then read the leftover chunks onto its own track.
  const prefix = chunkKey(0).slice(0, -1);
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => {
    if (!key.startsWith(prefix)) return false;
    const index = Number(key.slice(prefix.length));
    return Number.isInteger(index) && index > lastKept;
  });
  if (keys.length > 0) await AsyncStorage.multiRemove(keys);
}

/**
 * Loads whatever an earlier run left on disk. Safe to call repeatedly; the
 * task callback calls it too, because a killed app can be woken by a location
 * fix before any screen has mounted.
 */
export function hydrate(): Promise<void> {
  if (!hydrated) {
    hydrated = (async () => {
      try {
        const raw = await AsyncStorage.getItem(SESSION_KEY);
        if (!raw) return;
        const stored = JSON.parse(raw) as RecordingSession;
        const loaded: RecordedPoint[] = [];
        for (let index = 0; ; index++) {
          const chunk = await AsyncStorage.getItem(chunkKey(index));
          if (!chunk) break;
          loaded.push(...(JSON.parse(chunk) as RecordedPoint[]));
        }
        const storedHeartRate = await AsyncStorage.getItem(HEART_RATE_KEY);
        session = stored;
        points = loaded;
        // A relaunch mid-run: the cues need their audio session back.
        if (stored.audioCues && stored.status !== 'finished') {
          beginRecordingCues();
        }
        heartRate = storedHeartRate
          ? (JSON.parse(storedHeartRate) as StoredHeartRate)
          : { samples: [], batchIds: [] };
        publish();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLog(
          `[GPS Recording] Could not restore session: ${message}`,
          'ERROR'
        );
      }
    })();
  }
  return hydrated;
}

/** Feeds a batch of fixes through the noise filter into the stored track. */
export function ingestFixes(fixes: readonly RawFix[]): Promise<void> {
  return enqueue(async () => {
    await hydrate();
    if (!session) return;
    noteLatestFix(fixes);
    const firstTouched = Math.floor(points.length / CHUNK_SIZE);
    let added = 0;
    let sessionChanged = false;
    let pointsRewritten = false;
    for (const fix of fixes) {
      if (session.autoPause && isWatchingForAutoPause(session)) {
        countAutoPauseFix(fix);
        const step = stepAutoPause(
          autoPauseState,
          fix,
          session.activity,
          session.status === 'paused'
        );
        autoPauseState = step.state;
        if (step.action.type === 'pause') {
          // The pause is dated to when they stopped, which can be several
          // fixes ago. Drift accepted after that is not part of the route.
          const pauseAt = step.action.at;
          // Close any step that became due before they stopped. Doing it
          // after the pause would date the lap with the pause included.
          if (advanceIntervals(pauseAt)) sessionChanged = true;
          const retained = points.filter((point) => point.t <= pauseAt);
          if (retained.length !== points.length) {
            points = retained;
            pointsRewritten = true;
          }
          session = {
            ...session,
            status: 'paused',
            pausedAt: pauseAt,
            autoPaused: true,
            hadPause: true,
          };
          sessionChanged = true;
          addLog('[GPS Recording] Auto-paused', 'INFO');
          cueEvent(session, 'autoPaused');
        } else if (step.action.type === 'resume') {
          session = {
            ...session,
            status: 'recording',
            pausedMs:
              session.pausedMs +
              Math.max(
                0,
                step.action.at - (session.pausedAt ?? step.action.at)
              ),
            pausedAt: null,
            seg: session.seg + 1,
            autoPaused: false,
          };
          sessionChanged = true;
          addLog('[GPS Recording] Auto-resumed', 'INFO');
          cueEvent(session, 'resumed');
        }
      }
      if (session.status !== 'recording') continue;
      const accepted = acceptFix(
        points[points.length - 1],
        fix,
        session.seg,
        session.activity
      );
      if (accepted) {
        points.push(accepted);
        added++;
      }
    }
    if (added > 0 && cueSplit()) sessionChanged = true;
    if (advanceIntervals(Date.now())) sessionChanged = true;
    if (added > 0) checkPaceBand(Date.now());
    if (sessionChanged) await persistSession();
    if (added === 0 && !pointsRewritten) {
      if (sessionChanged) publish();
      return;
    }
    const lastTouched =
      points.length === 0 ? -1 : Math.floor((points.length - 1) / CHUNK_SIZE);
    if (pointsRewritten) {
      // Write the kept route before dropping the old tail. Clearing first
      // would leave a killed app with the session and no track.
      for (let index = 0; index <= lastTouched; index++) {
        await persistChunk(index);
      }
      await removeChunksAfter(lastTouched);
    } else {
      for (let index = firstTouched; index <= lastTouched; index++) {
        await persistChunk(index);
      }
    }
    publish();
  });
}

/** Auto-pause watches a running recording and one it paused itself. */
function isWatchingForAutoPause(current: RecordingSession): boolean {
  return (
    current.status === 'recording' ||
    (current.status === 'paused' && current.autoPaused === true)
  );
}

export interface RecordingPreferences {
  autoPause: boolean;
  audioCues: boolean;
  /** The pace range last chosen, in seconds per km; null before one was. An alert is per run, so only the range is kept. */
  paceBand: PaceBand | null;
  /** The heart-rate range last chosen; null before one was. */
  heartRateBand: HeartRateBand | null;
  /** Seconds counted down before Start begins recording; 0 is no countdown. */
  countdownSeconds: number;
}

/** The countdowns offered, in seconds. */
export const COUNTDOWN_CHOICES = [0, 3, 5, 10] as const;

const COUNTDOWN_PREF_KEY = '@SparkyFitness/gpsRecording/countdown';
const PACE_ALERT_PREF_KEY = '@SparkyFitness/gpsRecording/paceAlert';
const HEART_RATE_ALERT_PREF_KEY = '@SparkyFitness/gpsRecording/heartRateAlert';

const PREFERENCE_KEYS = {
  autoPause: AUTO_PAUSE_PREF_KEY,
  audioCues: AUDIO_CUES_PREF_KEY,
};

/** Auto-pause is on unless turned off; voice cues are off unless turned on. */
export async function getRecordingPreferences(): Promise<RecordingPreferences> {
  try {
    const [autoPause, audioCues, countdown, paceAlertRaw, heartRateAlertRaw] =
      await Promise.all([
        AsyncStorage.getItem(PREFERENCE_KEYS.autoPause),
        AsyncStorage.getItem(PREFERENCE_KEYS.audioCues),
        AsyncStorage.getItem(COUNTDOWN_PREF_KEY),
        AsyncStorage.getItem(PACE_ALERT_PREF_KEY),
        AsyncStorage.getItem(HEART_RATE_ALERT_PREF_KEY),
      ]);
    const seconds = Number(countdown);
    return {
      autoPause: autoPause !== 'off',
      audioCues: audioCues === 'on',
      paceBand: parsePaceBandPreference(paceAlertRaw),
      heartRateBand: parseHeartRateBandPreference(heartRateAlertRaw),
      countdownSeconds: (COUNTDOWN_CHOICES as readonly number[]).includes(
        seconds
      )
        ? seconds
        : 0,
    };
  } catch {
    return {
      autoPause: true,
      audioCues: false,
      paceBand: null,
      heartRateBand: null,
      countdownSeconds: 0,
    };
  }
}

function parseHeartRateBandPreference(
  raw: string | null
): HeartRateBand | null {
  try {
    return normalizeHeartRateBand(
      raw ? (JSON.parse(raw) as Partial<HeartRateBand>) : null
    );
  } catch {
    return null;
  }
}

/** Remembers the heart-rate range last used, as the starting point for the next run's alert (on the phone or the watch). */
export async function setHeartRateBandPreference(
  band: HeartRateBand
): Promise<void> {
  try {
    await AsyncStorage.setItem(HEART_RATE_ALERT_PREF_KEY, JSON.stringify(band));
  } catch {
    // The choice just won't be remembered.
  }
  preferenceListeners.forEach((listener) => listener());
}

function parsePaceBandPreference(raw: string | null): PaceBand | null {
  try {
    return normalizePaceBand(
      raw ? (JSON.parse(raw) as Partial<PaceBand>) : null
    );
  } catch {
    return null;
  }
}

/**
 * Remembers the pace range last used (seconds per km) as the starting point for
 * the next run's alert, on the phone or the watch. The alert itself is per run.
 */
export async function setPaceBandPreference(band: PaceBand): Promise<void> {
  try {
    await AsyncStorage.setItem(PACE_ALERT_PREF_KEY, JSON.stringify(band));
  } catch {
    // The choice just won't be remembered.
  }
  preferenceListeners.forEach((listener) => listener());
}

export async function setCountdownPreference(seconds: number): Promise<void> {
  try {
    await AsyncStorage.setItem(COUNTDOWN_PREF_KEY, String(seconds));
  } catch {
    // The choice just won't be remembered.
  }
}

const preferenceListeners = new Set<() => void>();

/** Calls `listener` after a recording preference changes (the watch hears about voice cues). */
export function onRecordingPreferenceChange(listener: () => void): () => void {
  preferenceListeners.add(listener);
  return () => preferenceListeners.delete(listener);
}

export async function setRecordingPreference(
  key: keyof typeof PREFERENCE_KEYS,
  enabled: boolean
): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFERENCE_KEYS[key], enabled ? 'on' : 'off');
  } catch {
    // The choice just won't be remembered.
  }
  preferenceListeners.forEach((listener) => listener());
}

/** Speaks `event` when the session asked for voice cues. */
function cueEvent(current: RecordingSession | null, event: CueEvent): void {
  if (!current?.audioCues) return;
  speakRecordingCue(eventCue(i18n.t.bind(i18n), event));
}

/** Announces a newly completed kilometer or mile, if there is one. */
function cueSplit(): boolean {
  const unit = session?.audioCues;
  if (!session || !unit) return false;
  const unitMeters = cueUnitMeters(unit);
  const cued = session.cuedSplits ?? 0;
  const splits = computeSplits(points, unitMeters).filter((s) => !s.partial);
  if (splits.length <= cued) return false;
  // Several can complete in one batch after a gap; say only the latest.
  const latest = splits[splits.length - 1];
  const totalSeconds = splits.reduce((sum, s) => sum + s.durationSeconds, 0);
  session = { ...session, cuedSplits: splits.length };
  speakRecordingCue(
    splitCue(i18n.t.bind(i18n), {
      completed: splits.length,
      totalSeconds,
      splitSeconds: latest.durationSeconds,
      unit,
    })
  );
  return true;
}

/** Where the pace stands against the band; not saved, a restore starts fresh. */
let paceAlertState: PaceAlertState = INITIAL_PACE_ALERT_STATE;

let heartRateAlertState: HeartRateAlertState = INITIAL_HEART_RATE_ALERT_STATE;
let heartRateAlertStep: number | null = null;

/**
 * A reading from the paired watch for the live recording. When the heart rate
 * has been outside the range for a while the phone buzzes and, with voice
 * cues on, says so. A plan step's own range beats the run's.
 */
export function noteLiveHeartRate(
  sessionId: string,
  bpm: number
): Promise<void> {
  return enqueue(async () => {
    await hydrate();
    if (!session || session.id !== sessionId) return;
    if (session.status !== 'recording' || !(bpm > 0)) return;
    const now = Date.now();
    let band: HeartRateBand | undefined = session.heartRateBand;
    let stepIndex: number | null = null;
    if (session.intervals) {
      const position = intervalPosition(
        session.intervals.plan,
        elapsedSeconds(session, now)
      );
      if (position && !position.done) {
        stepIndex = position.index;
        if (!session.heartRateStepsOff) band = position.step.heartRate ?? band;
      }
    }
    if (stepIndex !== heartRateAlertStep) {
      heartRateAlertStep = stepIndex;
      heartRateAlertState = INITIAL_HEART_RATE_ALERT_STATE;
    }
    if (!band) return;
    const next = stepHeartRateAlert(heartRateAlertState, bpm, band, now);
    heartRateAlertState = next.state;
    if (!next.alert) return;
    fireImpactHaptic();
    if (session.audioCues) {
      speakRecordingCue(heartRateAlertCue(i18n.t.bind(i18n), next.alert));
    }
  });
}

/** Sets or clears the heart-rate range while a recording runs. */
export function setRecordingHeartRateBand(
  band: HeartRateBand | undefined
): Promise<void> {
  return enqueue(async () => {
    await hydrate();
    if (!session || session.status === 'finished') return;
    const normalized = normalizeHeartRateBand(band);
    heartRateAlertState = INITIAL_HEART_RATE_ALERT_STATE;
    const {
      heartRateBand: _previous,
      heartRateStepsOff: _stepsOff,
      ...rest
    } = session;
    void _previous;
    void _stepsOff;
    // Clearing the range is the switch going off, which also mutes the ranges
    // of a plan's steps; setting one turns it back on.
    session = normalized
      ? { ...rest, heartRateBand: normalized }
      : { ...rest, heartRateStepsOff: true };
    await persistSession();
    publish();
  });
}

/** The plan step the pace alert was last judging; a new one starts it afresh. */
let paceAlertStep: number | null = null;

/**
 * Tells the runner when the pace has been outside their band for a while:
 * a buzz always, and a spoken "ease off" / "pick it up" with voice cues on.
 * Reads the pace over the last 100 m, as the live screen does.
 */
function checkPaceBand(now: number): void {
  if (!session || session.status !== 'recording') return;
  // A plan step's own target beats the run's range; a step with none keeps
  // the run's range, if there is one.
  let band: PaceBand | undefined = session.paceBand;
  let stepIndex: number | null = null;
  if (session.intervals) {
    const position = intervalPosition(
      session.intervals.plan,
      elapsedSeconds(session, now)
    );
    if (position && !position.done) {
      stepIndex = position.index;
      if (!session.paceStepsOff) band = position.step.pace ?? band;
    }
  }
  // A new step starts the wait again, so a run that was too slow in the easy
  // stretch is not told off the moment the fast one begins.
  if (stepIndex !== paceAlertStep) {
    paceAlertStep = stepIndex;
    paceAlertState = INITIAL_PACE_ALERT_STATE;
  }
  if (!band) return;
  const pace = currentPaceSecondsPerUnit(points, 1000, 100);
  const next = stepPaceAlert(paceAlertState, pace, band, now);
  paceAlertState = next.state;
  if (!next.alert) return;
  fireImpactHaptic();
  if (session.audioCues) {
    speakRecordingCue(paceAlertCue(i18n.t.bind(i18n), next.alert));
  }
}

/**
 * Starts any interval step whose time has come: speaks it, buzzes, and marks
 * a lap at the exact moment it began, so the saved activity is cut into the
 * work and recovery stretches. Steps passed over together (a long gap in the
 * app running) are marked but only the latest is spoken. Runs on the recording
 * clock, which stops while paused. Returns whether the session changed.
 */
function advanceIntervals(now: number): boolean {
  if (!session?.intervals || session.status !== 'recording') return false;
  const { plan, cued } = session.intervals;
  const position = intervalPosition(plan, elapsedSeconds(session, now));
  if (!position) return false;
  // Once finished, the last step stays "current"; announce the end once.
  const target = position.done ? plan.steps.length : position.index;
  if (target <= cued) return false;

  const marks = [...(session.laps ?? [])];
  const clockStart = session.startedAt + session.pausedMs;
  for (
    let index = Math.max(cued + 1, 1);
    index <= Math.min(target, plan.steps.length - 1);
    index++
  ) {
    const at = clockStart + stepStartSeconds(plan, index) * 1000;
    // A manual lap nearby must not swallow the step boundary. The debounce
    // lives in markLap, for double taps.
    if (at <= now && !marks.includes(at)) {
      marks.push(at);
    }
  }
  session = {
    ...session,
    laps: marks.sort((a, b) => a - b),
    intervals: { plan, cued: target },
  };
  fireImpactHaptic();
  if (session.audioCues) {
    speakRecordingCue(
      position.done
        ? intervalsDoneCue(i18n.t.bind(i18n))
        : intervalCue(i18n.t.bind(i18n), {
            step: position.step,
            style: plan.style,
          })
    );
  }
  return true;
}

/**
 * Re-checks the interval clock. The screen calls it every second while open;
 * in the background the location task does it with each fix.
 */
export function tickIntervals(): Promise<void> {
  return enqueue(async () => {
    await hydrate();
    if (!session?.intervals) return;
    if (advanceIntervals(Date.now())) {
      await persistSession();
      publish();
    }
  });
}

function toRawFix(location: Location.LocationObject): RawFix {
  const { coords } = location;
  return {
    t: location.timestamp,
    lat: coords.latitude,
    lon: coords.longitude,
    alt: coords.altitude,
    hacc: coords.accuracy,
    vacc: coords.altitudeAccuracy,
    speed: coords.speed,
    course: coords.heading,
  };
}

interface LocationTaskBody {
  locations?: Location.LocationObject[];
}

// Defined at module scope: the OS can start the app just to deliver a fix, and
// the task has to exist before React does.
TaskManager.defineTask(GPS_RECORDING_TASK_NAME, async ({ data, error }) => {
  if (error) {
    addLog(`[GPS Recording] Location task error: ${error.message}`, 'ERROR');
    return;
  }
  const locations = (data as LocationTaskBody | undefined)?.locations;
  if (!locations || locations.length === 0) return;
  await ingestFixes(locations.map(toRawFix));
});

export interface StartRecordingOptions {
  activity: RecordingActivity;
  /** Pause automatically while the person is standing still. */
  autoPause?: boolean;
  /** Speak split times and pauses, in this unit. */
  audioCues?: CueUnit;
  /** Timed steps to follow (run/walk, speed repeats). */
  intervals?: IntervalPlan;
  /** A pace band to stay inside, with an alert when outside it. */
  paceBand?: PaceBand;
  /**
   * A heart-rate range to stay inside: the phone buzzes, and speaks when
   * voice cues are on, once a paired watch's reading has been outside it for
   * a while. Without a watch there is no reading and so no alert.
   */
  heartRateBand?: HeartRateBand;
  /** Record without GPS: no permission is asked and no location task runs. */
  indoor?: boolean;
  /** The program workout the plan came from, if any. */
  program?: { id: string; index: number };
  /** Text for the Android foreground-service notification. */
  notification: { title: string; body: string };
}

async function startUpdates(
  notification: StartRecordingOptions['notification'],
  autoPause: boolean
): Promise<void> {
  await Location.startLocationUpdatesAsync(GPS_RECORDING_TASK_NAME, {
    accuracy: Location.Accuracy.BestForNavigation,
    // A distance filter makes iOS stop delivering fixes once the person stands
    // still. Auto-pause only advances as fixes arrive, so it needs that filter
    // off or it never sees the 6 to 10 s of stillness it waits for. With
    // auto-pause off the 2 m filter stays, and `acceptFix` still keeps
    // standing-still jitter out of the track.
    distanceInterval: autoPause ? 0 : 2,
    timeInterval: 2000,
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: notification.title,
      notificationBody: notification.body,
      killServiceOnDestroy: false,
    },
  });
}

async function stopUpdates(): Promise<void> {
  try {
    if (
      await Location.hasStartedLocationUpdatesAsync(GPS_RECORDING_TASK_NAME)
    ) {
      await Location.stopLocationUpdatesAsync(GPS_RECORDING_TASK_NAME);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addLog(
      `[GPS Recording] Could not stop location updates: ${message}`,
      'WARNING'
    );
  }
}

/** Asks for location access and starts a new recording. */
export function startRecording(options: StartRecordingOptions): Promise<void> {
  return enqueue(async () => {
    await hydrate();
    if (session) throw new Error('A recording is already in progress.');
    const indoor = options.indoor === true;
    if (!indoor) {
      if (!(await Location.hasServicesEnabledAsync())) {
        throw new RecordingPermissionError(
          'services-disabled',
          'Location services are turned off.'
        );
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        throw new RecordingPermissionError(
          'denied',
          'Location permission was not granted.'
        );
      }
    }
    const now = Date.now();
    // A new recording starts the alerts afresh: the state (and its epoch-ms
    // waits) belongs to the run that ended, not this one.
    paceAlertState = INITIAL_PACE_ALERT_STATE;
    paceAlertStep = null;
    heartRateAlertState = INITIAL_HEART_RATE_ALERT_STATE;
    heartRateAlertStep = null;
    // Android cannot ask later how many steps fell inside this session, so
    // the counter is read now and stored. iOS returns null here and queries
    // the window at the end. A ride has no step estimate. Failure leaves the
    // distance field empty; it must not stop the recording.
    const stepCounterAtStart = isStepActivity(options.activity)
      ? await captureStepCounterBaseline(indoor)
      : null;
    session = {
      id: `rec-${now}`,
      activity: options.activity,
      status: 'recording',
      startedAt: now,
      finishedAt: null,
      pausedAt: null,
      pausedMs: 0,
      seg: 0,
      autoPause: options.autoPause === true,
      autoPaused: false,
      audioCues: options.audioCues,
      cuedSplits: 0,
      ...(options.intervals && isValidIntervalPlan(options.intervals)
        ? { intervals: { plan: options.intervals, cued: -1 } }
        : {}),
      ...(options.program && options.intervals
        ? { program: options.program }
        : {}),
      ...(normalizePaceBand(options.paceBand)
        ? { paceBand: normalizePaceBand(options.paceBand)! }
        : {}),
      ...(normalizeHeartRateBand(options.heartRateBand)
        ? { heartRateBand: normalizeHeartRateBand(options.heartRateBand)! }
        : {}),
      savedEntryId: null,
      ...(indoor && { indoor: true }),
      ...(stepCounterAtStart != null && { stepCounterAtStart }),
    };
    autoPauseState = INITIAL_AUTO_PAUSE_STATE;
    autoPauseFixStats = { withSpeed: 0, withoutSpeed: 0, inaccurate: 0 };
    latestFix = null;
    clearLatestFix();
    points = [];
    await persistSession();
    if (!indoor) {
      try {
        await startUpdates(options.notification, options.autoPause === true);
      } catch (error) {
        session = null;
        await persistSession();
        throw error;
      }
    }
    await persistSession();
    publish();
    if (options.audioCues) {
      beginRecordingCues();
      // With a plan, the first step's cue is the start; saying both would cut
      // one off.
      if (!session.intervals) cueEvent(session, 'started');
    }
    if (session.intervals && advanceIntervals(Date.now())) {
      await persistSession();
      publish();
    }
    addLog(
      `[GPS Recording] Started ${indoor ? 'indoor ' : ''}${options.activity} recording`,
      'INFO'
    );
  });
}

/** Whether the location task is currently registered with the OS. */
async function updatesRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(
      GPS_RECORDING_TASK_NAME
    );
  } catch {
    return false;
  }
}

/**
 * Pausing only flips the session status; the location task keeps running and
 * `ingestFixes` drops its fixes until the person resumes. Stopping the task
 * here would make resume start it again, and that cannot be done from the
 * background: iOS ignores a while-using location start made out of sight, and
 * Android 12+ refuses to start a foreground service. A resume sent from the
 * watch with the phone locked would then either throw or leave a recording
 * that never receives a fix.
 */
export function pauseRecording(): Promise<void> {
  return enqueue(async () => {
    await hydrate();
    if (!session || session.status !== 'recording') return;
    const now = Date.now();
    // Mark steps that already came due, while pausedMs still excludes this pause.
    advanceIntervals(now);
    session = {
      ...session,
      status: 'paused',
      pausedAt: now,
      autoPaused: false,
      hadPause: true,
    };
    autoPauseState = INITIAL_AUTO_PAUSE_STATE;
    await persistSession();
    publish();
    cueEvent(session, 'paused');
  });
}

export function resumeRecording(
  notification: StartRecordingOptions['notification']
): Promise<void> {
  return enqueue(async () => {
    await hydrate();
    if (!session || session.status !== 'paused') return;
    const paused = session;
    const now = Date.now();
    session = {
      ...paused,
      status: 'recording',
      pausedMs: paused.pausedMs + (now - (paused.pausedAt ?? now)),
      pausedAt: null,
      seg: paused.seg + 1,
      autoPaused: false,
    };
    autoPauseState = INITIAL_AUTO_PAUSE_STATE;
    await persistSession();
    try {
      // The task normally survived the pause. It only needs starting again
      // when the OS or a relaunch dropped it in the meantime.
      // An indoor session never had a task to restart.
      if (!paused.indoor && !(await updatesRunning())) {
        await startUpdates(notification, paused.autoPause === true);
      }
    } catch (error) {
      // Stay paused so the person can try again, and make sure no
      // half-started task is left running.
      session = paused;
      await persistSession();
      await stopUpdates();
      throw error;
    }
    publish();
    cueEvent(session, 'resumed');
  });
}

/**
 * Turns auto-pause on or off while a recording runs. The detector starts over,
 * so turning it back on never acts on stillness from before. Turning it off
 * while it holds the session paused resumes the session, since nothing else
 * would. An indoor session has no fixes to judge by and stays off.
 *
 * The running location task is started again with the distance filter that
 * goes with the new setting: with the 2 m filter left on, a person standing
 * still gets no fixes and auto-pause would never trigger. This is only called
 * from the Record screen, so the app is in the foreground and may do that.
 */
export async function setRecordingAutoPause(
  enabled: boolean,
  notification: StartRecordingOptions['notification']
): Promise<void> {
  const heldByIt = await enqueue(async () => {
    await hydrate();
    if (!session || session.status === 'finished') return false;
    if (enabled && session.indoor) return false;
    if ((session.autoPause === true) === enabled) return false;
    const held = !enabled && session.status === 'paused' && session.autoPaused;
    session = { ...session, autoPause: enabled };
    autoPauseState = INITIAL_AUTO_PAUSE_STATE;
    await persistSession();
    publish();
    if (!session.indoor && (await updatesRunning())) {
      try {
        await startUpdates(notification, enabled);
      } catch (error) {
        // The setting still holds; auto-pause only misses a stop that
        // brings no fixes until the task is next started.
        const message = error instanceof Error ? error.message : String(error);
        addLog(
          `[GPS Recording] Could not change the distance filter: ${message}`,
          'WARNING'
        );
      }
    }
    return held === true;
  });
  if (heldByIt) await resumeRecording(notification);
}

/**
 * Turns voice cues on (in `unit`) or off while a recording runs. Turning them
 * on counts the splits already completed as said, so none is announced late.
 */
export function setRecordingAudioCues(
  unit: CueUnit | undefined
): Promise<void> {
  return enqueue(async () => {
    await hydrate();
    if (!session || session.status === 'finished') return;
    if (session.audioCues === unit) return;
    const wasOn = session.audioCues != null;
    session = {
      ...session,
      audioCues: unit,
      cuedSplits: unit
        ? computeSplits(points, cueUnitMeters(unit)).filter((s) => !s.partial)
            .length
        : session.cuedSplits,
    };
    await persistSession();
    publish();
    if (unit && !wasOn) beginRecordingCues();
    if (!unit && wasOn) stopRecordingCues();
  });
}

/** Sets or clears the pace band while a recording runs. */
export function setRecordingPaceBand(
  band: PaceBand | undefined
): Promise<void> {
  return enqueue(async () => {
    await hydrate();
    if (!session || session.status === 'finished') return;
    const normalized = normalizePaceBand(band);
    paceAlertState = INITIAL_PACE_ALERT_STATE;
    const { paceBand: _previous, paceStepsOff: _stepsOff, ...rest } = session;
    void _previous;
    void _stepsOff;
    session = normalized
      ? { ...rest, paceBand: normalized }
      : { ...rest, paceStepsOff: true };
    await persistSession();
    publish();
  });
}

/** Presses closer together than this are one press (a double tap). */
const MIN_LAP_GAP_MS = 3000;

/**
 * Marks a lap at this moment. Only while recording: a lap pressed during a
 * pause has no distance to measure. Returns the new lap number, or null when
 * the press was ignored.
 */
export function markLap(pressedAt?: number): Promise<number | null> {
  return enqueue(async () => {
    await hydrate();
    if (!session || session.status !== 'recording') return null;
    const now = Date.now();
    // A press made on the watch can arrive late over the queued transport, so
    // it carries when it was pressed. Anything in the future or before the
    // recording began is a bad clock, and counts as now.
    const at =
      pressedAt !== undefined &&
      Number.isFinite(pressedAt) &&
      pressedAt >= session.startedAt &&
      pressedAt <= now + 5000
        ? Math.min(pressedAt, now)
        : now;
    const laps = session.laps ?? [];
    // Also drops a re-delivered copy of a press already taken.
    if (laps.some((mark) => Math.abs(mark - at) < MIN_LAP_GAP_MS)) {
      return null;
    }
    const marks = [...laps, at].sort((a, b) => a - b);
    session = { ...session, laps: marks };
    await persistSession();
    publish();
    if (session.audioCues) {
      const unit = session.audioCues;
      const marked = computeLaps(points, session.laps ?? []);
      const lastPointT = points[points.length - 1]?.t;
      // A mark after the newest fix is not a boundary of its own. Only the
      // first such mark owns the partial lap; a later one has nothing new,
      // and an earlier mark out of order must not steal it. A later press can
      // arrive first and already have announced that same trailing lap.
      const partialAlreadyCued =
        lastPointT !== undefined &&
        session.cuedPartialLapMark !== undefined &&
        session.cuedPartialLapMark >= lastPointT;
      const firstUnrepresentedMark =
        lastPointT === undefined
          ? undefined
          : marks.find((mark) => mark >= lastPointT);
      const lap =
        marked.find((item) => item.endT === at) ??
        (!partialAlreadyCued && firstUnrepresentedMark === at
          ? marked.find((item) => item.partial)
          : undefined);
      if (lap) {
        if (lap.partial) {
          session = { ...session, cuedPartialLapMark: at };
          await persistSession();
          publish();
        }
        speakRecordingCue(
          lapCue(i18n.t.bind(i18n), {
            number: lap.index,
            distanceMeters: lap.distanceMeters,
            seconds: lap.durationSeconds,
            unit,
          })
        );
      }
    }
    return marks.length;
  });
}

/** Stops collecting. The track stays on disk until it is saved or discarded. */
export function finishRecording(): Promise<void> {
  return enqueue(async () => {
    await hydrate();
    if (!session || session.status === 'finished') return;
    const now = Date.now();
    // A paused finish ends the clock at `pausedAt`, so the final pause is
    // already excluded: adding it to `pausedMs` would remove it twice.
    // `hadPause` still has to remember it. A stride learned from GPS would
    // otherwise treat steps that never happened during the pause as movement.
    const hadPause =
      session.hadPause === true ||
      session.status === 'paused' ||
      session.pausedMs > 0;
    const pausedMs = session.pausedMs;
    session = {
      ...session,
      status: 'finished',
      finishedAt: session.status === 'paused' ? (session.pausedAt ?? now) : now,
      pausedAt: null,
      autoPaused: false,
      pausedMs,
      ...(hadPause && { hadPause: true }),
    };
    await persistSession();
    await stopUpdates();
    publish();
    if (session.autoPause) {
      const stats = autoPauseFixStats;
      addLog(
        `[GPS Recording] Auto-pause looked at ${stats.withSpeed} fixes with a speed, ${stats.withoutSpeed} without one and ${stats.inaccurate} too inaccurate`,
        'INFO'
      );
    }
    autoPauseFixStats = { withSpeed: 0, withoutSpeed: 0, inaccurate: 0 };
    clearLatestFix();
    // An indoor session has no GPS distance yet. Stop the cue session without
    // announcing zero before the person enters what the machine showed.
    if (session.audioCues && session.indoor) {
      endRecordingCues();
    } else if (session.audioCues) {
      const summary = summarizeRecording(points);
      speakRecordingCue(
        finishCue(i18n.t.bind(i18n), {
          distanceMeters: summary.distanceMeters,
          totalSeconds: elapsedSeconds(session),
          unit: session.audioCues,
        }),
        endRecordingCues
      );
    }
  });
}

/**
 * Adds a batch of watch heart-rate readings to the recording. Ignored when the
 * batch belongs to a different recording or was already taken. Still accepted
 * after Finish: the watch's last batch is often queued and lands late.
 */
export function addHeartRateSamples(
  sessionId: string,
  batchId: string,
  readings: readonly RecordedHeartRate[]
): Promise<void> {
  return enqueue(async () => {
    await hydrate();
    if (!session || session.id !== sessionId) return;
    if (batchId && heartRate.batchIds.includes(batchId)) return;
    const valid = readings.filter(
      (reading) =>
        Number.isFinite(reading.t) && reading.bpm > 0 && reading.bpm < 300
    );
    if (valid.length === 0) return;
    heartRate = {
      samples: [...heartRate.samples, ...valid].sort((a, b) => a.t - b.t),
      batchIds: batchId
        ? [...heartRate.batchIds, batchId].slice(-MAX_BATCH_IDS)
        : heartRate.batchIds,
    };
    await AsyncStorage.setItem(HEART_RATE_KEY, JSON.stringify(heartRate));
  });
}

/** Heart-rate readings collected so far, oldest first. */
export async function getHeartRateSamples(): Promise<RecordedHeartRate[]> {
  await queue.catch(() => undefined);
  await hydrate();
  return heartRate.samples.slice();
}

/** Records that the diary entry exists, so a retried save only re-sends the track. */
export function markRecordingSaved(entryId: string): Promise<void> {
  return enqueue(async () => {
    if (!session) return;
    session = { ...session, savedEntryId: entryId };
    await persistSession();
    publish();
  });
}

/** Drops the session and every stored point. */
export function discardRecording(): Promise<void> {
  return enqueue(async () => {
    await hydrate();
    await stopUpdates();
    stopRecordingCues();
    await clearStoredPoints();
    await AsyncStorage.removeItem(HEART_RATE_KEY);
    session = null;
    points = [];
    heartRate = { samples: [], batchIds: [] };
    await persistSession();
    publish();
  });
}

/** Seconds on the clock for a session, with pauses removed. */
export function elapsedSeconds(
  current: RecordingSession,
  now: number = Date.now()
): number {
  const end =
    current.status === 'finished'
      ? (current.finishedAt ?? now)
      : current.status === 'paused'
        ? (current.pausedAt ?? now)
        : now;
  return Math.max(0, (end - current.startedAt - current.pausedMs) / 1000);
}

/** Test seam: forgets in-memory state so the next call re-reads storage. */
export function resetRecordingStateForTests(): void {
  session = null;
  points = [];
  heartRate = { samples: [], batchIds: [] };
  autoPauseState = INITIAL_AUTO_PAUSE_STATE;
  autoPauseFixStats = { withSpeed: 0, withoutSpeed: 0, inaccurate: 0 };
  paceAlertState = INITIAL_PACE_ALERT_STATE;
  paceAlertStep = null;
  heartRateAlertState = INITIAL_HEART_RATE_ALERT_STATE;
  heartRateAlertStep = null;
  hydrated = null;
  queue = Promise.resolve();
  publish();
}
