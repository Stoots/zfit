import { useState } from 'react';
import { addDays, cardioTestTypeSchema, todayInZone } from '@workspace/shared';
import type { TrainingProgram, TrainingProgramInput } from '@workspace/shared';

type InputPhase = TrainingProgramInput['phases'][number];
type InputWeek = InputPhase['weeks'][number];
type InputSession = InputWeek['sessions'][number];

/** Draft sessions choose an exact Workout Session or a supported test. */
export type SessionDraft = Omit<
  InputSession,
  'workout_session_id' | 'cardio_test_type'
> & {
  workout_session_id: string | null;
  cardio_test_type: string | null;
};
export type WeekDraft = Omit<InputWeek, 'sessions'> & {
  sessions: SessionDraft[];
};
export type PhaseDraft = Omit<InputPhase, 'weeks'> & { weeks: WeekDraft[] };
export type ProgramDraft = Omit<TrainingProgramInput, 'phases'> & {
  phases: PhaseDraft[];
};

export function move<T>(items: T[], index: number, delta: number): T[] {
  const copy = [...items];
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  [copy[index], copy[target]] = [copy[target]!, copy[index]!];
  return copy;
}

function initialDraft(initial?: TrainingProgram): ProgramDraft {
  const today = todayInZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  return initial
    ? {
        name: initial.name,
        goal: initial.goal,
        start_date: initial.start_date,
        end_date: initial.end_date,
        schedule_type: 'fixed',
        auto_shift: initial.auto_shift,
        phases: initial.phases.map((phase) => ({
          id: phase.id,
          name: phase.name,
          goal: phase.goal,
          weeks: phase.weeks.map((week) => ({
            id: week.id,
            start_date: week.start_date,
            end_date: week.end_date,
            sessions: week.sessions.map((session) => ({
              id: session.id,
              name: session.name,
              scheduled_date: session.scheduled_date,
              is_optional: session.is_optional,
              workout_session_id: session.workout_session_id,
              cardio_test_type: session.cardio_test_type,
            })),
          })),
        })),
      }
    : {
        name: '',
        goal: '',
        start_date: today,
        end_date: addDays(today, 27),
        schedule_type: 'fixed',
        auto_shift: false,
        phases: [],
      };
}

export interface UnselectedPlan {
  phase: number;
  week: number;
  session: number;
}

/** Converts the draft to the API input, or lists sessions with no plan chosen. */
export function toProgramInput(
  draft: ProgramDraft
): { input: TrainingProgramInput } | { unselected: UnselectedPlan[] } {
  const unselected: UnselectedPlan[] = [];
  const phases: TrainingProgramInput['phases'] = draft.phases.map(
    (phase, p) => ({
      ...phase,
      weeks: phase.weeks.map((week, w) => ({
        ...week,
        sessions: week.sessions.flatMap((session, s) => {
          if (!session.workout_session_id && !session.cardio_test_type) {
            unselected.push({ phase: p + 1, week: w + 1, session: s + 1 });
            return [];
          }
          return [
            {
              ...session,
              workout_session_id: session.workout_session_id,
              cardio_test_type: session.cardio_test_type
                ? cardioTestTypeSchema.parse(session.cardio_test_type)
                : undefined,
            },
          ];
        }),
      })),
    })
  );
  return unselected.length > 0
    ? { unselected }
    : { input: { ...draft, phases } };
}

export function useProgramDraft(initial?: TrainingProgram) {
  const [draft, setDraft] = useState<ProgramDraft>(() => initialDraft(initial));
  const changePhase = (
    index: number,
    update: (phase: PhaseDraft) => PhaseDraft
  ) => {
    setDraft((current) => ({
      ...current,
      phases: current.phases.map((phase, p) =>
        p === index ? update(phase) : phase
      ),
    }));
  };
  const changeWeek = (
    p: number,
    w: number,
    update: (week: WeekDraft) => WeekDraft
  ) => {
    changePhase(p, (phase) => ({
      ...phase,
      weeks: phase.weeks.map((week, index) =>
        index === w ? update(week) : week
      ),
    }));
  };
  const changeSession = (
    p: number,
    w: number,
    s: number,
    patch: Partial<SessionDraft>
  ) => {
    changeWeek(p, w, (week) => ({
      ...week,
      sessions: week.sessions.map((item, i) =>
        i === s ? { ...item, ...patch } : item
      ),
    }));
  };
  return { draft, setDraft, changePhase, changeWeek, changeSession };
}
