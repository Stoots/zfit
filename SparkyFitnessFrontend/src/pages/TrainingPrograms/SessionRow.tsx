import { useTranslation } from 'react-i18next';
import { cardioTestTypeSchema } from '@workspace/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WorkoutPlanTemplate } from '@/types/workout';
import ProgramItemControls from './ProgramItemControls';
import type { SessionDraft } from './useProgramDraft';
import { cardioTestTitle } from './cardioTestTitle';

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
          <Label htmlFor={`${prefix}-kind`}>
            {t('trainingPrograms.sessionKind', 'Session type')}
          </Label>
          <select
            id={`${prefix}-kind`}
            disabled={locked}
            className="flex h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={session.cardio_test_type ? 'cardio' : 'workout'}
            onChange={(event) =>
              onChange({
                workout_session_id: null,
                cardio_test_type:
                  event.target.value === 'cardio'
                    ? cardioTestTypeSchema.options[0]!
                    : null,
                is_optional: false,
              })
            }
          >
            <option value="workout">
              {t('trainingPrograms.workout', 'Workout')}
            </option>
            <option value="cardio">
              {t('trainingPrograms.cardioTest', 'Cardio Test')}
            </option>
          </select>
        </div>
        <div className="min-w-0 grid gap-2 border-b py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start sm:gap-4">
          {session.cardio_test_type ? (
            <>
              <Label htmlFor={`${prefix}-protocol`}>
                {t('trainingPrograms.protocol', 'Cardio Test protocol')}
              </Label>
              <select
                id={`${prefix}-protocol`}
                disabled={locked}
                value={session.cardio_test_type}
                onChange={(event) =>
                  onChange({ cardio_test_type: event.target.value })
                }
                className="flex h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {cardioTestTypeSchema.options.map((protocol) => (
                  <option key={protocol} value={protocol}>
                    {cardioTestTitle(protocol, t)}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
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
                    cardio_test_type: null,
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
            </>
          )}
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
