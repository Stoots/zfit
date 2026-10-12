import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, Pressable } from 'react-native';
import { useCSSVariable } from 'uniwind';
import {
  selectDashboardWorkoutPlans,
  type ExerciseSessionResponse,
} from '@workspace/shared';
import Icon from './Icon';
import WorkoutPlanBanner from './WorkoutPlanBanner';
import SwipeableExerciseRow from './SwipeableExerciseRow';
import type { GetImageSource } from '../hooks/useExerciseImageSource';
import { useActiveWorkoutPlans } from '../hooks/useActiveWorkoutPlan';
import { useTrainingPrograms } from '../hooks/useTrainingPrograms';
import type {
  WorkoutPlanAssignment,
  WorkoutPlanTemplate,
} from '../types/workoutPlans';
import {
  getLoggedAssignmentIds,
  getUncompletedActivePlans,
} from '../utils/workoutPlanSchedule';

interface ExerciseSummaryProps {
  exerciseEntries: ExerciseSessionResponse[];
  entryDate: string;
  onPressWorkout?: (session: ExerciseSessionResponse) => void;
  onAddExercise?: () => void;
  onPressPlanAssignment?: (
    plan: WorkoutPlanTemplate,
    assignment: WorkoutPlanAssignment
  ) => void;
  getImageSource?: GetImageSource;
  weightUnit?: 'kg' | 'lbs';
  distanceUnit?: 'km' | 'miles';
}

const ExerciseSummary: React.FC<ExerciseSummaryProps> = ({
  exerciseEntries,
  entryDate,
  onPressWorkout,
  onAddExercise,
  onPressPlanAssignment,
  getImageSource,
  weightUnit = 'kg',
  distanceUnit = 'km',
}) => {
  const { t } = useTranslation();
  const accentPrimary = useCSSVariable('--color-accent-primary') as string;
  const { plans: activePlans } = useActiveWorkoutPlans(entryDate);
  const { data: trainingPrograms, isError: programsFailed } =
    useTrainingPrograms();
  const { programPlan, standalonePlans } = useMemo(() => {
    const eligible = getUncompletedActivePlans(
      activePlans,
      getLoggedAssignmentIds(exerciseEntries)
    );
    // A failed Programs read falls back to the pre-Programs behaviour; while
    // it loads, show nothing rather than flash plans a Program may own.
    if (programsFailed) {
      return { programPlan: undefined, standalonePlans: eligible };
    }
    if (!trainingPrograms) {
      return { programPlan: undefined, standalonePlans: [] };
    }
    return selectDashboardWorkoutPlans(eligible, trainingPrograms);
  }, [activePlans, exerciseEntries, trainingPrograms, programsFailed]);

  const planBanners =
    programPlan || standalonePlans.length > 0 ? (
      <View className="mb-2">
        {programPlan && (
          <WorkoutPlanBanner
            key={programPlan.id}
            plan={programPlan}
            allowSessionPicker={false}
            onPressPlanAssignment={onPressPlanAssignment}
          />
        )}
        {standalonePlans.map((plan) => (
          <WorkoutPlanBanner
            key={plan.id}
            plan={plan}
            allowSessionPicker
            onPressPlanAssignment={onPressPlanAssignment}
          />
        ))}
      </View>
    ) : null;

  if (exerciseEntries.length === 0) {
    const emptyContent = (
      <Text className="text-text-muted text-base">
        {t('exerciseSummary.tapToAdd', { defaultValue: 'Tap to add exercise' })}
      </Text>
    );
    return (
      <View>
        {planBanners}
        {onAddExercise ? (
          <Pressable
            onPress={onAddExercise}
            accessibilityRole="button"
            accessibilityLabel={t('exerciseSummary.addExercise', {
              defaultValue: 'Add exercise',
            })}
            className="bg-surface rounded-xl p-4 mb-2 shadow-sm items-center py-6"
          >
            {emptyContent}
          </Pressable>
        ) : (
          <View className="bg-surface rounded-xl p-4 mb-2 shadow-sm items-center py-6">
            {emptyContent}
          </View>
        )}
      </View>
    );
  }

  return (
    <View>
      {planBanners}
      <View className="bg-surface rounded-xl p-4 mb-2 shadow-sm overflow-hidden">
        <View className="flex-row items-center gap-2 mb-2">
          <Icon name="exercise" size={18} color={accentPrimary} />
          <Text className="text-base font-bold text-text-secondary">
            {t('exerciseSummary.title', { defaultValue: 'Exercise' })}
          </Text>
        </View>
        {exerciseEntries.map((session, index) => (
          <SwipeableExerciseRow
            key={session.id || index}
            session={session}
            entryDate={entryDate}
            onPress={() => onPressWorkout?.(session)}
            getImageSource={getImageSource}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
          />
        ))}
      </View>
    </View>
  );
};

export default ExerciseSummary;
