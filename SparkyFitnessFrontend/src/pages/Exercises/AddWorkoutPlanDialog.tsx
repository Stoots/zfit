import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TooltipProvider } from '@/components/ui/tooltip';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type {
  SortableExerciseItemData,
  WorkoutPlanTemplate,
  WorkoutPlanDraft,
  WorkoutPreset,
} from '@/types/workout';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Plus,
  Clipboard,
  CalendarDays,
  Repeat,
  Trash2,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { Card } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import AddExerciseDialog from './AddExerciseDialog';
import { usePreferences } from '@/contexts/PreferencesContext';
import { formatDateToYYYYMMDD } from '@/lib/utils';
import { DAYS_OF_WEEK } from '@/constants/exercises';
import { useWorkoutPlanAssignments } from '@/hooks/Exercises/useWorkoutPlanAssignments';
import { SortableExerciseItem } from './SortableExerciseItem';
import WorkoutPresetForm from './WorkoutPresetForm';

interface AddWorkoutPlanDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (newPlan: WorkoutPlanDraft) => void | Promise<void>;
  initialData?: WorkoutPlanTemplate | null;
  onUpdate?: (
    planId: string,
    updatedPlan: Partial<WorkoutPlanDraft>
  ) => void | Promise<void>;
}

const AddWorkoutPlanDialog = ({
  isOpen,
  onClose,
  onSave,
  initialData,
  onUpdate,
}: AddWorkoutPlanDialogProps) => {
  const {
    assignments,
    sessions,
    setSessionName,
    setSessionDay,
    setSessionOptional,
    addSession,
    removeSession,
    moveSession,
    scheduleType,
    setScheduleType,
    entryMode,
    setEntryMode,
    copiedAssignment,
    isAddExerciseDialogOpen,
    setIsAddExerciseDialogOpen,
    selectedSessionForAssignment,
    setSelectedSessionForAssignment,
    handleRemoveAssignment,
    handleSetChangeInPlan,
    handleAddSetInPlan,
    handleDuplicateSetInPlan,
    handleRemoveSetInPlan,
    handleDragEnd,
    handleAddExerciseOrPreset,
    handleCopyAssignment,
    handlePasteAssignment,
    handlePresetSnapshotChange,
    buildSessionsForSave,
  } = useWorkoutPlanAssignments(initialData);
  const { t } = useTranslation();
  const { weightUnit } = usePreferences();
  const [planName, setPlanName] = useState(() => initialData?.plan_name || '');
  const [description, setDescription] = useState(
    () => initialData?.description || ''
  );

  const [editingPreset, setEditingPreset] = useState<{
    index: number;
    snapshot: WorkoutPreset;
    sessionName: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => {
    if (initialData?.start_date) {
      return String(initialData.start_date).split('T')[0];
    }
    return formatDateToYYYYMMDD(new Date());
  });

  const [endDate, setEndDate] = useState(() => {
    if (initialData?.end_date) {
      return String(initialData.end_date).split('T')[0];
    }
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return formatDateToYYYYMMDD(date);
  });

  const [isActive, setIsActive] = useState(
    () => initialData?.is_active ?? true
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleSave = async () => {
    if (planName.trim() === '' || startDate?.trim() === '') {
      toast({
        title: t(
          'addWorkoutPlanDialog.validationErrorTitle',
          'Validation Error'
        ),
        description: t(
          'addWorkoutPlanDialog.validationErrorDescription',
          'Plan Name and Start Date are required.'
        ),
        variant: 'destructive',
      });
      return;
    }

    const planData: WorkoutPlanDraft = {
      plan_name: planName,
      description,
      start_date: startDate,
      end_date: endDate || null,
      is_active: isActive,
      schedule_type: scheduleType,
      entry_mode: scheduleType === 'sequential' ? 'prompt' : entryMode,
      sessions: buildSessionsForSave(),
    };

    setSaving(true);
    setSaveError(null);
    try {
      if (initialData && onUpdate) {
        await onUpdate(initialData.id, planData);
      } else {
        await onSave(planData);
      }
      onClose();
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : t(
              'addWorkoutPlanDialog.saveError',
              'Could not save the plan. Your edits are still here.'
            )
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <TooltipProvider>
        <DialogContent
          requireConfirmation
          className="sm:max-w-[1200px] max-h-[90vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>
              {initialData
                ? t('addWorkoutPlanDialog.editTitle', 'Edit Workout Plan')
                : t('addWorkoutPlanDialog.addTitle', 'Add New Workout Plan')}
            </DialogTitle>
            <DialogDescription>
              {initialData
                ? t(
                    'addWorkoutPlanDialog.editDescription',
                    'Edit the details for your workout plan and its assignments.'
                  )
                : t(
                    'addWorkoutPlanDialog.addDescription',
                    'Enter the details for your new workout plan and assign workouts to days.'
                  )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="planName">
                {t('addWorkoutPlanDialog.planNameLabel', 'Plan Name')}
              </Label>
              <Input
                id="planName"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                placeholder={t(
                  'addWorkoutPlanDialog.planNamePlaceholder',
                  'e.g., Summer Shred'
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">
                {t('addWorkoutPlanDialog.descriptionLabel', 'Description')}
              </Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t(
                  'addWorkoutPlanDialog.descriptionPlaceholder',
                  'Optional plan description...'
                )}
              />
            </div>

            <div className="space-y-2">
              <Label>
                {t('addWorkoutPlanDialog.scheduleTypeLabel', 'Schedule Mode')}
              </Label>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  className={`w-full flex flex-col h-auto py-2.5 px-3.5 text-left rounded-lg border transition-all ${
                    scheduleType === 'sequential'
                      ? 'border-primary bg-primary/10 ring-1 ring-primary shadow-xs'
                      : 'border-border/70 bg-card hover:bg-accent/40 text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setScheduleType('sequential')}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-sm text-foreground">
                    <Repeat
                      className={`h-4 w-4 ${
                        scheduleType === 'sequential'
                          ? 'text-primary'
                          : 'text-muted-foreground'
                      }`}
                    />
                    <span>
                      {t(
                        'addWorkoutPlanDialog.sequentialModeTitle',
                        'Sequential (Cycle)'
                      )}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground mt-0.5">
                    {t(
                      'addWorkoutPlanDialog.sequentialModeSubtitle',
                      'Continuous sequence; pauses on missed days'
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className={`w-full flex flex-col h-auto py-2.5 px-3.5 text-left rounded-lg border transition-all ${
                    scheduleType === 'weekly'
                      ? 'border-primary bg-primary/10 ring-1 ring-primary shadow-xs'
                      : 'border-border/70 bg-card hover:bg-accent/40 text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setScheduleType('weekly')}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-sm text-foreground">
                    <CalendarDays
                      className={`h-4 w-4 ${
                        scheduleType === 'weekly'
                          ? 'text-primary'
                          : 'text-muted-foreground'
                      }`}
                    />
                    <span>
                      {t(
                        'addWorkoutPlanDialog.weeklyModeTitle',
                        'Weekly (Fixed Days)'
                      )}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground mt-0.5">
                    {t(
                      'addWorkoutPlanDialog.weeklyModeSubtitle',
                      'Workouts assigned to specific weekdays (Mon-Sun)'
                    )}
                  </span>
                </button>
              </div>
            </div>

            {scheduleType === 'weekly' && (
              <div className="space-y-2">
                <Label>
                  {t('addWorkoutPlanDialog.entryModeLabel', 'Diary Behavior')}
                </Label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    className={`w-full flex flex-col h-auto py-2.5 px-3.5 text-left rounded-lg border transition-all ${
                      entryMode === 'prompt'
                        ? 'border-primary bg-primary/10 ring-1 ring-primary shadow-xs'
                        : 'border-border/70 bg-card hover:bg-accent/40 text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => setEntryMode('prompt')}
                  >
                    <span className="font-semibold text-sm text-foreground">
                      {t(
                        'addWorkoutPlanDialog.promptModeTitle',
                        'Prompt on Day (Recommended)'
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground mt-0.5">
                      {t(
                        'addWorkoutPlanDialog.promptModeSubtitle',
                        'Clean diary; shows workout prompt on scheduled weekdays'
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`w-full flex flex-col h-auto py-2.5 px-3.5 text-left rounded-lg border transition-all ${
                      entryMode === 'prefill'
                        ? 'border-primary bg-primary/10 ring-1 ring-primary shadow-xs'
                        : 'border-border/70 bg-card hover:bg-accent/40 text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => setEntryMode('prefill')}
                  >
                    <span className="font-semibold text-sm text-foreground">
                      {t(
                        'addWorkoutPlanDialog.prefillModeTitle',
                        'Pre-fill Calendar'
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground mt-0.5">
                      {t(
                        'addWorkoutPlanDialog.prefillModeSubtitle',
                        'Pre-fills pending workout entries across all upcoming weekdays'
                      )}
                    </span>
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">
                  {t('addWorkoutPlanDialog.startDateLabel', 'Start Date')}
                </Label>
                <div className="relative">
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="pr-8"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">
                  {t(
                    'addWorkoutPlanDialog.endDateLabel',
                    'End Date (Optional)'
                  )}
                </Label>
                <div className="relative">
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="pr-8"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="isActive"
                checked={isActive}
                onCheckedChange={(checked) => setIsActive(checked as boolean)}
              />
              <Label htmlFor="isActive">
                {t('addWorkoutPlanDialog.setActiveLabel', 'Set as active plan')}
              </Label>
            </div>
            <p
              className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mt-2 text-sm"
              role="alert"
            >
              <span className="font-bold">
                {t('addWorkoutPlanDialog.noteTitle', 'Note:')}
              </span>{' '}
              {scheduleType === 'sequential'
                ? t(
                    'addWorkoutPlanDialog.sequentialNoteDescription',
                    'Sequential plans do not pre-fill calendar days. The sequence automatically advances to the next session whenever you complete a workout.'
                  )
                : t(
                    'addWorkoutPlanDialog.noteDescription',
                    'Updating an active plan adjusts upcoming exercise entries. Deleting a plan clears future ones, while previous entries stay in your log.'
                  )}
            </p>

            <div className="space-y-4">
              <h4 className="mb-2 text-lg font-medium">
                {scheduleType === 'sequential'
                  ? t(
                      'addWorkoutPlanDialog.sequentialAssignmentsTitle',
                      'Workout Sequence'
                    )
                  : t('addWorkoutPlanDialog.assignmentsTitle', 'Assignments')}
              </h4>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <div className="space-y-4">
                  {sessions.map((session, sessionIdx) => (
                    <Card key={session.id} className="p-4 bg-muted/30">
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-primary">
                              {t(
                                'addWorkoutPlanDialog.sessionNumber',
                                'Session {{number}}',
                                { number: sessionIdx + 1 }
                              )}
                            </h3>
                            <Label
                              htmlFor={`session-name-${session.id}`}
                              className="sr-only"
                            >
                              {t(
                                'addWorkoutPlanDialog.sessionNameLabel',
                                'Session {{number}} name',
                                { number: sessionIdx + 1 }
                              )}
                            </Label>
                            <Input
                              id={`session-name-${session.id}`}
                              value={session.name}
                              onChange={(e) =>
                                setSessionName(session.id, e.target.value)
                              }
                              className="w-44 sm:w-60 bg-background/90"
                            />
                            <div className="flex min-h-11 items-center gap-2">
                              <Checkbox
                                id={`session-optional-${session.id}`}
                                checked={session.is_optional}
                                onCheckedChange={(checked) =>
                                  setSessionOptional(
                                    session.id,
                                    checked === true
                                  )
                                }
                              />
                              <Label htmlFor={`session-optional-${session.id}`}>
                                {t('trainingPrograms.optional', 'Optional')}
                              </Label>
                            </div>
                            {scheduleType === 'weekly' && (
                              <div>
                                <Label
                                  htmlFor={`session-day-${session.id}`}
                                  className="sr-only"
                                >
                                  {t(
                                    'addWorkoutPlanDialog.sessionDayLabel',
                                    'Session {{number}} day',
                                    { number: sessionIdx + 1 }
                                  )}
                                </Label>
                                <select
                                  id={`session-day-${session.id}`}
                                  value={session.day_of_week ?? ''}
                                  onChange={(e) =>
                                    setSessionDay(
                                      session.id,
                                      e.target.value === ''
                                        ? null
                                        : Number(e.target.value)
                                    )
                                  }
                                  className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  <option value="">
                                    {t(
                                      'addWorkoutPlanDialog.unscheduled',
                                      'No fixed day'
                                    )}
                                  </option>
                                  {DAYS_OF_WEEK.map((day) => (
                                    <option key={day.id} value={day.id}>
                                      {day.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              className="min-h-11 min-w-11"
                              disabled={sessionIdx === 0}
                              onClick={() => moveSession(session.id, 'up')}
                              aria-label={t(
                                'addWorkoutPlanDialog.moveExactSessionUp',
                                'Move session {{number}} up',
                                { number: sessionIdx + 1 }
                              )}
                            >
                              <ChevronUp
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="min-h-11 min-w-11"
                              disabled={sessionIdx === sessions.length - 1}
                              onClick={() => moveSession(session.id, 'down')}
                              aria-label={t(
                                'addWorkoutPlanDialog.moveExactSessionDown',
                                'Move session {{number}} down',
                                { number: sessionIdx + 1 }
                              )}
                            >
                              <ChevronDown
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                            </Button>
                            {copiedAssignment && (
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() =>
                                  handlePasteAssignment(session.id)
                                }
                              >
                                <Clipboard
                                  className="h-4 w-4 mr-2"
                                  aria-hidden="true"
                                />
                                {t('addWorkoutPlanDialog.pasteButton', 'Paste')}
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setSelectedSessionForAssignment(session.id);
                                setIsAddExerciseDialogOpen(true);
                              }}
                            >
                              <Plus
                                className="h-4 w-4 mr-2"
                                aria-hidden="true"
                              />
                              {t(
                                'addWorkoutPlanDialog.addExerciseButtonInDay',
                                'Add Exercise'
                              )}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={sessions.length === 1}
                              className="min-h-11 min-w-11 text-muted-foreground hover:text-destructive"
                              onClick={() => removeSession(session.id)}
                              aria-label={t(
                                'addWorkoutPlanDialog.removeExactSession',
                                'Remove session {{number}}',
                                { number: sessionIdx + 1 }
                              )}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </div>
                        </div>
                        <SortableContext
                          items={session.assignments.map((a) => String(a.id))}
                        >
                          {session.assignments.length === 0 && (
                            <p className="py-6 text-center text-sm text-muted-foreground">
                              {t(
                                'addWorkoutPlanDialog.noExercisesInSession',
                                'No exercises in this session. Click "Add Exercise" to add exercises or presets.'
                              )}
                            </p>
                          )}
                          {session.assignments.map((assignment) => {
                            const index = assignments.findIndex(
                              (a) => a.id === assignment.id
                            );
                            return (
                              <div key={assignment.id} className="space-y-2">
                                <SortableExerciseItem
                                  ex={assignment}
                                  exerciseIndex={index}
                                  weightUnit={weightUnit}
                                  workoutPresets={
                                    assignment.preset_snapshot
                                      ? [assignment.preset_snapshot]
                                      : []
                                  }
                                  onRemoveExercise={handleRemoveAssignment}
                                  onSetChange={handleSetChangeInPlan}
                                  onDuplicateSet={handleDuplicateSetInPlan}
                                  onRemoveSet={handleRemoveSetInPlan}
                                  onAddSet={handleAddSetInPlan}
                                  onCopyExercise={
                                    handleCopyAssignment as (
                                      ex: SortableExerciseItemData
                                    ) => void
                                  }
                                />
                                {assignment.preset_snapshot && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() =>
                                      setEditingPreset({
                                        index,
                                        snapshot: structuredClone(
                                          assignment.preset_snapshot!
                                        ),
                                        sessionName: `${sessionIdx + 1}. ${session.name}`,
                                      })
                                    }
                                  >
                                    {t(
                                      'addWorkoutPlanDialog.editLocalPrescription',
                                      'Edit this session’s preset prescription'
                                    )}
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                        </SortableContext>
                      </div>
                    </Card>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full min-h-11 border-dashed"
                    onClick={addSession}
                  >
                    <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                    {t(
                      'addWorkoutPlanDialog.addNextSessionButton',
                      'Add Next Session (Session {{number}})',
                      { number: sessions.length + 1 }
                    )}
                  </Button>
                </div>
              </DndContext>
            </div>
          </div>
          {saveError && (
            <p role="alert" className="text-destructive">
              {saveError}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" onClick={onClose}>
                {t('addWorkoutPlanDialog.cancelButton', 'Cancel')}
              </Button>
            </DialogClose>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {t('addWorkoutPlanDialog.saveButton', 'Save Plan')}
            </Button>
          </DialogFooter>
        </DialogContent>
        {editingPreset && (
          <WorkoutPresetForm
            key={`${editingPreset.index}-${editingPreset.snapshot.id}`}
            isOpen
            sessionName={editingPreset.sessionName}
            initialPreset={editingPreset.snapshot}
            onClose={() => setEditingPreset(null)}
            onSave={(prescription) => {
              handlePresetSnapshotChange(editingPreset.index, {
                ...editingPreset.snapshot,
                ...prescription,
              });
              setEditingPreset(null);
            }}
          />
        )}

        <AddExerciseDialog
          open={isAddExerciseDialogOpen}
          onOpenChange={setIsAddExerciseDialogOpen}
          onExerciseAdded={(exercise, sourceMode) => {
            if (exercise && sourceMode) {
              handleAddExerciseOrPreset(
                exercise,
                sourceMode,
                selectedSessionForAssignment
              );
            }
          }}
          onWorkoutPresetSelected={(preset) =>
            handleAddExerciseOrPreset(
              preset,
              'preset',
              selectedSessionForAssignment
            )
          }
          mode="workout-plan"
        />
      </TooltipProvider>
    </Dialog>
  );
};

export default AddWorkoutPlanDialog;
