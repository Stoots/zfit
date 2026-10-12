import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { trainingProgramInputSchema } from '@workspace/shared';
import type { TrainingProgram, TrainingProgramInput } from '@workspace/shared';
import type { WorkoutPlanTemplate } from '@/types/workout';
import { Button } from '@/components/ui/button';
import PhaseEditor from './PhaseEditor';
import ProgramHeaderFields from './ProgramHeaderFields';
import { move, toProgramInput, useProgramDraft } from './useProgramDraft';

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
  const { draft, setDraft, changePhase, changeWeek, changeSession } =
    useProgramDraft(initial);
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
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const converted = toProgramInput(draft);
    if ('unselected' in converted) {
      setErrors(
        converted.unselected.map((where) =>
          t('trainingPrograms.planRequired', {
            ...where,
            defaultValue:
              'Phase {{phase}}, week {{week}}, session {{session}}: choose a Workout Plan.',
          })
        )
      );
      return;
    }
    const parsed = trainingProgramInputSchema.safeParse(converted.input);
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
        <ProgramHeaderFields
          draft={draft}
          hasRecordedSessions={recordedIds.size > 0}
          onChange={(patch) =>
            setDraft((current) => ({ ...current, ...patch }))
          }
        />
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
            <PhaseEditor
              key={phase.id ?? p}
              phase={phase}
              index={p}
              draft={draft}
              plans={plans}
              recordedIds={recordedIds}
              onChangePhase={(update) => changePhase(p, update)}
              onChangeWeek={(w, update) => changeWeek(p, w, update)}
              onChangeSession={(w, s, patch) => changeSession(p, w, s, patch)}
              onMovePhase={(delta) =>
                setDraft((current) => ({
                  ...current,
                  phases: move(current.phases, p, delta),
                }))
              }
              onRemovePhase={() =>
                setDraft((current) => ({
                  ...current,
                  phases: current.phases.filter((_, index) => index !== p),
                }))
              }
              onError={setErrors}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                phases: [...current.phases, { name: '', goal: '', weeks: [] }],
              }))
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
