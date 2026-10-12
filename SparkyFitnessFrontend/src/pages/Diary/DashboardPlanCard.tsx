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
import type {
  WorkoutPlanAssignment,
  WorkoutPlanTemplate,
} from '@/types/workout';

interface DashboardPlanCardProps {
  plan: WorkoutPlanTemplate;
  /**
   * Standalone plans let the user pick any session; the next Training Program
   * workout is a fixed preview that always starts `plan.next_assignment`.
   */
  allowSessionPicker: boolean;
  onStart: (
    plan: WorkoutPlanTemplate,
    assignment: WorkoutPlanAssignment
  ) => void;
}

interface DistinctSession {
  assignment: WorkoutPlanAssignment;
  sessionIndex: number;
  name: string;
  exerciseCount: number;
  isSuggested: boolean;
}

const DashboardPlanCard = ({
  plan,
  allowSessionPicker,
  onStart,
}: DashboardPlanCardProps) => {
  const { t } = useTranslation();
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<
    string | number | undefined
  >(undefined);

  const distinctSessions = useMemo<DistinctSession[]>(() => {
    if (!allowSessionPicker) return [];
    if (!plan.assignments || plan.assignments.length === 0) return [];
    const map = new Map<number | string, DistinctSession>();

    for (const a of plan.assignments) {
      const key =
        plan.schedule_type === 'sequential'
          ? (a.session_index ?? 0)
          : (a.day_of_week ?? 0);
      const isSuggested =
        plan.schedule_type === 'sequential'
          ? (a.session_index ?? 0) ===
            (plan.next_assignment?.session_index ?? 0)
          : a.id === plan.next_assignment?.id;

      const existing = map.get(key);
      if (existing) {
        existing.exerciseCount += 1;
        if (isSuggested) existing.isSuggested = true;
      } else {
        const name =
          a.session_name ||
          a.workout_preset_name ||
          a.exercise_name ||
          (plan.schedule_type === 'sequential'
            ? t('exerciseCard.sessionNumber', {
                num: a.session_index ?? 1,
                defaultValue: `Session ${a.session_index ?? 1}`,
              })
            : t('exerciseCard.dayNumber', {
                num: (a.day_of_week ?? 0) + 1,
                defaultValue: `Day ${(a.day_of_week ?? 0) + 1}`,
              }));
        map.set(key, {
          assignment: a,
          sessionIndex: a.session_index ?? 1,
          name,
          exerciseCount: 1,
          isSuggested,
        });
      }
    }
    return Array.from(map.values());
  }, [allowSessionPicker, plan, t]);

  const currentAssignmentId =
    selectedAssignmentId ||
    (plan.next_assignment?.id ? String(plan.next_assignment.id) : '');
  const currentSessionItem =
    distinctSessions.find(
      (s) => String(s.assignment.id) === String(currentAssignmentId)
    ) ||
    distinctSessions.find(
      (s) => String(s.assignment.id) === String(plan.next_assignment?.id)
    ) ||
    distinctSessions[0];
  const currentAssignment =
    currentSessionItem?.assignment || plan.next_assignment;
  if (!currentAssignment) return null;

  const sessionName =
    currentAssignment.session_name ||
    currentAssignment.workout_preset_name ||
    currentAssignment.exercise_name ||
    t('exerciseCard.scheduledWorkout', 'Workout Session');

  const sessionIndex =
    currentAssignment.session_index ?? (plan.sequence_position?.current || 1);
  const totalSessions =
    plan.sequence_position?.total ?? distinctSessions.length ?? 1;

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
                    key={sessionItem.assignment.id || index}
                    onClick={() =>
                      setSelectedAssignmentId(sessionItem.assignment.id ?? '')
                    }
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
          onClick={() => onStart(plan, currentAssignment)}
        >
          <Play className="w-3.5 h-3.5 mr-1" />
          {t('exerciseCard.startWorkoutButton', 'Start Workout')}
        </Button>
      </div>
    </div>
  );
};

export default DashboardPlanCard;
