import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Dumbbell, Play } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import EditExerciseEntryDialog from './EditExerciseEntryDialog';
import ExercisePlaybackModal from '@/pages/Diary/ExercisePlaybackModal';
import { usePreferences } from '@/contexts/PreferencesContext';
import { debug, info, error } from '@/utils/logging';
import type {
  WorkoutPresetSet,
  WorkoutPreset,
  PresetExercise,
  ExerciseToLog,
  WorkoutPlanTemplate,
  WorkoutPlanSession,
} from '@/types/workout';
import { formatMinutesToHHMM } from '@/utils/timeFormatters';
import DashboardPlanCard from './DashboardPlanCard';
import DashboardWorkoutPreview from './DashboardWorkoutPreview';
import { cardioTestTitle } from '@/pages/TrainingPrograms/cardioTestTitle';
import { cardioTestProtocols } from '@workspace/shared';
import ExerciseEntryDisplay from './ExerciseEntryDisplay';
import ExercisePresetEntryDisplay from './ExercisePresetEntryDisplay';
import EditExerciseDatabaseDialog from './EditExerciseDatabaseDialog';
import AddExerciseDialog from '@/pages/Exercises/AddExerciseDialog';
import LogExerciseEntryDialog from '@/pages/Diary/LogExerciseEntryDialog';
import {
  useDeleteExerciseEntryMutation,
  useDeleteExercisePresetEntryMutation,
  useExerciseEntries,
} from '@/hooks/Exercises/useExerciseEntries';
import {
  useActiveWorkoutPlans,
  useWorkoutPlanTemplates,
} from '@/hooks/Exercises/useWorkoutPlans';
import {
  useTrainingPrograms,
  useTrainingProgramsList,
} from '@/hooks/TrainingPrograms/useTrainingPrograms';
import {
  resolveExerciseCalories,
  setsDurationMinutes,
  selectUpcomingDashboardWorkoutPlans,
} from '@workspace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { exerciseByIdOptions } from '@/hooks/Exercises/useExercises';
import {
  createWorkoutPlaybackRouteState,
  createWorkoutPlaybackRouteStateFromExercise,
} from '@/utils/workoutPlayback';
import { buildWorkoutPlanSessionPreset } from '@/utils/workoutPlanSession';
import ProgramSessionOutcome from '@/pages/TrainingPrograms/ProgramSessionOutcome';
import type { TrainingProgram } from '@workspace/shared';
import {
  Exercise,
  ExerciseEntry,
  GroupedExerciseEntry,
} from '@/types/exercises';

// New interface for exercises coming from presets, where sets, reps, and weight are guaranteed
interface PresetExerciseToLog extends Exercise {
  sets: WorkoutPresetSet[];
  reps: number;
  weight: number;
  exercise_name: string;
}

interface ExerciseCardProps {
  selectedDate: string;
  initialExercisesToLog?: PresetExercise[];
  onExercisesLogged: () => void;
}

type PlannedSession =
  TrainingProgram['phases'][number]['weeks'][number]['sessions'][number];

const hasPrescribedSets = (session: WorkoutPlanSession) =>
  session.assignments.some(
    (assignment) =>
      assignment.sets.length > 0 ||
      assignment.preset_snapshot?.exercises.some(
        (exercise) => exercise.sets.length > 0
      )
  );

