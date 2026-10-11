import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ScrollView, Text, View } from 'react-native';
import {
  KeyboardAvoidingView,
  KeyboardProvider,
} from 'react-native-keyboard-controller';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isDayString, type TrainingProgram } from '@workspace/shared';
import { useDailySummary } from '../hooks/useDailySummary';
import {
  dailySummaryRootQueryKey,
  exerciseHistoryQueryKey,
  trainingProgramsQueryKey,
  workoutPlanTemplatesQueryKey,
} from '../hooks/queryKeys';
import { recordTrainingProgramOutcome } from '../services/api/trainingProgramsApi';
import Button from './ui/Button';
import FormInput from './FormInput';

type Session =
  TrainingProgram['phases'][number]['weeks'][number]['sessions'][number];
type Target = { programId: string; session: Session };

function CompletionLink({
  target,
  onClose,
}: {
  target: Target;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [date, setDate] = useState(target.session.effective_date);
  const [selected, setSelected] = useState('');
  const diary = useDailySummary({ date, enabled: isDayString(date) });
  const entries = diary.summary?.exerciseEntries ?? [];
  const workout = entries.find(
    (entry) => `${entry.type}:${entry.id}` === selected
  );
  const mutation = useMutation({
    mutationFn: () => {
      if (!workout) throw new Error('Choose a completed diary workout.');
      return recordTrainingProgramOutcome(target.programId, target.session.id, {
        status: 'completed',
        workout: { type: workout.type, id: workout.id },
      });
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: trainingProgramsQueryKey }),
        client.invalidateQueries({ queryKey: workoutPlanTemplatesQueryKey }),
        client.invalidateQueries({ queryKey: exerciseHistoryQueryKey }),
        client.invalidateQueries({ queryKey: dailySummaryRootQueryKey }),
      ]);
      onClose();
    },
  });
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!mutation.isPending) onClose();
      }}
    >
      <KeyboardProvider>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <View
            className="flex-1 justify-center px-6 py-12"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          >
            <View className="bg-surface rounded-2xl p-5 max-h-[85%]">
              <Text
                accessibilityRole="header"
                className="text-lg font-semibold text-text-primary mb-2"
              >
                {t('trainingPrograms.linkCompleted', 'Link completed workout')}
              </Text>
              <Text className="text-text-secondary mb-4">
                {target.session.name} · {target.session.effective_date}
              </Text>
              <Text className="text-text-secondary mb-4">
                {t(
                  'trainingPrograms.linkHelp',
                  'Choose a workout you actually completed from your diary. Linking records completion without moving any dates.'
                )}
              </Text>
              <Text className="text-text-primary mb-2">
                {t('trainingPrograms.workoutDate', 'Diary workout date')}
              </Text>
              <FormInput
                accessibilityLabel={t(
                  'trainingPrograms.workoutDate',
                  'Diary workout date'
                )}
                value={date}
                placeholder={t(
                  'trainingPrograms.workoutDatePlaceholder',
                  'YYYY-MM-DD'
                )}
                autoCapitalize="none"
                editable={!mutation.isPending}
                onChangeText={(value) => {
                  setDate(value);
                  setSelected('');
                  mutation.reset();
                }}
              />
              <ScrollView className="mt-4" keyboardShouldPersistTaps="handled">
                {!isDayString(date) ? (
                  <Text className="text-text-secondary">
                    {t(
                      'trainingPrograms.validWorkoutDate',
                      'Enter a valid diary date.'
                    )}
                  </Text>
                ) : diary.isLoading ? (
                  <Text className="text-text-secondary">
                    {t(
                      'trainingPrograms.loadingWorkouts',
                      'Loading diary workouts…'
                    )}
                  </Text>
                ) : diary.isError ? (
                  <View>
                    <Text
                      accessibilityRole="alert"
                      className="text-text-primary"
                    >
                      {diary.error?.message}
                    </Text>
                    <Button
                      accessibilityRole="button"
                      variant="ghost"
                      onPress={() => void diary.refetch()}
                    >
                      {t('common.retry', 'Retry')}
                    </Button>
                  </View>
                ) : entries.length === 0 ? (
                  <Text className="text-text-secondary">
                    {t(
                      'trainingPrograms.noWorkouts',
                      'No diary workouts on this date. Choose another date or log your completed workout first.'
                    )}
                  </Text>
                ) : (
                  entries.map((entry) => (
                    <Button
                      key={`${entry.type}:${entry.id}`}
                      accessibilityRole="button"
                      accessibilityState={{
                        selected: selected === `${entry.type}:${entry.id}`,
                        disabled: mutation.isPending,
                      }}
                      variant={
                        selected === `${entry.type}:${entry.id}`
                          ? 'primary'
                          : 'ghost'
                      }
                      disabled={mutation.isPending}
                      onPress={() => {
                        setSelected(`${entry.type}:${entry.id}`);
                        mutation.reset();
                      }}
                    >
                      {entry.name ??
                        t(
                          'trainingPrograms.completedWorkout',
                          'Completed diary workout'
                        )}
                    </Button>
                  ))
                )}
                {mutation.isError && (
                  <Text
                    accessibilityRole="alert"
                    className="text-text-primary mt-2"
                  >
                    {mutation.error.message}
                  </Text>
                )}
              </ScrollView>
              <View className="flex-row flex-wrap justify-end gap-2 mt-4">
                <Button
                  accessibilityRole="button"
                  variant="ghost"
                  disabled={mutation.isPending}
                  onPress={onClose}
                >
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: !workout || mutation.isPending,
                  }}
                  loading={mutation.isPending}
                  variant="primary"
                  disabled={
                    !workout ||
                    !isDayString(date) ||
                    diary.isLoading ||
                    diary.isError ||
                    mutation.isPending
                  }
                  onPress={() => mutation.mutate()}
                >
                  {t(
                    'trainingPrograms.confirmCompletion',
                    'Confirm completion'
                  )}
                </Button>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </KeyboardProvider>
    </Modal>
  );
}

