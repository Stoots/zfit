import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addDays,
  isDayString,
  todayInZone,
  trainingProgramInputSchema,
} from '@workspace/shared';
import type { TrainingProgram, TrainingProgramInput } from '@workspace/shared';
import type { WorkoutPlanTemplate } from '@/types/workout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowUp, ArrowDown, Trash2 } from 'lucide-react';

type Phase = TrainingProgramInput['phases'][number];
type Week = Phase['weeks'][number];

function move<T>(items: T[], index: number, delta: number): T[] {
  const copy = [...items];
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  [copy[index], copy[target]] = [copy[target]!, copy[index]!];
  return copy;
}

export default function TrainingProgramEditor({
  initial,
  plans,
  pending,
  onSave,
  onCancel,
}: {
  initial?: TrainingProgram;
  plans: WorkoutPlanTemplate[];
  pending: boolean;
  onSave: (input: TrainingProgramInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<TrainingProgramInput>(() => {
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
                workout_plan_id: session.workout_plan_id,
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
  });
  const [errors, setErrors] = useState<string[]>([]);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length > 0) errorSummaryRef.current?.focus();
  }, [errors]);
  const recordedIds = new Set(
    initial?.phases.flatMap((phase) =>
      phase.weeks.flatMap((week) =>
        week.sessions
          .filter((session) => session.status !== 'planned')
          .map((session) => session.id)
      )
    ) ?? []
  );
  const changePhase = (index: number, update: (phase: Phase) => Phase) => {
    setDraft((current) => ({
      ...current,
      phases: current.phases.map((phase, p) =>
        p === index ? update(phase) : phase
      ),
    }));
  };
  const changeWeek = (p: number, w: number, update: (week: Week) => Week) => {
    changePhase(p, (phase) => ({
      ...phase,
      weeks: phase.weeks.map((week, index) =>
        index === w ? update(week) : week
      ),
    }));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = trainingProgramInputSchema.safeParse(draft);
    if (!parsed.success) {
      setErrors(
        parsed.error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`
        )
      );
      return;
    }
    setErrors([]);
    try {
      await onSave(parsed.data);
    } catch (error) {
      setErrors([
        error instanceof Error
          ? error.message
          : t(
              'trainingPrograms.saveError',
              'Could not save. Please try again.'
            ),
      ]);
    }
  };
  const controls = (
    kind: 'phase' | 'week' | 'session',
    index: number,
    length: number,
    onMove: (delta: number) => void,
    onRemove: () => void,
    preserveHistory = false
  ) => (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        className="min-h-11 min-w-11"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        aria-label={t('trainingPrograms.moveUp', {
          kind,
          number: index + 1,
          defaultValue: 'Move {{kind}} {{number}} up',
        })}
      >
        <ArrowUp className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 min-w-11"
        disabled={index === length - 1}
        onClick={() => onMove(1)}
        aria-label={t('trainingPrograms.moveDown', {
          kind,
          number: index + 1,
          defaultValue: 'Move {{kind}} {{number}} down',
        })}
      >
        <ArrowDown className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="min-h-11"
        onClick={onRemove}
        disabled={preserveHistory}
        aria-label={t('trainingPrograms.removeItem', {
          kind,
          number: index + 1,
          defaultValue: 'Remove {{kind}} {{number}}',
        })}
      >
        <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
        {t('common.remove', 'Remove')}
      </Button>
    </div>
  );
  return (
    <form onSubmit={submit} className="space-y-8" noValidate>
      <div>
        <h2 className="text-2xl font-semibold">
          {initial
            ? t('trainingPrograms.edit', 'Edit Training Program')
            : t('trainingPrograms.create', 'Create Training Program')}
        </h2>
        <p className="mt-2 max-w-prose text-muted-foreground">
          {t(
            'trainingPrograms.fixedHelp',
            'Fixed dates: Planned Sessions stay on the calendar dates you choose. Editing a date range does not shift sessions.'
          )}
        </p>
      </div>
      {errors.length > 0 && (
        <div
          id="program-errors"
          ref={errorSummaryRef}
          role="alert"
          tabIndex={-1}
          className="rounded-md border border-destructive p-4 text-destructive"
        >
          <p className="font-semibold">
            {t(
              'trainingPrograms.fixErrors',
              'Review these fields before saving:'
            )}
          </p>
          <ul className="list-disc pl-5">
            {errors.map((message, i) => (
              <li key={i}>{message}</li>
            ))}
          </ul>
        </div>
      )}
      <fieldset disabled={pending} className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="program-name">
              {t('trainingPrograms.name', 'Program name')}
            </Label>
            <Input
              id="program-name"
              value={draft.name}
              maxLength={200}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="program-goal">
              {t('trainingPrograms.goal', 'Program goal')}
            </Label>
            <Textarea
              id="program-goal"
              value={draft.goal}
              maxLength={2000}
              onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
              required
            />
          </div>
          <div>
            <Label htmlFor="program-start">
              {t('trainingPrograms.startDate', 'Program start date')}
            </Label>
            <Input
              id="program-start"
              type="date"
              value={draft.start_date}
              onChange={(e) =>
                setDraft({ ...draft, start_date: e.target.value })
              }
              required
            />
          </div>
          <div>
            <Label htmlFor="program-end">
              {t('trainingPrograms.endDate', 'Program end date')}
            </Label>
            <Input
              id="program-end"
              type="date"
              value={draft.end_date}
              min={draft.start_date}
              onChange={(e) => setDraft({ ...draft, end_date: e.target.value })}
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label
            className="flex min-h-11 items-center gap-3"
            htmlFor="program-auto-shift"
          >
            <input
              id="program-auto-shift"
              type="checkbox"
              className="h-5 w-5"
              checked={draft.auto_shift ?? false}
              onChange={(event) =>
                setDraft({ ...draft, auto_shift: event.target.checked })
              }
            />
            {t('trainingPrograms.autoShift', 'Auto-shift after a miss')}
          </Label>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t(
              'trainingPrograms.shiftHelp',
              'Off by default. Each new miss moves later still-planned sessions forward one calendar day, even beyond the authored week or Program. Same-day, missed and completed sessions stay unchanged.'
            )}
          </p>
          {recordedIds.size > 0 && (
            <p className="text-sm text-muted-foreground">
              {t(
                'trainingPrograms.historyHelp',
                'Recorded sessions and their containing weeks/phases cannot be removed. Their names, authored dates and Workout Plans are locked. Future authored date edits reset that session’s shifted date; other edits preserve the resulting schedule.'
              )}
            </p>
          )}
        </div>
        <section
          aria-label={t('trainingPrograms.phases', 'Program phases')}
          className="space-y-6"
        >
          <div>
            <h3 className="text-xl font-semibold">
              {t('trainingPrograms.phases', 'Program phases')}
            </h3>
            <p className="mt-1 text-muted-foreground">
              {t(
                'trainingPrograms.structureHelp',
                'Build phases around goals, then add chronological weeks and dated sessions. You can save an unfinished structure and continue authoring later.'
              )}
            </p>
          </div>
          {draft.phases.map((phase, p) => (
            <fieldset
              key={phase.id ?? p}
              className="min-w-0 space-y-5 border-t pt-5"
            >
              <legend className="pt-4 text-lg font-semibold">
                {t('trainingPrograms.phaseNumber', {
                  number: p + 1,
                  defaultValue: 'Phase {{number}}',
                })}
              </legend>
              {controls(
                'phase',
                p,
                draft.phases.length,
                (delta) =>
                  setDraft({ ...draft, phases: move(draft.phases, p, delta) }),
                () =>
                  setDraft({
                    ...draft,
                    phases: draft.phases.filter((_, index) => index !== p),
                  }),
                phase.weeks.some((week) =>
                  week.sessions.some(
                    (session) => !!session.id && recordedIds.has(session.id)
                  )
                )
              )}
              <div>
                <Label htmlFor={`phase-${p}-name`}>
                  {t('trainingPrograms.phaseName', 'Phase name')}
                </Label>
                <Input
                  id={`phase-${p}-name`}
                  value={phase.name}
                  maxLength={200}
                  onChange={(e) =>
                    changePhase(p, (current) => ({
                      ...current,
                      name: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor={`phase-${p}-goal`}>
                  {t('trainingPrograms.phaseGoal', 'Phase goal')}
                </Label>
                <Textarea
                  id={`phase-${p}-goal`}
                  value={phase.goal}
                  maxLength={2000}
                  onChange={(e) =>
                    changePhase(p, (current) => ({
                      ...current,
                      goal: e.target.value,
                    }))
                  }
                />
              </div>
              {phase.weeks.map((week, w) => (
                <fieldset
                  key={week.id ?? w}
                  className="min-w-0 space-y-4 rounded-md bg-muted/30 p-4"
                >
                  <legend className="font-semibold">
                    {t('trainingPrograms.weekNumber', {
                      number: w + 1,
                      defaultValue: 'Week {{number}}',
                    })}
                  </legend>
                  {controls(
                    'week',
                    w,
                    phase.weeks.length,
                    (delta) =>
                      changePhase(p, (current) => ({
                        ...current,
                        weeks: move(current.weeks, w, delta),
                      })),
                    () =>
                      changePhase(p, (current) => ({
                        ...current,
                        weeks: current.weeks.filter((_, index) => index !== w),
                      })),
                    week.sessions.some(
                      (session) => !!session.id && recordedIds.has(session.id)
                    )
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor={`week-${p}-${w}-start`}>
                        {t('trainingPrograms.weekStart', 'Week start date')}
                      </Label>
                      <Input
                        id={`week-${p}-${w}-start`}
                        type="date"
                        min={draft.start_date}
                        max={draft.end_date}
                        value={week.start_date}
                        onChange={(e) =>
                          changeWeek(p, w, (current) => ({
                            ...current,
                            start_date: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor={`week-${p}-${w}-end`}>
                        {t('trainingPrograms.weekEnd', 'Week end date')}
                      </Label>
                      <Input
                        id={`week-${p}-${w}-end`}
                        type="date"
                        min={week.start_date}
                        max={draft.end_date}
                        value={week.end_date}
                        onChange={(e) =>
                          changeWeek(p, w, (current) => ({
                            ...current,
                            end_date: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  {week.sessions.map((session, s) => {
                    const prefix = `session-${p}-${w}-${s}`;
                    return (
                      <fieldset
                        key={session.id ?? s}
                        className="min-w-0 space-y-3 border-t pt-4"
                      >
                        <legend className="pt-3 font-medium">
                          {t('trainingPrograms.sessionNumber', {
                            number: s + 1,
                            defaultValue: 'Planned Session {{number}}',
                          })}
                        </legend>
                        {controls(
                          'session',
                          s,
                          week.sessions.length,
                          (delta) =>
                            changeWeek(p, w, (current) => ({
                              ...current,
                              sessions: move(current.sessions, s, delta),
                            })),
                          () =>
                            changeWeek(p, w, (current) => ({
                              ...current,
                              sessions: current.sessions.filter(
                                (_, index) => index !== s
                              ),
                            })),
                          !!session.id && recordedIds.has(session.id)
                        )}
                        <div>
                          <Label htmlFor={`${prefix}-name`}>
                            {t('trainingPrograms.sessionName', 'Session name')}
                          </Label>
                          <Input
                            id={`${prefix}-name`}
                            disabled={
                              !!session.id && recordedIds.has(session.id)
                            }
                            value={session.name}
                            maxLength={200}
                            onChange={(e) =>
                              changeWeek(p, w, (current) => ({
                                ...current,
                                sessions: current.sessions.map((item, i) =>
                                  i === s
                                    ? { ...item, name: e.target.value }
                                    : item
                                ),
                              }))
                            }
                          />
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <Label htmlFor={`${prefix}-date`}>
                              {t(
                                'trainingPrograms.sessionDate',
                                'Session date'
                              )}
                            </Label>
                            <Input
                              id={`${prefix}-date`}
                              disabled={
                                !!session.id && recordedIds.has(session.id)
                              }
                              type="date"
                              min={week.start_date}
                              max={week.end_date}
                              value={session.scheduled_date}
                              onChange={(e) =>
                                changeWeek(p, w, (current) => ({
                                  ...current,
                                  sessions: current.sessions.map((item, i) =>
                                    i === s
                                      ? {
                                          ...item,
                                          scheduled_date: e.target.value,
                                        }
                                      : item
                                  ),
                                }))
                              }
                            />
                          </div>
                          <div>
                            <Label htmlFor={`${prefix}-plan`}>
                              {t(
                                'trainingPrograms.workoutPlan',
                                'Workout Plan'
                              )}
                            </Label>
                            <select
                              id={`${prefix}-plan`}
                              disabled={
                                !!session.id && recordedIds.has(session.id)
                              }
                              className="flex h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              value={session.workout_plan_id || ''}
                              onChange={(e) =>
                                changeWeek(p, w, (current) => ({
                                  ...current,
                                  sessions: current.sessions.map((item, i) =>
                                    i === s
                                      ? {
                                          ...item,
                                          workout_plan_id: Number(
                                            e.target.value
                                          ),
                                        }
                                      : item
                                  ),
                                }))
                              }
                            >
                              <option value="">
                                {t(
                                  'trainingPrograms.choosePlan',
                                  'Choose a Workout Plan'
                                )}
                              </option>
                              {plans.map((plan) => (
                                <option key={plan.id} value={plan.id}>
                                  {plan.plan_name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </fieldset>
                    );
                  })}
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={!plans.length}
                    onClick={() =>
                      changeWeek(p, w, (current) => ({
                        ...current,
                        sessions: [
                          ...current.sessions,
                          {
                            name: '',
                            scheduled_date: current.start_date,
                            workout_plan_id: 0,
                          },
                        ],
                      }))
                    }
                  >
                    {t('trainingPrograms.addSession', 'Add Planned Session')}
                  </Button>
                </fieldset>
              ))}
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  const last = draft.phases
                    .slice(0, p + 1)
                    .flatMap((item) => item.weeks)
                    .at(-1);
                  if (
                    !isDayString(draft.start_date) ||
                    !isDayString(draft.end_date) ||
                    (last && !isDayString(last.end_date))
                  ) {
                    setErrors([
                      t(
                        'trainingPrograms.weekDateRequired',
                        'Enter valid Program and week dates before adding another week.'
                      ),
                    ]);
                    return;
                  }
                  const start = last
                    ? addDays(last.end_date, 1)
                    : draft.start_date;
                  const end = addDays(start, 6);
                  changePhase(p, (current) => ({
                    ...current,
                    weeks: [
                      ...current.weeks,
                      {
                        start_date: start,
                        end_date:
                          end > draft.end_date && start <= draft.end_date
                            ? draft.end_date
                            : end,
                        sessions: [],
                      },
                    ],
                  }));
                }}
              >
                {t('trainingPrograms.addWeek', 'Add week')}
              </Button>
            </fieldset>
          ))}
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() =>
              setDraft({
                ...draft,
                phases: [...draft.phases, { name: '', goal: '', weeks: [] }],
              })
            }
          >
            {t('trainingPrograms.addPhase', 'Add phase')}
          </Button>
        </section>
        {!plans.length && (
          <p className="text-muted-foreground">
            {t(
              'trainingPrograms.noPlans',
              'Create a Workout Plan on the Exercises page before adding Planned Sessions. You can still save your Program structure.'
            )}
          </p>
        )}
        <div className="flex flex-wrap gap-3 border-t pt-5">
          <Button type="submit" className="min-h-11">
            {pending
              ? t('common.saving', 'Saving…')
              : t('trainingPrograms.save', 'Save Training Program')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={onCancel}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
