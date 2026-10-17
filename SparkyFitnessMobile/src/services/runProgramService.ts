import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  storedProgramStatus,
  type ProgramStatus,
  type RunProgramAdjustment,
  type RunProgramResponse,
} from '@workspace/shared';
import { queryClient } from '../hooks/queryClient';
import { toLocalDateString } from '../utils/dateUtils';
import { programWorkoutForEntry } from '../utils/runProgramSummary';
import { runProgramQueryKey } from '../hooks/queryKeys';
import {
  fetchRunProgram,
  markRunProgramWorkoutDone,
  rateRunProgramWorkout,
  saveRunProgram,
} from './api/runProgramApi';

/**
 * The person's run program and place in it. It lives on the server so the AI
 * assistant can adjust upcoming workouts and every device agrees on where they
 * are; this keeps the React Query copy in step after each change. The Diary
 * schedule (run days and first day) is kept with the program.
 */

const setCache = (program: RunProgramResponse | null) => {
  // A read that began before this write must not land after it and put the
  // old state back (a screen mounting while a tick-off is in flight).
  void queryClient.cancelQueries({ queryKey: runProgramQueryKey });
  queryClient.setQueryData(runProgramQueryKey, program);
};

async function load(): Promise<RunProgramResponse | null> {
  return (await fetchRunProgram()).program;
}

/**
 * Changes when the Diary offers the workout: the weekdays (none = whenever),
 * the first day (null = from today) and the goal day (null = none). Kept with
 * the program on the server.
 */
export interface ProgramScheduleChange {
  days?: number[];
  /** Flips one weekday on the server's current days (0 = Sunday). */
  toggleDay?: number;
  startDay?: string | null;
  endDay?: string | null;
}

// Schedule changes run one at a time: two quick taps on the weekday chips must
// each build on the result of the one before, not on the same stale copy.
let scheduleQueue: Promise<unknown> = Promise.resolve();

export function setProgramSchedule(
  change: ProgramScheduleChange
): Promise<void> {
  const run = scheduleQueue.then(() => applySchedule(change));
  scheduleQueue = run.catch(() => undefined);
  return run;
}

async function applySchedule(change: ProgramScheduleChange): Promise<void> {
  const current = await freshProgram();
  if (!current) return;
  const days =
    change.toggleDay !== undefined
      ? current.run_days.includes(change.toggleDay)
        ? current.run_days.filter((d) => d !== change.toggleDay)
        : [...current.run_days, change.toggleDay].sort((a, b) => a - b)
      : change.days;
  setCache(
    (
      await saveRunProgram({
        program_id: current.program_id,
        run_days: days,
        start_date: change.startDay,
        end_date: change.endDay,
      })
    ).program
  );
}

/** The stored program as the server has it now, not as this device last saw it. */
const freshProgram = (): Promise<RunProgramResponse | null> =>
  queryClient.fetchQuery({
    queryKey: runProgramQueryKey,
    queryFn: load,
    staleTime: 0,
  });

const syncedToolCalls = new Set<string>();

/** The assistant may have changed the program: drop the cached copy, once per tool call. */
export function syncAfterAssistantChange(toolCallId: string): void {
  if (syncedToolCalls.has(toolCallId)) return;
  syncedToolCalls.add(toolCallId);
  void queryClient.invalidateQueries({ queryKey: runProgramQueryKey });
}

/** The program being used, or null when none is chosen or it is switched off. */
export async function getProgramStatus(): Promise<ProgramStatus | null> {
  const program = await freshProgram();
  return program?.enabled ? storedProgramStatus(program) : null;
}

/**
 * Switches the program on or off. Turning it on for the first time starts
 * `programId` from its first workout; after that it picks up where the person
 * left off. Turning it off keeps their place.
 */
export async function setProgramEnabled(
  enabled: boolean,
  programId: string
): Promise<void> {
  const current = await freshProgram();
  if (!current && !enabled) return;
  setCache(
    (
      await saveRunProgram({
        program_id: current?.program_id ?? programId,
        enabled,
      })
    ).program
  );
}