const ExerciseCard = ({
  selectedDate,
  initialExercisesToLog,
  onExercisesLogged,
}: ExerciseCardProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeUserId, isActingOnBehalf } = useActiveUser();
  const { loggingLevel, energyUnit, convertEnergy, getEnergyUnitString } =
    usePreferences();
  debug(
    loggingLevel,
    'ExerciseCard component rendered for date:',
    selectedDate
  );
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [addDialogInitialTab, setAddDialogInitialTab] = useState<
    'my-exercises' | 'workout-preset'
  >('my-exercises');
  const [addDialogIntent, setAddDialogIntent] = useState<'log' | 'playback'>(
    'log'
  );
  const [editingEntry, setEditingEntry] = useState<ExerciseEntry | null>(null); // Use ExerciseEntry from service
  const [isPlaybackModalOpen, setIsPlaybackModalOpen] = useState(false); // State for playback modal
  const [exerciseToPlay, setExerciseToPlay] = useState<Exercise | null>(null); // State for exercise to play
  const [isLogExerciseDialogOpen, setIsLogExerciseDialogOpen] = useState(false); // State for LogExerciseEntryDialog
  const [exercisesToLogQueue, setExercisesToLogQueue] = useState<
    ExerciseToLog[]
  >([]);
  const [currentExerciseToLog, setCurrentExerciseToLog] =
    useState<ExerciseToLog | null>(null);
  const [
    isEditExerciseDatabaseDialogOpen,
    setIsEditExerciseDatabaseDialogOpen,
  ] = useState(false);
  const [exerciseToEditInDatabase, setExerciseToEditInDatabase] =
    useState<Exercise | null>(null);

  const currentUserId = activeUserId || user?.id;
  debug(loggingLevel, 'Current user ID:', currentUserId);

  const queryClient = useQueryClient();
  const { mutateAsync: deleteExerciseEntry } = useDeleteExerciseEntryMutation();
  const { mutateAsync: deleteExercisePresetEntry } =
    useDeleteExercisePresetEntryMutation();
  const { data: activePlans = [] } = useActiveWorkoutPlans(
    selectedDate,
    currentUserId
  );
  const { data: trainingPrograms, isError: trainingProgramsError } =
    useTrainingProgramsList(user?.id, !isActingOnBehalf);
  const { outcome, complete } = useTrainingPrograms(
    user?.id ?? '',
    !!user && !isActingOnBehalf
  );
  const [completionTarget, setCompletionTarget] = useState<{
    plan: WorkoutPlanTemplate;
    programId: string;
    session: PlannedSession;
    mode: 'log' | 'link';
  } | null>(null);
  const [completionError, setCompletionError] = useState('');
  const [completing, setCompleting] = useState(false);
  const completionInFlight = useRef(false);

  const { data: allPlans } = useWorkoutPlanTemplates(currentUserId);

  const { data: exerciseEntries, isLoading: loading } = useExerciseEntries(
    selectedDate,
    currentUserId
  );

  const [startingSession, setStartingSession] = useState<string | null>(null);
  const handleStartPlanSession = async (
    targetPlan: WorkoutPlanTemplate,
    session: WorkoutPlanSession
  ) => {
    const sessionId = session.id;
    setStartingSession(sessionId);
    try {
      const preset = await buildWorkoutPlanSessionPreset(
        targetPlan,
        sessionId,
        currentUserId ?? '',
        (id) => queryClient.fetchQuery(exerciseByIdOptions(id))
      );
      const program = trainingPrograms?.find((candidate) =>
        candidate.phases.some((phase) =>
          phase.weeks.some((week) =>
            week.sessions.some(
              (planned) =>
                planned.id === targetPlan.training_program_session_id &&
                planned.workout_session_id === sessionId
            )
          )
        )
      );
      if (program && targetPlan.training_program_session_id) {
        preset.training_program = {
          program_id: program.id,
          session_id: targetPlan.training_program_session_id,
        };
      }
      navigate(`/workout-playback?date=${selectedDate}`, {
        state: createWorkoutPlaybackRouteState(
          preset,
          selectedDate,
          `${window.location.pathname}${window.location.search}`
        ),
      });
    } catch (err) {
      toast({
        title: t('common.error', 'Error'),
        description:
          err instanceof Error
            ? err.message
            : t(
                'exerciseCard.sessionStartError',
                'Could not start the selected session.'
              ),
        variant: 'destructive',
      });
    } finally {
      setStartingSession(null);
    }
  };

  const handleConfirmCompletion = async () => {
    if (
      completionInFlight.current ||
      !completionTarget?.plan.next_session ||
      !currentUserId
    )
      return;
    completionInFlight.current = true;
    setCompleting(true);
    setCompletionError('');
    try {
      await complete.mutateAsync({
        programId: completionTarget.programId,
        sessionId: completionTarget.session.id,
        input: { entry_date: selectedDate },
      });
      setCompletionTarget(null);
    } catch (failure) {
      setCompletionError(
        failure instanceof Error
          ? failure.message
          : t('trainingPrograms.outcomeError', 'Could not record this outcome.')
      );
    } finally {
      completionInFlight.current = false;
      setCompleting(false);
    }
  };

  const handleOpenCompletion = (
    plan: WorkoutPlanTemplate,
    programId: string,
    session: PlannedSession
  ) => {
    if (!currentUserId) return;
    setCompletionError('');
    setCompletionTarget({
      plan,
      programId,
      session,
      mode:
        plan.next_session && hasPrescribedSets(plan.next_session)
          ? 'log'
          : 'link',
    });
  };

  // Effect to handle initialExercisesToLog prop
  useEffect(() => {
    const processInitialExercises = async () => {
      if (initialExercisesToLog && initialExercisesToLog.length > 0) {
        const fetchedExercises = await Promise.all(
          initialExercisesToLog.map(async (presetEx) => {
            try {
              const fullExercise = await queryClient.fetchQuery(
                exerciseByIdOptions(presetEx.exercise_id)
              );
              // Create WorkoutPresetSet array based on presetEx.sets, reps, and weight
              const sets: WorkoutPresetSet[] = Array.from(
                { length: presetEx.sets },
                (_, i) => ({
                  set_number: i + 1,
                  reps: presetEx.reps,
                  weight: presetEx.weight,
                  set_type: 'Working Set', // Default set type
                })
              );

              return {
                ...fullExercise,
                sets: sets,
                reps: presetEx.reps,
                weight: presetEx.weight,
                exercise_name: presetEx.exercise_name,
              } as PresetExerciseToLog; // Cast to the new interface
            } catch (err) {
              error(
                loggingLevel,
                `Failed to fetch full exercise details for ID ${presetEx.exercise_id}:`,
                err
              );
              return null; // Return null for failed fetches
            }
          })
        );

        const validExercisesToLog: PresetExerciseToLog[] =
          fetchedExercises.filter(
            (ex): ex is PresetExerciseToLog => ex !== null
          );

        if (validExercisesToLog.length > 0) {
          setExercisesToLogQueue(validExercisesToLog);
          const currentExercise = validExercisesToLog[0];
          if (currentExercise) {
            setCurrentExerciseToLog(currentExercise);
          }
          setIsLogExerciseDialogOpen(true);
          setIsAddDialogOpen(false); // Close the add dialog if it's open
        }
      }
    };

    processInitialExercises();
  }, [initialExercisesToLog, loggingLevel, queryClient]);

  const handleOpenAddDialog = () => {
    debug(loggingLevel, 'Opening add exercise dialog.');
    setAddDialogInitialTab('my-exercises');
    setAddDialogIntent('log');
    setIsAddDialogOpen(true);
  };

  const handleStartWorkoutPlayback = () => {
    debug(loggingLevel, 'Opening workout preset selector.');
    setAddDialogInitialTab('workout-preset');
    setAddDialogIntent('playback');
    setIsAddDialogOpen(true);
  };

  const handleCloseAddDialog = () => {
    debug(loggingLevel, 'Closing add exercise dialog.');
    setIsAddDialogOpen(false);
  };

  const handleExerciseSelect = (
    exercise?: Exercise,
    sourceMode?: 'internal' | 'external' | 'custom' | 'preset'
  ) => {
    // If no exercise is provided, it's a general refresh signal
    if (!exercise) {
      debug(
        loggingLevel,
        'General refresh triggered (no specific exercise selected).'
      );
      handleCloseAddDialog(); // Close the add exercise dialog
      return;
    }

    if (addDialogIntent === 'playback') {
      debug(
        loggingLevel,
        `Exercise selected for workout playback from ${sourceMode}:`,
        exercise.id
      );
      const routeState = createWorkoutPlaybackRouteStateFromExercise(
        exercise,
        selectedDate,
        `${window.location.pathname}${window.location.search}`
      );

      handleCloseAddDialog();
      navigate(`/workout-playback?date=${selectedDate}`, {
        state: routeState,
      });
      return;
    }

    debug(
      loggingLevel,
      `Exercise selected in search from ${sourceMode}:`,
      exercise.id
    );
    // When selecting from search, it's a single exercise, so clear queue and set current
    setExercisesToLogQueue([
      { ...exercise, duration: 0, sets: [], reps: 0, weight: 0 },
    ]); // Create a new ExerciseToLog from Exercise, add default duration and empty sets
    setCurrentExerciseToLog({
      ...exercise,
      duration: 0,
      sets: [],
      reps: 0,
      weight: 0,
    });
    setIsLogExerciseDialogOpen(true);
    setIsAddDialogOpen(false);
  };

  const handleWorkoutPresetSelected = (preset: WorkoutPreset) => {
    debug(loggingLevel, 'Workout preset selected in ExerciseCard:', preset);
    const routeState = createWorkoutPlaybackRouteState(
      preset,
      selectedDate,
      `${window.location.pathname}${window.location.search}`
    );

    handleCloseAddDialog();
    navigate(`/workout-playback?date=${selectedDate}`, {
      state: routeState,
    });
  };

  const handleDeleteExerciseEntry = async (entryId: string) => {
    debug(loggingLevel, 'Handling delete individual exercise entry:', entryId);
    try {
      await deleteExerciseEntry(entryId);
      info(
        loggingLevel,
        'Individual exercise entry deleted successfully:',
        entryId
      );
    } catch (err) {
      error(loggingLevel, 'Error deleting individual exercise entry:', err);
    }
  };

  const handleDeleteExercisePresetEntry = async (presetEntryId: string) => {
    debug(
      loggingLevel,
      'Handling delete exercise preset entry:',
      presetEntryId
    );
    try {
      await deleteExercisePresetEntry(presetEntryId);
      info(
        loggingLevel,
        'Exercise preset entry deleted successfully:',
        presetEntryId
      );
    } catch (err) {
      error(loggingLevel, 'Error deleting exercise preset entry:', err);
    }
  };

  const handleEdit = (entry: ExerciseEntry) => {
    // Changed type to ExerciseEntry
    debug(loggingLevel, 'Handling edit exercise entry:', entry.id);
    setEditingEntry(entry);
  };

  const handleEditComplete = () => {
    debug(loggingLevel, 'Handling edit exercise entry complete.');
    setEditingEntry(null);
    info(loggingLevel, 'Exercise entry edit complete and refresh triggered.');
  };

  const handleLogSuccess = () => {
    debug(loggingLevel, 'Exercise logged successfully. Processing queue.');
    // Remove the current exercise from the queue
    const updatedQueue = exercisesToLogQueue.slice(1);
    setExercisesToLogQueue(updatedQueue);

    if (updatedQueue.length > 0) {
      // Open the dialog for the next exercise in the queue
      const currentExercise = updatedQueue[0];
      if (currentExercise) {
        setCurrentExerciseToLog(currentExercise);
      }
      setIsLogExerciseDialogOpen(true);
    } else {
      // All exercises logged, close the dialog
      setCurrentExerciseToLog(null);
      setIsLogExerciseDialogOpen(false);
      onExercisesLogged(); // Signal to parent that exercises have been logged
    }
    handleCloseAddDialog(); // Close the add exercise dialog
  };

  const handleEditExerciseDatabase = useCallback(
    async (exerciseId: string) => {
      debug(
        loggingLevel,
        'Attempting to edit exercise in database:',
        exerciseId
      );
      try {
        const exercise = await queryClient.fetchQuery(
          exerciseByIdOptions(exerciseId)
        );
        setExerciseToEditInDatabase(exercise);
        setIsEditExerciseDatabaseDialogOpen(true);
      } catch (err) {
        error(loggingLevel, 'Failed to fetch exercise for editing:', err);
      }
    },
    [loggingLevel, queryClient]
  );

  const handleSaveExerciseDatabaseEdit = () => {
    debug(loggingLevel, 'Exercise database edit saved. Refreshing entries.');
    setIsEditExerciseDatabaseDialogOpen(false);
    setExerciseToEditInDatabase(null);
  };

  const stats = useMemo(() => {
    let activeCalories = 0;
    let otherCalories = 0;
    let duration = 0;
    let setsCount = 0;
    let hrSum = 0;
    let hrCount = 0;
    if (!exerciseEntries || !Array.isArray(exerciseEntries)) {
      return {
        totalCalories: 0,
        totalDuration: 0,
        totalSets: 0,
        averageHeartRate: 0,
      };
    }

    exerciseEntries.forEach((groupedEntry: GroupedExerciseEntry) => {
      // If it's a preset, we want to iterate over its exercises for the stats
      // If it's an individual entry, we just use it directly
      const items: ExerciseEntry[] =
        groupedEntry.type === 'preset'
          ? groupedEntry.exercises
          : [groupedEntry];

      items.forEach((entry: ExerciseEntry) => {
        // Calories — keep the device-wide "Active Calories" summary separate
        // from logged workouts so the total can be deduped, not summed (the
        // summary already includes the workouts it overlaps with).
        const cal = entry.calories_burned;
        if (cal && !isNaN(cal)) {
          if (entry.exercise_snapshot?.name === 'Active Calories') {
            activeCalories += cal;
          } else {
            otherCalories += cal;
          }
        }

        // Duration & Sets
        if (entry.sets && entry.sets.length > 0) {
          setsCount += entry.sets.length;
          const setsDuration = setsDurationMinutes(entry.sets);
          // Fall back to the entry-level duration when the sets carry no
          // per-set timers (e.g. rep-based sets synced from Hevy).
          duration +=
            setsDuration > 0 ? setsDuration : entry.duration_minutes || 0;
        } else if (entry.duration_minutes) {
          duration += entry.duration_minutes;
        }

        // Heart Rate
        if (entry.avg_heart_rate) {
          hrSum += entry.avg_heart_rate;
          hrCount++;
        }
      });
    });

    // "Active Calories" is a device-wide summary that already includes logged
    // workouts, so take the larger of the two instead of adding both. Steps are
    // intentionally excluded here so the total matches the listed rows.
    const { calories: totalCalories } = resolveExerciseCalories(
      otherCalories,
      activeCalories,
      0
    );

    return {
      totalCalories,
      totalDuration: duration,
      totalSets: setsCount,
      averageHeartRate: hrCount > 0 ? hrSum / hrCount : 0,
    };
  }, [exerciseEntries]);

  const loggedAssignmentIds = useMemo(() => {
    const ids = new Set<string>();
    if (!exerciseEntries || !Array.isArray(exerciseEntries)) return ids;
    for (const groupedEntry of exerciseEntries) {
      if (groupedEntry.workout_plan_assignment_id != null) {
        ids.add(String(groupedEntry.workout_plan_assignment_id));
      }
      if (
        groupedEntry.type === 'preset' &&
        Array.isArray(groupedEntry.exercises)
      ) {
        for (const item of groupedEntry.exercises) {
          if (item.workout_plan_assignment_id != null) {
            ids.add(String(item.workout_plan_assignment_id));
          }
        }
      }
    }
    return ids;
  }, [exerciseEntries]);

  const { programPlans, standalonePlans } = useMemo(() => {
    const none = {
      programPlans: [] as WorkoutPlanTemplate[],
      standalonePlans: [] as WorkoutPlanTemplate[],
    };
    // Without the schedule, linked plans cannot be distinguished from standalone
    // plans. Do not briefly display the entire program while it loads.
    if (!isActingOnBehalf && !trainingPrograms && !trainingProgramsError) {
      return none;
    }
    const standaloneEligible = activePlans.filter(
      (plan) =>
        plan.next_session?.assignments.some(
          (assignment) => !loggedAssignmentIds.has(String(assignment.id))
        ) ?? false
    );
    // Programs are owner-only, and a failed schedule lookup falls back to the
    // pre-Program behaviour of listing every eligible plan.
    if (isActingOnBehalf || trainingProgramsError || !trainingPrograms) {
      return { programPlans: [], standalonePlans: standaloneEligible };
    }
    const linkedPlanIds = new Set(
      trainingPrograms.flatMap((program) =>
        program.phases.flatMap((phase) =>
          phase.weeks.flatMap((week) =>
            week.sessions.map((session) => String(session.workout_plan_id))
          )
        )
      )
    );
    const activePlanIds = new Set(activePlans.map((plan) => String(plan.id)));
    const programCandidates = [
      ...activePlans,
      ...(allPlans ?? []).filter(
        (plan) =>
          linkedPlanIds.has(String(plan.id)) &&
          !activePlanIds.has(String(plan.id))
      ),
    ];
    const selected = selectUpcomingDashboardWorkoutPlans(
      programCandidates,
      trainingPrograms,
      4
    );
    return {
      programPlans: selected.programPlans,
      standalonePlans: selected.standalonePlans.filter((plan) =>
        standaloneEligible.some((candidate) => candidate.id === plan.id)
      ),
    };
  }, [
    activePlans,
    allPlans,
    trainingPrograms,
    trainingProgramsError,
    loggedAssignmentIds,
    isActingOnBehalf,
  ]);

  const programCards = (
    !isActingOnBehalf && !trainingProgramsError ? (trainingPrograms ?? []) : []
  )
    .flatMap((program) =>
      program.phases.flatMap((phase) =>
        phase.weeks.flatMap((week, weekIndex) =>
          week.sessions
            .filter((session) => session.status === 'planned')
            .map((session) => ({
              plan: programPlans.find(
                (plan) => plan.training_program_session_id === session.id
              ),
              context: {
                programId: program.id,
                session,
                label: `${program.name} · ${phase.name} · ${t('trainingPrograms.weekNumber', 'Week {{number}}', { number: weekIndex + 1 })} · ${session.effective_date}`,
                date: session.effective_date,
              },
            }))
        )
      )
    )
    .filter((card) => card.plan || card.context.session.cardio_test_type)
    .sort((a, b) => a.context.date.localeCompare(b.context.date))
    .slice(0, 4);

  const startCardioTest = (session: PlannedSession) => {
    const params = new URLSearchParams({ planned_session_id: session.id });
    if (session.cardio_test_type !== 'cooper_run')
      params.set('protocol', session.cardio_test_type!);
    navigate(`/cardio-tests?${params}`);
  };

  const protocolDescription = (
    protocol: NonNullable<PlannedSession['cardio_test_type']>
  ) => {
    switch (protocol) {
      case 'cooper_run':
        return t(
          'dashboardWorkoutPreview.cooper',
          'Run as far as possible in 12 minutes and record the distance in metres.'
        );
      case 'sprint_6s':
        return t(
          'dashboardWorkoutPreview.sprint',
          'Complete five 6-second sprint efforts with 54-second rests. Record peak power for each effort.'
        );
      case 'power_30s':
        return t(
          'dashboardWorkoutPreview.power',
          'Complete two 30-second efforts with a 60-second rest. Record peak and average power for each effort.'
        );
      case 'ramp':
        return t(
          'cardioTests.ramp.protocol',
          '{{initial}} W initially, increasing by {{increment}} W per minute',
          {
            initial: cardioTestProtocols.ramp.initial_watts,
            increment: cardioTestProtocols.ramp.increment_watts_per_minute,
          }
        );
    }
  };

  if (loading) {
    return (
      <div>
        {t('diary.exerciseCard.loadingExercises', 'Loading exercises...')}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="p-4 pb-2 md:p-6">
        <div className="flex justify-between items-center">
          <CardTitle>
            {programCards.length
              ? programCards[0]?.context?.date === selectedDate
                ? t('diary.todaysSession', "Today's session")
                : t('diary.nextSession', 'Next session')
              : t('exerciseCard.title', 'Exercise')}
          </CardTitle>
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    aria-label={t(
                      'exerciseCard.startWorkoutButton',
                      'Start Workout'
                    )}
                    variant="ghost"
                    onClick={handleStartWorkoutPlayback}
                  >
                    <Play className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('exerciseCard.startWorkoutButton', 'Start Workout')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('exerciseCard.addExercise', 'Add Exercise')}
                    onClick={handleOpenAddDialog}
                  >
                    <Dumbbell className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('exerciseCard.addExercise', 'Add Exercise')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {/* Render the AddExerciseDialog directly. It manages its own Dialog/Content and headers. */}
          <AddExerciseDialog
            key={`add-dialog-${addDialogInitialTab}-${isAddDialogOpen ? 'open' : 'closed'}`}
            open={isAddDialogOpen}
            onOpenChange={setIsAddDialogOpen}
            onExerciseAdded={handleExerciseSelect}
            onWorkoutPresetSelected={handleWorkoutPresetSelected}
            mode="diary"
            initialTab={addDialogInitialTab}
          />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
        {programCards.map(({ plan, context }) =>
          plan ? (
            <DashboardPlanCard
              key={`program-${plan.training_program_session_id}`}
              plan={plan}
              programContext={context?.label}
              previewUserId={currentUserId}
              allowSessionPicker={false}
              startingSessionId={startingSession}
              onStart={handleStartPlanSession}
              onComplete={
                context
                  ? () =>
                      void handleOpenCompletion(
                        plan,
                        context.programId,
                        context.session
                      )
                  : undefined
              }
            />
          ) : (
            <div
              key={context.session.id}
              className="border-b pb-3 mb-3 space-y-3"
            >
              <DashboardWorkoutPreview
                name={cardioTestTitle(context.session.cardio_test_type!, t)}
                context={context.label}
                protocolDescription={protocolDescription(
                  context.session.cardio_test_type!
                )}
                onStart={() => startCardioTest(context.session)}
              >
                <button
                  type="button"
                  className="block w-full min-h-11 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t(
                    'dashboardWorkoutPreview.trigger',
                    'Preview workout: {{name}} — {{context}}',
                    {
                      name: cardioTestTitle(
                        context.session.cardio_test_type!,
                        t
                      ),
                      context: context.label,
                    }
                  )}
                >
                  <span className="block text-sm text-muted-foreground mb-2">
                    {context.label}
                  </span>
                  <span className="block font-semibold text-xl">
                    {cardioTestTitle(context.session.cardio_test_type!, t)}
                  </span>
                  <span className="block text-sm text-primary mt-2">
                    {t('dashboardWorkoutPreview.view', 'View workout')}
                  </span>
                </button>
              </DashboardWorkoutPreview>
              <Button onClick={() => startCardioTest(context.session)}>
                {t('trainingPrograms.recordTest', 'Record Test Attempt')}
              </Button>
            </div>
          )
        )}
        {standalonePlans.map((plan: WorkoutPlanTemplate) => (
          <DashboardPlanCard
            key={plan.id}
            plan={plan}
            allowSessionPicker
            startingSessionId={startingSession}
            onStart={handleStartPlanSession}
          />
        ))}

        {exerciseEntries?.length === 0 ? (
          <p className="text-muted-foreground">
            {t('exerciseCard.noEntries', 'No exercise entries for this day.')}
          </p>
        ) : (
          <div className="space-y-4">
            {exerciseEntries?.map((entry: GroupedExerciseEntry) => {
              if (entry.type === 'preset') {
                return (
                  <ExercisePresetEntryDisplay
                    key={entry.id}
                    presetEntry={entry}
                    currentUserId={currentUserId}
                    handleDelete={handleDeleteExercisePresetEntry} // Pass the new handler for presets
                    handleDeleteExerciseEntry={handleDeleteExerciseEntry} // Pass the individual exercise entry delete handler
                    handleEdit={handleEdit}
                    handleEditExerciseDatabase={handleEditExerciseDatabase}
                    setExerciseToPlay={setExerciseToPlay}
                    setIsPlaybackModalOpen={setIsPlaybackModalOpen}
                    energyUnit={energyUnit}
                    convertEnergy={convertEnergy}
                    getEnergyUnitString={getEnergyUnitString}
                  />
                );
              } else {
                // Render individual exercise entry
                return (
                  <ExerciseEntryDisplay
                    key={entry.id}
                    exerciseEntry={entry} // Removed cast
                    currentUserId={currentUserId}
                    handleEdit={handleEdit}
                    handleDelete={handleDeleteExerciseEntry} // Pass the handler for individual entries
                    handleEditExerciseDatabase={handleEditExerciseDatabase}
                    setExerciseToPlay={setExerciseToPlay}
                    setIsPlaybackModalOpen={setIsPlaybackModalOpen}
                    energyUnit={energyUnit}
                    convertEnergy={convertEnergy}
                    getEnergyUnitString={getEnergyUnitString}
                  />
                );
              }
            })}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pt-2 gap-4">
              <span className="font-semibold">
                {t('exerciseCard.exerciseTotal2', 'Exercise Total:')}
              </span>
              <div className="grid grid-cols-4 gap-2 sm:gap-4 text-xs sm:text-sm">
                <div className="text-center">
                  <div className="font-bold text-foreground">
                    {stats.totalSets}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('common.totalSets', 'Total Sets')}
                  </div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-foreground">
                    {formatMinutesToHHMM(stats.totalDuration)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('common.minutesUnit', 'Min')}
                  </div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-foreground">
                    {stats.averageHeartRate > 0
                      ? Math.round(stats.averageHeartRate)
                      : 0}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('common.avgHrUnit', 'Avg HR')}
                  </div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-foreground">
                    {Math.round(
                      convertEnergy(stats.totalCalories, 'kcal', energyUnit)
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('common.caloriesUnit', getEnergyUnitString(energyUnit))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Edit Exercise Entry Dialog */}
        {editingEntry && (
          <EditExerciseEntryDialog
            key={editingEntry.id}
            entry={editingEntry as ExerciseEntry}
            open={!!editingEntry}
            onOpenChange={(open) => {
              debug(
                loggingLevel,
                'Edit exercise entry dialog open state changed:',
                open
              );
              if (!open) {
                setEditingEntry(null);
              }
            }}
            onSave={handleEditComplete}
          />
        )}

        {/* Exercise Playback Modal */}
        <ExercisePlaybackModal
          isOpen={isPlaybackModalOpen}
          onClose={() => setIsPlaybackModalOpen(false)}
          exercise={exerciseToPlay}
        />

        {/* Log Exercise Entry Dialog */}
        <LogExerciseEntryDialog
          key={
            isLogExerciseDialogOpen
              ? `open-${currentExerciseToLog?.id}`
              : 'close'
          }
          isOpen={isLogExerciseDialogOpen}
          onClose={() => {
            setIsLogExerciseDialogOpen(false);
            setCurrentExerciseToLog(null); // Clear current exercise if dialog is closed manually
            setExercisesToLogQueue([]); // Clear the queue as well
          }}
          exercise={currentExerciseToLog}
          selectedDate={selectedDate}
          onSaveSuccess={handleLogSuccess} // Use the new handler
          initialSets={currentExerciseToLog?.sets || []}
          energyUnit={energyUnit}
          convertEnergy={convertEnergy}
          getEnergyUnitString={getEnergyUnitString}
        />
      </CardContent>

      {/* Edit Exercise Database Dialog */}
      <EditExerciseDatabaseDialog
        key={isEditExerciseDatabaseDialogOpen ? 'open' : 'close'}
        open={isEditExerciseDatabaseDialogOpen}
        onOpenChange={setIsEditExerciseDatabaseDialogOpen}
        exerciseToEdit={exerciseToEditInDatabase}
        onSaveSuccess={handleSaveExerciseDatabaseEdit}
        energyUnit={energyUnit}
        convertEnergy={convertEnergy}
        getEnergyUnitString={getEnergyUnitString}
      />
      <AlertDialog
        open={!!completionTarget && completionTarget.mode !== 'link'}
        onOpenChange={(open) => {
          if (!open && !completing) setCompletionTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('exerciseCard.confirmCompleteTitle', 'Complete this workout?')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'exerciseCard.confirmCompleteDescription',
                'Log {{name}} on {{date}} with its prescribed sets and mark the Program session complete.',
                {
                  name: completionTarget?.plan.next_session?.name,
                  date: selectedDate,
                }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {completionError && (
            <p role="alert" className="text-sm text-destructive">
              {completionError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={completing}>
              {t('common.cancel', 'Cancel')}
            </AlertDialogCancel>
            <Button
              variant="outline"
              disabled={completing}
              onClick={() =>
                setCompletionTarget((target) =>
                  target ? { ...target, mode: 'link' } : target
                )
              }
            >
              {t('trainingPrograms.linkExisting', 'Link an existing workout')}
            </Button>
            <AlertDialogAction
              disabled={completing || completionTarget?.mode !== 'log'}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmCompletion();
              }}
            >
              {completing
                ? t('trainingPrograms.recording', 'Recording…')
                : t('trainingPrograms.confirmCompletion', 'Confirm completion')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {completionTarget?.mode === 'link' && currentUserId && (
        <ProgramSessionOutcome
          session={completionTarget.session}
          status="completed"
          autoShift={false}
          userId={currentUserId}
          pending={outcome.isPending}
          initialDate={selectedDate}
          onClose={() => setCompletionTarget(null)}
          onSave={async (input) => {
            await outcome.mutateAsync({
              programId: completionTarget.programId,
              sessionId: completionTarget.session.id,
              input,
            });
            setCompletionTarget(null);
          }}
        />
      )}
    </Card>
  );
};

export default ExerciseCard;