/** Recorded outcomes on the selected diary day come exclusively from the server. */
export default function ProgramSessionHistory({
  programs,
  entryDate,
}: {
  programs: TrainingProgram[];
  entryDate: string;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<Target | null>(null);
  const history = programs.flatMap((program) =>
    program.phases.flatMap((phase) =>
      phase.weeks.flatMap((week) =>
        week.sessions
          .filter(
            (session) =>
              session.effective_date === entryDate &&
              session.status !== 'planned'
          )
          .map((session) => ({ programId: program.id, session }))
      )
    )
  );
  if (history.length === 0) return null;
  return (
    <View className="mb-4">
      <Text
        accessibilityRole="header"
        className="text-text-primary font-semibold mb-2"
      >
        {t('trainingPrograms.history', 'Training Program history')}
      </Text>
      {history.map(({ programId, session }) => (
        <View key={session.id} className="py-3 border-b border-border-subtle">
          <Text className="text-text-primary font-semibold">
            {session.name}
          </Text>
          <Text className="text-text-secondary mt-1">
            {session.workout_plan_name} · {session.workout_session_name}
          </Text>
          <Text className="text-text-secondary mt-1">
            {session.status === 'omitted'
              ? t('trainingPrograms.state.omitted', 'Omitted')
              : session.status === 'completed'
                ? t('trainingPrograms.state.completed', 'Completed')
                : t('trainingPrograms.state.missed', 'Missed')}
            {session.is_optional
              ? ` · ${t('trainingPrograms.optional', 'Optional')}`
              : ''}
          </Text>
          {session.completed_workout && (
            <Text className="text-text-secondary mt-1">
              {session.completed_workout.name} ·{' '}
              {session.completed_workout.entry_date}
            </Text>
          )}
          {session.is_optional && session.status === 'omitted' && (
            <Button
              accessibilityRole="button"
              variant="ghost"
              onPress={() => setTarget({ programId, session })}
            >
              {t('trainingPrograms.linkCompleted', 'Link completed workout')}
            </Button>
          )}
        </View>
      ))}
      {target && (
        <CompletionLink
          key={target.session.id}
          target={target}
          onClose={() => setTarget(null)}
        />
      )}
    </View>
  );
}
