import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type WorkoutPlanAssignmentResponse,
  type WorkoutPlanBulkField,
  type WorkoutPlanBulkPreview,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  buildBulkSourcePrescription,
  useWorkoutPlanBulk,
} from '@/hooks/Exercises/useWorkoutPlanBulk';
import { useTrainingProgramsList } from '@/hooks/TrainingPrograms/useTrainingPrograms';
import type { WorkoutPlanDraft, WorkoutPlanTemplate } from '@/types/workout';

const setFields: WorkoutPlanBulkField[] = [
  'sets',
  'set_type',
  'reps',
  'weight',
  'rpe',
  'rir',
  'duration',
  'distance',
  'rest_time',
  'notes',
];
const presetFields: WorkoutPlanBulkField[] = [
  'workout_format',
  'time_cap_seconds',
  'description',
];
function useFieldNames(): Record<WorkoutPlanBulkField, string> {
  const { t } = useTranslation();
  return {
    sets: t('workoutPlanBulk.fields.sets', 'Whole set collection'),
    set_type: t('workoutPlanBulk.fields.set_type', 'Set type'),
    reps: t('workoutPlanBulk.fields.reps', 'Repetitions'),
    weight: t('workoutPlanBulk.fields.weight', 'Load'),
    rpe: t('workoutPlanBulk.fields.rpe', 'RPE'),
    rir: t('workoutPlanBulk.fields.rir', 'Repetitions in reserve (RIR)'),
    duration: t('workoutPlanBulk.fields.duration', 'Duration (seconds)'),
    distance: t('workoutPlanBulk.fields.distance', 'Distance (km)'),
    rest_time: t('workoutPlanBulk.fields.rest_time', 'Rest (seconds)'),
    notes: t('workoutPlanBulk.fields.notes', 'Set notes'),
    workout_format: t(
      'workoutPlanBulk.fields.workout_format',
      'Workout format'
    ),
    time_cap_seconds: t(
      'workoutPlanBulk.fields.time_cap_seconds',
      'Time cap (seconds)'
    ),
    description: t('workoutPlanBulk.fields.description', 'Preset description'),
  };
}

