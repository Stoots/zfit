import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WorkoutPlanTemplate } from '@/types/workout';
import ProgramItemControls from './ProgramItemControls';
import SessionRow from './SessionRow';
import { move } from './useProgramDraft';
import type { SessionDraft, WeekDraft } from './useProgramDraft';

export default function WeekEditor({
  week,
  phaseIndex: p,
  weekIndex: w,
  weekCount,
  programStart,
  programEnd,
  plans,
  recordedIds,
  onChangeWeek,
  onChangeSession,
  onRemove,
  onMove,
}: {
  week: WeekDraft;
  phaseIndex: number;
  weekIndex: number;
  weekCount: number;
  programStart: string;
  programEnd: string;
  plans: WorkoutPlanTemplate[];
  recordedIds: Set<string>;
  onChangeWeek: (update: (week: WeekDraft) => WeekDraft) => void;
  onChangeSession: (s: number, patch: Partial<SessionDraft>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}) {
  const { t } = useTranslation();
  const isRecorded = (session: SessionDraft) =>
    !!session.id && recordedIds.has(session.id);
  return (
    <fieldset className="min-w-0 space-y-4 rounded-md bg-muted/30 p-4">
      <legend className="font-semibold">
        {t('trainingPrograms.weekNumber', {
          number: w + 1,
          defaultValue: 'Week {{number}}',
        })}
      </legend>
      <ProgramItemControls
        kind="week"
        index={w}
        length={weekCount}
        onMove={onMove}
        onRemove={onRemove}
        preserveHistory={week.sessions.some(isRecorded)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`week-${p}-${w}-start`}>
            {t('trainingPrograms.weekStart', 'Week start date')}
          </Label>
          <Input
            id={`week-${p}-${w}-start`}
            type="date"
            min={programStart}
            max={programEnd}
            value={week.start_date}
            onChange={(e) =>
              onChangeWeek((current) => ({
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
            max={programEnd}
            value={week.end_date}
            onChange={(e) =>
              onChangeWeek((current) => ({
                ...current,
                end_date: e.target.value,
              }))
            }
          />
        </div>
      </div>
      {week.sessions.map((session, s) => (
        <SessionRow
          key={session.id ?? s}
          session={session}
          prefix={`session-${p}-${w}-${s}`}
          index={s}
          count={week.sessions.length}
          weekStart={week.start_date}
          weekEnd={week.end_date}
          plans={plans}
          locked={isRecorded(session)}
          onChange={(patch) => onChangeSession(s, patch)}
          onMove={(delta) =>
            onChangeWeek((current) => ({
              ...current,
              sessions: move(current.sessions, s, delta),
            }))
          }
          onRemove={() =>
            onChangeWeek((current) => ({
              ...current,
              sessions: current.sessions.filter((_, index) => index !== s),
            }))
          }
        />
      ))}
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        disabled={!plans.some((plan) => plan.sessions.length > 0)}
        onClick={() =>
          onChangeWeek((current) => ({
            ...current,
            sessions: [
              ...current.sessions,
              {
                name: '',
                scheduled_date: current.start_date,
                workout_session_id: null,
              },
            ],
          }))
        }
      >
        {t('trainingPrograms.addSession', 'Add Planned Session')}
      </Button>
    </fieldset>
  );
}
