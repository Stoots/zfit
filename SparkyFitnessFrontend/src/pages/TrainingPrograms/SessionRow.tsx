import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
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
    <fieldset className="min-w-0 space-y-3 border-t pt-4 sm:pl-5">
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
      <div className="min-w-0 grid gap-2 border-b py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start sm:gap-4">
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
      <div className="min-w-0">
        <div className="min-w-0 grid gap-2 border-b py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start sm:gap-4">
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
        <div className="min-w-0 grid gap-2 border-b py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start sm:gap-4">
          <Label htmlFor={`${prefix}-session`}>
            {t('trainingPrograms.workoutSession', 'Workout Session')}
          </Label>
          <select
            id={`${prefix}-session`}
            disabled={locked}
            className="flex h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={session.workout_session_id ?? ''}
            onChange={(event) => {
              const workout_session_id = event.target.value || null;
              const selectedSession = plans
                .flatMap((plan) => plan.sessions)
                .find((item) => item.id === workout_session_id);
              onChange({
                workout_session_id,
                ...(session.workout_session_id === null && selectedSession
                  ? { is_optional: selectedSession.is_optional }
                  : {}),
              });
            }}
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
      <div className="flex min-h-11 items-center gap-2">
        <Checkbox
          id={`${prefix}-optional`}
          disabled={locked}
          checked={session.is_optional}
          onCheckedChange={(checked) =>
            onChange({ is_optional: checked === true })
          }
        />
        <Label htmlFor={`${prefix}-optional`}>
          {t('trainingPrograms.optional', 'Optional')}
        </Label>
      </div>
    </fieldset>
  );
}
