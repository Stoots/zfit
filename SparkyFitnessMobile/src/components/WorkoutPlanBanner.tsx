import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, Pressable } from 'react-native';
import { useCSSVariable } from 'uniwind';
import Icon from './Icon';
import BottomSheetPicker from './BottomSheetPicker';
import type {
  WorkoutPlanSession,
  WorkoutPlanTemplate,
} from '../types/workoutPlans';

interface WorkoutPlanBannerProps {
  plan: WorkoutPlanTemplate;
  /** Program-bound plans start the exact scheduled session; standalone plans
   * allow the user to choose another session. */
  allowSessionPicker: boolean;
  onPressPlanSession?: (
    plan: WorkoutPlanTemplate,
    session: WorkoutPlanSession
  ) => void;
}

function getDistinctSessionsForPlan(
  plan: WorkoutPlanTemplate,
  allowSessionPicker: boolean
): WorkoutPlanSession[] {
  if (allowSessionPicker) return plan.sessions;
  return plan.next_session ? [plan.next_session] : [];
}

const WorkoutPlanBanner: React.FC<WorkoutPlanBannerProps> = ({
  plan,
  allowSessionPicker,
  onPressPlanSession,
}) => {
  const { t } = useTranslation();
  const [accentPrimary, textMuted] = useCSSVariable([
    '--color-accent-primary',
    '--color-text-muted',
  ]) as [string, string];
  const activeAccent = accentPrimary || '#3B82F6';
  const activeMuted = textMuted || '#6B7280';
  const [selectedId, setSelectedId] = useState('');

  const distinctSessions = getDistinctSessionsForPlan(plan, allowSessionPicker);
  const currentSessionId =
    (allowSessionPicker ? selectedId : '') ||
    plan.next_session?.id ||
    plan.sessions[0]?.id;
  const currentSession =
    distinctSessions.find((session) => session.id === currentSessionId) ||
    distinctSessions[0];

  if (!currentSession) return null;

  const sessionTitle =
    currentSession.name || t('exerciseSummary.title', 'Exercise');
  const sessionOptions = distinctSessions.map((session) => ({
    label: session.name,
    value: session.id,
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
              ? t(
                  'exerciseSummary.sessionNumber',
                  'Session {{current}} of {{total}}',
                  {
                    current: plan.sequence_position?.current ?? 1,
                    total:
                      plan.sequence_position?.total ?? plan.sessions.length,
                  }
                )
              : t('exerciseSummary.scheduledToday', 'Scheduled Today')}
            {plan.schedule_type === 'sequential' && plan.sequence_position && (
              <Text className="text-text-muted font-normal">
                {' '}
                ({plan.sequence_position.current}/{plan.sequence_position.total}
                )
              </Text>
            )}
          </Text>
        </View>
      </View>

      <View className="flex-row items-center justify-between">
        {distinctSessions.length > 1 ? (
          <View className="flex-1 mr-2">
            <BottomSheetPicker
              value={currentSession.id}
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

        {onPressPlanSession && (
          <Pressable
            onPress={() => onPressPlanSession(plan, currentSession)}
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
