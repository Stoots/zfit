import { useCallback, useEffect, useRef } from 'react';
import WatchConnectivity, {
  type WatchWorkoutStartRequestedPayload,
} from '../../modules/watch-connectivity';
import { queryClient } from './queryClient';
import { workoutPresetsQueryKey } from './queryKeys';
import { fetchWorkoutPlanCandidates } from '../services/api/workoutPlansApi';
import { getWorkoutPresetById } from '../services/api/workoutPresetsApi';
import { getActiveServerConfigId } from '../services/storage';
import { useActiveWorkoutStore } from '../stores/activeWorkoutStore';
import type { WorkoutPresetsResponse } from '../types/workoutPresets';
import {
  buildPresetLiveExerciseConfigs,
  buildPresetStartExercisesPayload,
} from '../utils/workoutSession';
import { getTodayDate } from '../utils/dateUtils';
import { buildWorkoutPlanSessionStart } from '../utils/workoutPlanSession';
import { getLoggedAssignmentIds } from '../utils/workoutPlanSchedule';
import type { StartLiveWorkoutArgs } from './useStartLiveWorkout';

type StartFn = (args: StartLiveWorkoutArgs) => Promise<void>;

/**
 * Starts exact frozen plan sessions from opaque `session:<UUID>` tokens.
 * Numeric tokens start unlinked library presets, never inferred plan assignments.
 * Offline taps wait for reconnect; duplicate deliveries for the exact active
 * assignment identity are ignored without conflating sessions sharing a preset.
 */
export function useWatchWorkoutStart(
  enabled: boolean,
  connected: boolean,
  start: StartFn
): void {
  const startRef = useRef(start);
  const connectedRef = useRef(connected);
  useEffect(() => {
    startRef.current = start;
    connectedRef.current = connected;
  });
  const pendingRef = useRef<WatchWorkoutStartRequestedPayload | null>(null);
  const generationRef = useRef(0);

  const run = useCallback(
    async (payload: WatchWorkoutStartRequestedPayload) => {
      const generation = generationRef.current;
      const serverId = payload.serverId;
      const sessionId = payload.presetId.startsWith('session:')
        ? payload.presetId.slice('session:'.length)
        : null;
      const presetId =
        sessionId == null && /^[1-9]\d*$/.test(payload.presetId)
          ? Number(payload.presetId)
          : null;
      if (!serverId || (sessionId == null && !Number.isSafeInteger(presetId)))
        return;
      if (sessionId === '') return;
      if (
        generation !== generationRef.current ||
        (await getActiveServerConfigId()) !== serverId
      )
        return;

      let args: StartLiveWorkoutArgs;
      let assignmentIds: Set<string> | null = null;
      try {
        if (sessionId != null) {
          const plans = await fetchWorkoutPlanCandidates(getTodayDate());
          const session = plans
            .flatMap((plan) => plan.sessions)
            .find((item) => item.id === sessionId);
          if (!session) return;
          args = buildWorkoutPlanSessionStart(session);
          assignmentIds = new Set(
            session.assignments.map((item) => String(item.id))
          );
        } else {
          const cached = queryClient.getQueryData<WorkoutPresetsResponse>(
            workoutPresetsQueryKey
          );
          const preset =
            cached?.presets.find((item) => item.id === presetId) ??
            (await getWorkoutPresetById(presetId!));
          args = {
            name: preset.name,
            exercises: buildPresetStartExercisesPayload(preset),
            exerciseConfigs: buildPresetLiveExerciseConfigs(preset),
            sourcePresetId: preset.id,
            workoutFormat: preset.workout_format ?? 'standard',
            timeCapSeconds: preset.time_cap_seconds ?? null,
          };
        }
      } catch {
        // An unavailable session or frozen prescription must not start a library fallback.
        return;
      }
      if (
        args.exercises.length === 0 ||
        (await getActiveServerConfigId()) !== serverId ||
        generation !== generationRef.current
      )
        return;
      const live = useActiveWorkoutStore.getState();
      if (live.sessionId != null) {
        if (assignmentIds != null) {
          const liveIds = getLoggedAssignmentIds(
            live.session ? [live.session] : []
          );
          if (
            assignmentIds.size > 0 &&
            assignmentIds.size === liveIds.size &&
            [...assignmentIds].every((id) => liveIds.has(id))
          )
            return;
        } else if (live.sourcePresetId === presetId) {
          return;
        }
      }
      await startRef.current(args);
    },
    []
  );

  useEffect(() => {
    if (!enabled || !WatchConnectivity?.isSupported()) return;
    const watch = WatchConnectivity;
    const sub = watch.addListener('onWorkoutStartRequested', (payload) => {
      if (!connectedRef.current) {
        pendingRef.current = payload;
        return;
      }
      void run(payload);
    });
    return () => {
      generationRef.current += 1;
      sub.remove();
    };
  }, [enabled, run]);

  useEffect(() => {
    if (!enabled || !connected) return;
    const pending = pendingRef.current;
    if (pending == null) return;
    pendingRef.current = null;
    void run(pending);
  }, [enabled, connected, run]);
}
