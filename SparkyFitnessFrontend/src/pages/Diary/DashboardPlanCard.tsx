import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ChevronDown, Play, Repeat } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { WorkoutPlanSession, WorkoutPlanTemplate } from '@/types/workout';

interface DashboardPlanCardProps {
  plan: WorkoutPlanTemplate;
  /** Program-bound plans start the exact scheduled session; standalone plans
   * let the user choose any session. */
  allowSessionPicker: boolean;
  startingSessionId: string | null;
  onStart: (plan: WorkoutPlanTemplate, session: WorkoutPlanSession) => void;
}

interface DistinctSession {
  session: WorkoutPlanSession;
  name: string;
  isSuggested: boolean;
}

const DashboardPlanCard = ({
  plan,
  allowSessionPicker,
  startingSessionId,
  onStart,
}: DashboardPlanCardProps) => {
  const { t } = useTranslation();
  const [selectedSessionId, setSelectedSessionId] = useState<string>();

  const distinctSessions = useMemo<DistinctSession[]>(
    () =>
      allowSessionPicker
        ? plan.sessions.map((session) => ({
            session,
            name: session.name,
            isSuggested: session.id === plan.next_session?.id,
          }))
        : [],
    [allowSessionPicker, plan]
  );
  const currentSession =
    (allowSessionPicker
      ? distinctSessions.find((item) => item.session.id === selectedSessionId)
          ?.session
      : undefined) ||
    plan.next_session ||
    distinctSessions[0]?.session;
  if (!currentSession) return null;

  const sessionName =
    currentSession.name ||
    t('exerciseCard.scheduledWorkout', 'Workout Session');
  const sessionIndex = Math.max(
    plan.sessions.findIndex((session) => session.id === currentSession.id) + 1,
    1
  );
  const totalSessions = plan.sessions.length;
  return (
    <div
      className="mb-3 p-3.5 rounded-lg border bg-muted/40 hover:bg-muted/60 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      data-testid={`dashboard-plan-${plan.id}`}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="text-xs font-semibold gap-1">
            {plan.schedule_type === 'sequential' ? (
              <>
                <Repeat className="h-3 w-3 text-primary" />
                {t('exerciseCard.upNextInPlanBadge', 'Plan Up Next')}
              </>
            ) : (
              <>
                <CalendarDays className="h-3 w-3 text-primary" />
                {t('exerciseCard.scheduledTodayBadge', 'Scheduled Today')}
              </>
            )}
          </Badge>
          {distinctSessions.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 font-semibold text-sm gap-1 hover:bg-muted/80 text-foreground"
                >
                  <span>{sessionName}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  {t(
                    'exerciseCard.switchSessionLabel',
                    'Switch / Pick Session:'
                  )}
                </div>
                {distinctSessions.map((sessionItem, index) => (
                  <DropdownMenuItem
                    key={sessionItem.session.id || index}
                    onClick={() => setSelectedSessionId(sessionItem.session.id)}
                    className="flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <span className="truncate">
                      {index + 1}. {sessionItem.name}
                    </span>
                    {sessionItem.isSuggested && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 shrink-0"
                      >
                        {t('exerciseCard.suggestedBadge', 'Suggested')}
                      </Badge>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="font-semibold text-sm">{sessionName}</span>
          )}
          {plan.schedule_type === 'sequential' && (
            <span className="text-xs text-muted-foreground font-medium">
              ({sessionIndex} of {totalSessions})
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {plan.schedule_type === 'sequential'
            ? t('exerciseCard.activePlanHint', 'Sequential plan: {{name}}', {
                name: plan.plan_name,
              })
            : t('exerciseCard.activeWeeklyPlanHint', 'Active plan: {{name}}', {
                name: plan.plan_name,
              })}
        </p>
      </div>
      <div className="flex items-center shrink-0">
        <Button
          size="sm"
          variant="default"
          aria-label={t('exerciseCard.startExactSession', {
            name: sessionName,
            number: sessionIndex,
            total: totalSessions,
            plan: plan.plan_name,
            defaultValue: `Start Workout: ${sessionName} (session ${sessionIndex} of ${totalSessions}) — ${plan.plan_name}`,
          })}
          disabled={startingSessionId === currentSession.id}
          onClick={() => onStart(plan, currentSession)}
        >
          <Play className="w-3.5 h-3.5 mr-1" />
          {startingSessionId === currentSession.id
            ? t('common.loading', 'Starting…')
            : t('exerciseCard.startWorkoutButton', 'Start Workout')}
        </Button>
      </div>
    </div>
  );
};

export default DashboardPlanCard;