function PrescriptionValues({
  assignment,
  fields,
}: {
  assignment: WorkoutPlanAssignmentResponse;
  fields: WorkoutPlanBulkField[];
}) {
  const { t } = useTranslation();
  const fieldNames = useFieldNames();
  const snapshot = assignment.preset_snapshot;
  const exercises = snapshot?.exercises ?? [
    {
      exercise_id: assignment.exercise_id,
      exercise_name: assignment.exercise_name,
      sets: assignment.sets,
    },
  ];
  const displayValue = (value: unknown) =>
    value == null || value === ''
      ? t('workoutPlanBulk.unspecified', 'Unspecified')
      : String(value);
  return (
    <div className="space-y-3 text-sm">
      {snapshot &&
        fields
          .filter((field) => presetFields.includes(field))
          .map((field) => (
            <p key={field}>
              <span className="font-medium">{fieldNames[field]}: </span>
              {displayValue(snapshot[field])}
            </p>
          ))}
      {exercises.map((exercise, index) => (
        <div key={`${exercise.exercise_id}-${index}`}>
          <p className="font-medium">
            {exercise.exercise_name ??
              t('workoutPlanBulk.exercise', 'Exercise')}
          </p>
          <p className="break-all text-xs text-muted-foreground">
            {t('workoutPlanBulk.exerciseUuid', 'Exercise UUID: {{id}}', {
              id: exercise.exercise_id,
            })}
          </p>
          {fields.some((field) => setFields.includes(field)) &&
            (exercise.sets.length ? (
              <ul className="mt-1 space-y-1">
                {exercise.sets.map((set) => (
                  <li key={set.set_number}>
                    <span className="font-medium">
                      {t('workoutPlanBulk.setNumber', 'Set {{number}}:', {
                        number: set.set_number,
                      })}{' '}
                    </span>
                    {(fields.includes('sets')
                      ? Object.entries(set)
                          .filter(
                            ([key]) => key !== 'id' && key !== 'set_number'
                          )
                          .map(
                            ([key, value]) =>
                              `${fieldNames[key as WorkoutPlanBulkField] ?? key}: ${displayValue(value)}`
                          )
                      : fields
                          .filter((field) => setFields.includes(field))
                          .map(
                            (field) =>
                              `${fieldNames[field]}: ${displayValue(set[field])}`
                          )
                    ).join('; ')}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                {t('workoutPlanBulk.noSets', 'No sets')}
              </p>
            ))}
        </div>
      ))}
    </div>
  );
}

export default function WorkoutPlanBulkDialog({
  plan,
  draftSessions,
  onClose,
  onApplied,
}: {
  plan: WorkoutPlanTemplate;
  draftSessions: WorkoutPlanDraft['sessions'];
  onClose: () => void;
  onApplied: () => void;
}) {
  const { t } = useTranslation();
  const fieldNames = useFieldNames();
  const [sourceKey, setSourceKey] = useState('');
  const [scope, setScope] = useState('');
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [included, setIncluded] = useState<string[]>([]);
  const [fields, setSelectedFields] = useState<WorkoutPlanBulkField[]>([]);
  const [preview, setPreview] = useState<WorkoutPlanBulkPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const programs = useTrainingProgramsList(plan.user_id);
  const bulk = useWorkoutPlanBulk(
    Number(plan.id),
    scope === 'standalone' ? null : scope,
    !!scope
  );
  const sources = draftSessions.flatMap((session) =>
    session.assignments.flatMap((assignment) => {
      const savedSession = plan.sessions.find(
        (saved) => saved.id === session.id
      );
      const savedAssignment = savedSession?.assignments.find(
        (saved) => String(saved.id) === String(assignment.id)
      );
      return savedAssignment
        ? [{ session, assignment, key: `${session.id}:${assignment.id}` }]
        : [];
    })
  );
  const source = sources.find((item) => item.key === sourceKey);
  const pending = bulk.preview.isPending || bulk.apply.isPending;
  const resetPreview = () => {
    setPreview(null);
    setError(null);
  };
  const candidates = bulk.candidates.data ?? [];

  const makePreview = async () => {
    resetPreview();
    try {
      if (!source?.session.id || !scope)
        throw new Error(
          t(
            'workoutPlanBulk.chooseSourceAndScope',
            'Choose a saved source assignment and a scope.'
          )
        );
      const prescription = buildBulkSourcePrescription(
        source.session,
        Number(source.assignment.id)
      );
      const result = await bulk.preview.mutateAsync({
        plan_id: Number(plan.id),
        program_id: scope === 'standalone' ? null : scope,
        source_session_id: source.session.id,
        source_assignment_id: Number(source.assignment.id),
        prescription,
        fields,
        targets: Object.entries(selected)
          .filter(([sessionId]) => included.includes(sessionId))
          .map(([sessionId, assignmentId]) => ({
            workout_session_id: sessionId,
            assignment_id: assignmentId,
            planned_session_ids:
              candidates
                .find((candidate) => candidate.workout_session_id === sessionId)
                ?.bindings.map((binding) => binding.id) ?? [],
          })),
      });
      setPreview(result);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t(
              'workoutPlanBulk.previewFailed',
              'Preview failed. Review your selections and try again.'
            )
      );
    }
  };

  const confirm = async () => {
    if (!preview) return;
    try {
      await bulk.apply.mutateAsync({
        request: preview.request,
        revision: preview.revision,
      });
      onApplied();
    } catch (cause) {
      setPreview(null);
      setError(
        t(
          'workoutPlanBulk.applyFailed',
          '{{message}} Your selections are preserved. Review the refreshed saved prescriptions and create a new preview before trying again.',
          {
            message:
              cause instanceof Error
                ? cause.message
                : t(
                    'workoutPlanBulk.confirmFailed',
                    'Could not confirm the batch result.'
                  ),
          }
        )
      );
      void bulk.candidates.refetch();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-4xl [&>button]:min-h-11 [&>button]:min-w-11"
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t(
              'workoutPlanBulk.title',
              'Apply prescription to future sessions'
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              'workoutPlanBulk.description',
              'Only explicitly selected assignments and fields in {{planName}} will change. Preview and cancellation save nothing. Your source edits remain unsaved unless you separately use Save Plan. Applying this batch closes the editor and discards other unsaved plan edits.',
              { planName: plan.plan_name }
            )}
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={pending || !!preview} className="min-w-0 space-y-6">
          <div className="space-y-2">
            <Label htmlFor="bulk-source">
              {t(
                'workoutPlanBulk.sourceAssignment',
                'Source assignment from this draft'
              )}
            </Label>
            <Select
              disabled={pending || !!preview}
              value={sourceKey}
              onValueChange={(value) => {
                setSourceKey(value);
                setSelectedFields([]);
                setIncluded([]);
                resetPreview();
              }}
            >
              <SelectTrigger id="bulk-source" className="min-h-11">
                <SelectValue
                  placeholder={t(
                    'workoutPlanBulk.chooseSource',
                    'Choose a saved assignment'
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {sources.map((item) => (
                  <SelectItem key={item.key} value={item.key}>
                    {item.session.name} —{' '}
                    {item.assignment.exercise_name ??
                      item.assignment.preset_snapshot?.name ??
                      item.assignment.workout_preset_name ??
                      t('workoutPlanBulk.assignment', 'Assignment')}{' '}
                    — #{item.assignment.id} · {item.session.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!sources.length && (
              <p className="text-sm text-muted-foreground">
                {t(
                  'workoutPlanBulk.saveSourceFirst',
                  'Save a session and assignment before using it as a source.'
                )}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="bulk-scope">
              {t(
                'workoutPlanBulk.scope',
                'Scope — choose one Program or standalone'
              )}
            </Label>
            <Select
              disabled={pending || !!preview}
              value={scope}
              onValueChange={(value) => {
                setScope(value);
                setSelected({});
                setIncluded([]);
                resetPreview();
              }}
            >
              <SelectTrigger id="bulk-scope" className="min-h-11">
                <SelectValue
                  placeholder={t(
                    'workoutPlanBulk.chooseScope',
                    'Choose an explicit scope'
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standalone">
                  {t(
                    'workoutPlanBulk.standalone',
                    'Standalone (no Program bindings)'
                  )}
                </SelectItem>
                {programs.data?.map((program) => (
                  <SelectItem key={program.id} value={program.id}>
                    {program.name} · {program.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {programs.isLoading && (
              <p role="status" className="text-sm">
                {t('workoutPlanBulk.loadingPrograms', 'Loading Programs…')}
              </p>
            )}
            {programs.isError && (
              <div role="alert">
                <p>
                  {t(
                    'workoutPlanBulk.programsFailed',
                    'Programs could not be loaded.'
                  )}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => void programs.refetch()}
                >
                  {t('workoutPlanBulk.retryPrograms', 'Retry Programs')}
                </Button>
              </div>
            )}
          </div>
          {source && (
            <fieldset className="space-y-2">
              <legend className="font-medium">
                {t('workoutPlanBulk.fieldsToCopy', 'Fields to copy')}
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ...setFields,
                  ...(source.assignment.preset_snapshot ? presetFields : []),
                ].map((field) => (
                  <Label
                    key={field}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border p-3"
                  >
                    <Checkbox
                      disabled={pending || !!preview}
                      aria-label={fieldNames[field]}
                      checked={fields.includes(field)}
                      onCheckedChange={(checked) => {
                        setSelectedFields((current) =>
                          checked
                            ? [...current, field]
                            : current.filter((item) => item !== field)
                        );
                        resetPreview();
                      }}
                    />
                    {fieldNames[field]}
                  </Label>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                {t(
                  'workoutPlanBulk.fieldRules',
                  'Whole set collection explicitly replaces all sets. Granular set fields require identical set numbers. Presets require the exact ordered exercise UUIDs; no matching by name.'
                )}
              </p>
            </fieldset>
          )}
          {scope && (
            <section
              aria-labelledby="bulk-target-heading"
              className="space-y-3"
            >
              <h3 id="bulk-target-heading" className="font-medium">
                {t(
                  'workoutPlanBulk.chooseTargets',
                  'Choose target sessions and one assignment in each'
                )}
              </h3>
              {bulk.candidates.isLoading && (
                <p role="status">
                  {t(
                    'workoutPlanBulk.loadingCandidates',
                    'Loading candidate sessions…'
                  )}
                </p>
              )}
              {bulk.candidates.isError && (
                <div role="alert">
                  <p>
                    {t(
                      'workoutPlanBulk.candidatesFailed',
                      'Could not load candidate sessions.'
                    )}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => void bulk.candidates.refetch()}
                  >
                    {t('workoutPlanBulk.retryCandidates', 'Retry candidates')}
                  </Button>
                </div>
              )}
              {!bulk.candidates.isLoading &&
                !bulk.candidates.isError &&
                !candidates.length && (
                  <p className="text-sm text-muted-foreground">
                    {t(
                      'workoutPlanBulk.noCandidates',
                      'No candidate sessions in this scope.'
                    )}
                  </p>
                )}
              {candidates.map((candidate) => {
                const isSource =
                  candidate.workout_session_id === source?.session.id;
                const disabled = !candidate.eligible || isSource;
                return (
                  <div
                    key={candidate.workout_session_id}
                    className="space-y-2 border-b pb-4"
                  >
                    <p className="font-medium">{candidate.name}</p>
                    <p className="break-all text-xs text-muted-foreground">
                      {t(
                        'workoutPlanBulk.sessionUuid',
                        'Session UUID: {{id}}',
                        { id: candidate.workout_session_id }
                      )}
                    </p>
                    {candidate.bindings.length ? (
                      candidate.bindings.map((binding) => (
                        <p key={binding.id} className="break-words text-sm">
                          {binding.program_name} · {binding.effective_date} ·{' '}
                          {binding.name} · {binding.status}
                          <span className="block break-all text-xs text-muted-foreground">
                            {t(
                              'workoutPlanBulk.bindingIds',
                              'Program {{programId}} · Planned Session {{sessionId}}',
                              {
                                programId: binding.program_id,
                                sessionId: binding.id,
                              }
                            )}
                          </span>
                        </p>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t(
                          'workoutPlanBulk.standaloneDates',
                          'Standalone · plan dates {{start}} to {{end}}',
                          {
                            start:
                              plan.start_date ??
                              t('workoutPlanBulk.unspecified', 'Unspecified'),
                            end:
                              plan.end_date ??
                              t('workoutPlanBulk.unspecified', 'Unspecified'),
                          }
                        )}
                      </p>
                    )}
                    {disabled && (
                      <p className="text-sm text-muted-foreground">
                        {isSource
                          ? t(
                              'workoutPlanBulk.sourceNotTarget',
                              'Source session is not a target.'
                            )
                          : (candidate.reason ??
                            t(
                              'workoutPlanBulk.notEligible',
                              'Not eligible for future changes.'
                            ))}
                      </p>
                    )}
                    <Label
                      htmlFor={`target-assignment-${candidate.workout_session_id}`}
                    >
                      {t(
                        'workoutPlanBulk.targetAssignment',
                        'Target assignment'
                      )}
                    </Label>
                    <Select
                      disabled={disabled || pending || !!preview}
                      value={
                        selected[candidate.workout_session_id]
                          ? String(selected[candidate.workout_session_id])
                          : ''
                      }
                      onValueChange={(value) => {
                        setSelected((current) => ({
                          ...current,
                          [candidate.workout_session_id]: Number(value),
                        }));
                        resetPreview();
                      }}
                    >
                      <SelectTrigger
                        id={`target-assignment-${candidate.workout_session_id}`}
                        className="min-h-11"
                      >
                        <SelectValue
                          placeholder={t(
                            'workoutPlanBulk.chooseTargetAssignment',
                            'Choose an exact assignment to include'
                          )}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {candidate.assignments.map((assignment) => (
                          <SelectItem
                            key={assignment.id}
                            value={String(assignment.id)}
                          >
                            {assignment.exercise_name ??
                              assignment.preset_snapshot?.name ??
                              assignment.workout_preset_name ??
                              t(
                                'workoutPlanBulk.assignment',
                                'Assignment'
                              )}{' '}
                            · #{assignment.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Label className="flex min-h-11 items-center gap-3">
                      <Checkbox
                        aria-label={t(
                          'workoutPlanBulk.includeSession',
                          'Include {{name}}, session {{id}}',
                          {
                            name: candidate.name,
                            id: candidate.workout_session_id,
                          }
                        )}
                        disabled={
                          disabled ||
                          pending ||
                          !!preview ||
                          !selected[candidate.workout_session_id]
                        }
                        checked={included.includes(
                          candidate.workout_session_id
                        )}
                        onCheckedChange={(checked) => {
                          setIncluded((current) =>
                            checked
                              ? [...current, candidate.workout_session_id]
                              : current.filter(
                                  (id) => id !== candidate.workout_session_id
                                )
                          );
                          resetPreview();
                        }}
                      />
                      {t(
                        'workoutPlanBulk.includeTarget',
                        'Include this target (choose its assignment first)'
                      )}
                    </Label>
                  </div>
                );
              })}
            </section>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {preview && (
          <section aria-labelledby="bulk-preview-heading" className="space-y-5">
            <h3 id="bulk-preview-heading" className="text-lg font-semibold">
              {t(
                'workoutPlanBulk.reviewTargets',
                'Review {{count}} target sessions',
                {
                  count: preview.targets.length,
                  defaultValue_one: 'Review {{count}} target session',
                }
              )}
            </h3>
            {preview.targets.map((target) => (
              <div
                key={target.workout_session_id}
                className="space-y-3 border-b pb-5"
              >
                <h4 className="font-medium">
                  {t(
                    'workoutPlanBulk.targetTitle',
                    '{{name}} · Assignment #{{id}}',
                    { name: target.name, id: target.before.id }
                  )}
                </h4>
                <p className="break-all text-xs text-muted-foreground">
                  {t('workoutPlanBulk.sessionUuid', 'Session UUID: {{id}}', {
                    id: target.workout_session_id,
                  })}
                </p>
                {target.bindings.map((binding) => (
                  <p key={binding.id} className="text-sm">
                    {binding.program_name} · {binding.effective_date} ·{' '}
                    {binding.name}
                  </p>
                ))}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <h5 className="font-semibold">
                      {t('workoutPlanBulk.before', 'Before')}
                    </h5>
                    <PrescriptionValues
                      assignment={target.before}
                      fields={preview.request.fields}
                    />
                  </div>
                  <div className="space-y-2">
                    <h5 className="font-semibold">
                      {t('workoutPlanBulk.after', 'After')}
                    </h5>
                    <PrescriptionValues
                      assignment={target.after}
                      fields={preview.request.fields}
                    />
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={pending}
            onClick={onClose}
          >
            {t('workoutPlanBulk.close', 'Close bulk action')}
          </Button>
          {preview ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={pending}
                onClick={resetPreview}
              >
                {t('workoutPlanBulk.cancelPreview', 'Cancel preview')}
              </Button>
              <Button
                type="button"
                className="min-h-11"
                disabled={pending}
                onClick={() => void confirm()}
              >
                {bulk.apply.isPending
                  ? t('workoutPlanBulk.applying', 'Applying batch…')
                  : t(
                      'workoutPlanBulk.confirmApply',
                      'Confirm and apply to {{count}} sessions',
                      {
                        count: preview.targets.length,
                        defaultValue_one:
                          'Confirm and apply to {{count}} session',
                      }
                    )}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              className="min-h-11"
              disabled={
                pending ||
                !source ||
                !scope ||
                !fields.length ||
                !included.length ||
                bulk.candidates.isFetching
              }
              onClick={() => void makePreview()}
            >
              {bulk.preview.isPending
                ? t('workoutPlanBulk.preparingPreview', 'Preparing preview…')
                : t(
                    'workoutPlanBulk.previewSelected',
                    'Preview selected changes'
                  )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
