import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, Pressable } from 'react-native';
import { useCSSVariable } from 'uniwind';
import Icon from './Icon';
import BottomSheetPicker from './BottomSheetPicker';
import type {
  WorkoutPlanAssignment,
  WorkoutPlanTemplate,
} from '../types/workoutPlans';

interface WorkoutPlanBannerProps {
  plan: WorkoutPlanTemplate;
  /** Standalone plans let the user pick another session; a Program's next
   * workout is fixed by its schedule. */
  allowSessionPicker: boolean;
  onPressPlanAssignment?: (
    plan: WorkoutPlanTemplate,
    assignment: WorkoutPlanAssignment
  ) => void;
}

function getDistinctSessionsForPlan(
  plan: WorkoutPlanTemplate
): WorkoutPlanAssignment[] {
  if (!plan.assignments || plan.assignments.length === 0) return [];
  if (plan.schedule_type === 'sequential') {
    const seen = new Set<number>();
    const result: WorkoutPlanAssignment[] = [];
    for (const a of plan.assignments) {
      const idx = a.session_index ?? 1;
      if (!seen.has(idx)) {
        seen.add(idx);
        result.push(a);
      }
    }
    return result;
  }
  if (plan.next_assignments && plan.next_assignments.length > 0) {
    return plan.next_assignments;
  }
  return plan.next_assignment ? [plan.next_assignment] : [];
}

const WorkoutPlanBanner: React.FC<WorkoutPlanBannerProps> = ({
  plan,
  allowSessionPicker,
  onPressPlanAssignment,
}) => {
  const { t } = useTranslation();
  const [accentPrimary, textMuted] = useCSSVariable([
    '--color-accent-primary',
    '--color-text-muted',
  ]) as [string, string];
  const activeAccent = accentPrimary || '#3B82F6';
  const activeMuted = textMuted || '#6B7280';
  const [selectedId, setSelectedId] = useState('');

  const distinctSessions = allowSessionPicker
    ? getDistinctSessionsForPlan(plan)
    : [];
  const currentAssignmentId =
    selectedId ||
    (plan.next_assignment?.id ? String(plan.next_assignment.id) : '');
  const currentAssignment =
    distinctSessions.find((a) => String(a.id) === currentAssignmentId) ||
    plan.next_assignment ||
    distinctSessions[0];

  if (!currentAssignment) return null;

  const sessionLabel = (session: WorkoutPlanAssignment) =>
    session.session_name ||
    (session.session_index != null
      ? t('exerciseSummary.sessionNumberIndex', 'Session {{current}}', {
          current: session.session_index,
        })
      : null) ||
    session.workout_preset_name ||
    session.exercise_name ||
    '';

  const sessionTitle =
    sessionLabel(currentAssignment) || t('exerciseSummary.title', 'Exercise');

  const sessionOptions = distinctSessions.map((session) => ({
    label: sessionLabel(session),
    value: String(session.id),
  }));

  return (
    <View className="bg-surface rounded-xl p-4 mb-2 shadow-sm">
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center gap-1.5 flex-1">
          <Icon
            name={plan.schedule_type === 'sequential' ? 'repeat' : 'calendar'}
            size={14}
            color={activeAccent}
          />
          <Text
            className="text-xs font-semibold text-text-secondary"
            numberOfLines={1}
          >
            {plan.plan_name} •{' '}
            {plan.schedule_type === 'sequential'
              ? plan.sequence_position?.session_name ||
                plan.next_assignment?.session_name ||
                t(
                  'exerciseSummary.sessionNumber',
                  'Session {{current}} of {{total}}',
                  {
                    current: plan.sequence_position?.current ?? 1,
                    total:
                      plan.sequence_position?.total ??
                      plan.assignments?.length ??
                      1,
                  }
                )
              : t('exerciseSummary.scheduledToday', 'Scheduled Today')}
            {plan.schedule_type === 'sequential' &&
              (plan.sequence_position?.session_name ||
                plan.next_assignment?.session_name) &&
              plan.sequence_position && (
                <Text className="text-text-muted font-normal">
                  {' '}
                  ({plan.sequence_position.current}/
                  {plan.sequence_position.total})
                </Text>
              )}
          </Text>
        </View>
      </View>

      <View className="flex-row items-center justify-between">
        {distinctSessions.length > 1 ? (
          <View className="flex-1 mr-2">
            <BottomSheetPicker
              value={String(currentAssignment.id)}
              options={sessionOptions}
              title={t('exerciseSummary.selectSession', 'Select Session')}
              onSelect={(val) => setSelectedId(String(val))}
              renderTrigger={({ onPress }) => (
                <Pressable
                  onPress={onPress}
                  accessibilityRole="button"
                  className="flex-row items-center gap-1.5 py-0.5 active:opacity-70"
                >
                  <Text
                    className="text-text-primary text-base font-bold shrink"
                    numberOfLines={1}
                  >
                    {sessionTitle}
                  </Text>
                  <Icon name="chevron-down" size={14} color={activeMuted} />
                </Pressable>
              )}
            />
          </View>
        ) : (
          <Text
            className="text-text-primary text-base font-bold flex-1 mr-2"
            numberOfLines={1}
          >
            {sessionTitle}
          </Text>
        )}

        {onPressPlanAssignment && (
          <Pressable
            onPress={() => onPressPlanAssignment(plan, currentAssignment)}
            accessibilityRole="button"
            className="px-3.5 py-1.5 rounded-lg flex-row items-center gap-1.5 active:opacity-80 shadow-sm"
            style={{ backgroundColor: activeAccent }}
          >
            <Icon name="play" size={13} color="#ffffff" />
            <Text className="text-white text-xs font-bold">
              {t('exerciseSummary.startWorkout', { defaultValue: 'Start' })}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
};

export default WorkoutPlanBanner;
