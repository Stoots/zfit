import { useTranslation } from 'react-i18next';
import { addDays, isDayString } from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { WorkoutPlanTemplate } from '@/types/workout';
import ProgramItemControls from './ProgramItemControls';
import WeekEditor from './WeekEditor';
import { move } from './useProgramDraft';
import type {
  PhaseDraft,
  ProgramDraft,
  SessionDraft,
  WeekDraft,
} from './useProgramDraft';

export default function PhaseEditor({
  phase,
  index: p,
  draft,
  plans,
  recordedIds,
  onChangePhase,
  onChangeWeek,
  onChangeSession,
  onMovePhase,
  onRemovePhase,
  onError,
}: {
  phase: PhaseDraft;
  index: number;
  draft: ProgramDraft;
  plans: WorkoutPlanTemplate[];
  recordedIds: Set<string>;
  onChangePhase: (update: (phase: PhaseDraft) => PhaseDraft) => void;
  onChangeWeek: (w: number, update: (week: WeekDraft) => WeekDraft) => void;
  onChangeSession: (w: number, s: number, patch: Partial<SessionDraft>) => void;
  onMovePhase: (delta: number) => void;
  onRemovePhase: () => void;
  onError: (messages: string[]) => void;
}) {
  const { t } = useTranslation();
  const addWeek = () => {
    const last = draft.phases
      .slice(0, p + 1)
      .flatMap((item) => item.weeks)
      .at(-1);
    if (
      !isDayString(draft.start_date) ||
      !isDayString(draft.end_date) ||
      (last && !isDayString(last.end_date))
    ) {
      onError([
        t(
          'trainingPrograms.weekDateRequired',
          'Enter valid Program and week dates before adding another week.'
        ),
      ]);
      return;
    }
    const start = last ? addDays(last.end_date, 1) : draft.start_date;
    const end = addDays(start, 6);
    onChangePhase((current) => ({
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
  };
  return (
    <fieldset className="min-w-0 space-y-5 border-t pt-5">
      <legend className="pt-4 text-lg font-semibold">
        {t('trainingPrograms.phaseNumber', {
          number: p + 1,
          defaultValue: 'Phase {{number}}',
        })}
      </legend>
      <ProgramItemControls
        kind="phase"
        index={p}
        length={draft.phases.length}
        onMove={onMovePhase}
        onRemove={onRemovePhase}
        preserveHistory={phase.weeks.some((week) =>
          week.sessions.some(
            (session) => !!session.id && recordedIds.has(session.id)
          )
        )}
      />
      <div>
        <Label htmlFor={`phase-${p}-name`}>
          {t('trainingPrograms.phaseName', 'Phase name')}
        </Label>
        <Input
          id={`phase-${p}-name`}
          value={phase.name}
          maxLength={200}
          onChange={(e) =>
            onChangePhase((current) => ({ ...current, name: e.target.value }))
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
            onChangePhase((current) => ({ ...current, goal: e.target.value }))
          }
        />
      </div>
      {phase.weeks.map((week, w) => (
        <WeekEditor
          key={week.id ?? w}
          week={week}
          phaseIndex={p}
          weekIndex={w}
          weekCount={phase.weeks.length}
          programStart={draft.start_date}
          programEnd={draft.end_date}
          plans={plans}
          recordedIds={recordedIds}
          onChangeWeek={(update) => onChangeWeek(w, update)}
          onChangeSession={(s, patch) => onChangeSession(w, s, patch)}
          onMove={(delta) =>
            onChangePhase((current) => ({
              ...current,
              weeks: move(current.weeks, w, delta),
            }))
          }
          onRemove={() =>
            onChangePhase((current) => ({
              ...current,
              weeks: current.weeks.filter((_, index) => index !== w),
            }))
          }
        />
      ))}
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        onClick={addWeek}
      >
        {t('trainingPrograms.addWeek', 'Add week')}
      </Button>
    </fieldset>
  );
}