/**
 * Starts `programId` from its first workout and switches it on. Choosing the
 * program already held just switches it on and keeps the place; choosing a
 * different one replaces it (the server reseeds the workouts and the place).
 * `startDay` sets the first day (null = today); leave it out to keep the
 * schedule as it is.
 */
export async function startProgram(
  programId: string,
  startDay?: string | null
): Promise<void> {
  setCache(
    (
      await saveRunProgram({
        program_id: programId,
        enabled: true,
        start_date: startDay,
      })
    ).program
  );
}

/** Jumps to any workout (0-based), to repeat one or start further in. */
export async function setProgramPosition(index: number): Promise<void> {
  const current = await freshProgram();
  if (!current) return;
  setCache(
    (
      await saveRunProgram({
        program_id: current.program_id,
        next_index: Math.max(0, Math.floor(index)),
      })
    ).program
  );
}

/** Goes back to the first workout, keeping the program switched on. */
export const restartProgram = (): Promise<void> => setProgramPosition(0);

/** Skips the workout that is due. */
export async function skipProgramWorkout(): Promise<void> {
  const current = await freshProgram();
  if (current) await setProgramPosition(current.next_index + 1);
}

/**
 * Records workout `index` as done, if it is the one that was due. `entryId` is
 * the diary entry it was done as, so that entry shows as part of the program.
 */
export async function completeProgramWorkout(
  programId: string,
  index: number,
  day: string = toLocalDateString(new Date()),
  entryId?: string
): Promise<void> {
  // The local day is sent so the Diary stops offering the next workout for the
  // rest of that day, on every device.
  setCache(
    (
      await markRunProgramWorkoutDone({
        index,
        program_id: programId,
        day,
        entry_id: entryId,
      })
    ).program
  );
}

/**
 * Saves how hard finished workout `index` felt and returns the program as the
 * server now holds it (unchanged if that workout cannot be rated).
 */
export async function rateProgramWorkout(
  programId: string,
  index: number,
  rating: number
): Promise<RunProgramResponse | null> {
  const program = (
    await rateRunProgramWorkout({ index, rating, program_id: programId })
  ).program;
  setCache(program);
  return program;
}

/** The current program status, or null when none is active. */
export function useRunProgram(): {
  /** The place in the program, even while it is switched off. */
  status: ProgramStatus | null;
  /** Whether the person is using it. */
  enabled: boolean;
  /** The most recent change to the workouts or place made by Sparky or the person, if any. */
  lastAdjustment: RunProgramAdjustment | null;
  /** When the Diary offers the workout: weekdays (empty = every day) and first day. */
  schedule: {
    days: number[];
    startDay: string | null;
    endDay: string | null;
  };
  /** The local day a program workout was last completed, or null. */
  doneDay: string | null;
  loaded: boolean;
  refetch: () => Promise<unknown>;
} {
  const { data, isSuccess, refetch } = useQuery({
    queryKey: runProgramQueryKey,
    queryFn: load,
    // Always re-read on opening a screen: the assistant may have changed it.
    staleTime: 0,
  });
  return {
    status: data ? storedProgramStatus(data) : null,
    enabled: data?.enabled ?? false,
    lastAdjustment: data?.adjustment_log.at(-1) ?? null,
    schedule: {
      days: data?.run_days ?? [],
      startDay: data?.start_date ?? null,
      endDay: data?.end_date ?? null,
    },
    doneDay: data?.last_done_date ?? null,
    loaded: isSuccess,
    refetch,
  };
}

/**
 * The program workout a diary entry was done as (its `workout` is that one),
 * or null when the entry is not part of the person's program.
 */
export function useProgramWorkoutForEntry(
  entryId: string | undefined
): ProgramStatus | null {
  const { data } = useQuery({
    queryKey: runProgramQueryKey,
    queryFn: load,
    staleTime: 60_000,
    enabled: entryId != null,
  });
  return useMemo(
    () => (data && entryId ? programWorkoutForEntry(data, entryId) : null),
    [data, entryId]
  );
}
