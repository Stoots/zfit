import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WorkoutPlanTemplate } from '@/types/workout';
import ProgramItemControls from './ProgramItemControls';
import type { SessionDraft } from './useProgramDraft';

export default function SessionRow({
  session,
  prefix,
  index,
  count,
  weekStart,
  weekEnd,
  plans,
  locked,
  onChange,
  onMove,
  onRemove,
}: {
  session: SessionDraft;
  prefix: string;
  index: number;
  count: number;
  weekStart: string;
  weekEnd: string;
  plans: WorkoutPlanTemplate[];
  locked: boolean;
  onChange: (patch: Partial<SessionDraft>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="min-w-0 space-y-3 border-t pt-4">
      <legend className="pt-3 font-medium">
        {t('trainingPrograms.sessionNumber', {
          number: index + 1,
          defaultValue: 'Planned Session {{number}}',
        })}
      </legend>
      <ProgramItemControls
        kind="session"
        index={index}
        length={count}
        onMove={onMove}
        onRemove={onRemove}
        preserveHistory={locked}
      />
      <div>
        <Label htmlFor={`${prefix}-name`}>
          {t('trainingPrograms.sessionName', 'Session name')}
        </Label>
        <Input
          id={`${prefix}-name`}
          disabled={locked}
          value={session.name}
          maxLength={200}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${prefix}-date`}>
            {t('trainingPrograms.sessionDate', 'Session date')}
          </Label>
          <Input
            id={`${prefix}-date`}
            disabled={locked}
            type="date"
            min={weekStart}
            max={weekEnd}
            value={session.scheduled_date}
            onChange={(e) => onChange({ scheduled_date: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor={`${prefix}-session`}>
            {t('trainingPrograms.workoutSession', 'Workout Session')}
          </Label>
          <select
            id={`${prefix}-session`}
            disabled={locked}
            className="flex h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={session.workout_session_id ?? ''}
            onChange={(event) =>
              onChange({
                workout_session_id:
                  event.target.value === '' ? null : event.target.value,
              })
            }
          >
            <option value="">
              {t(
                'trainingPrograms.chooseSession',
                'Choose an exact Workout Session'
              )}
            </option>
            {plans.flatMap((plan) =>
              plan.sessions.map((workoutSession) => (
                <option key={workoutSession.id} value={workoutSession.id}>
                  {plan.plan_name} — {workoutSession.name}
                </option>
              ))
            )}
          </select>
        </div>
      </div>
    </fieldset>
  );
}
