import { act, renderHook } from '@testing-library/react';
import { useWorkoutPlanAssignments } from '@/hooks/Exercises/useWorkoutPlanAssignments';
import type { WorkoutPlanTemplate, WorkoutPreset } from '@/types/workout';
import type { Exercise } from '@/types/exercises';
import { apiCall } from '@/api/api';
import {
  createWorkoutPlanTemplate,
  updateWorkoutPlanTemplate,
} from '@/api/Exercises/workoutPlanTemplates';
import {
  workoutPlanCreateRequestSchema,
  workoutPlanUpdateRequestSchema,
} from '@workspace/shared';

jest.mock('@/hooks/use-toast', () => ({ toast: jest.fn() }));
jest.mock('@/api/api', () => ({ apiCall: jest.fn() }));

beforeEach(() => {
  jest.mocked(apiCall).mockReset();
});
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
const set = {
  set_number: 1,
  reps: 8,
  weight: null,
  duration: null,
  distance: 0.2,
  rest_time: 75,
  rpe: 7,
  rir: 3,
  notes: '8–10 per side',
};
const preset: WorkoutPreset = {
  id: 42,
  user_id: 'athlete',
  name: 'A',
  workout_format: 'standard',
  exercises: [
    {
      id: '9',
      exercise_id: 'exercise',
      exercise_name: 'Lunge',
      exercise: { id: 'exercise', name: 'Lunge' } as Exercise,
      sets: [set, { ...set, set_number: 2 }],
    },
  ],
};
function fixture(): WorkoutPlanTemplate {
  return {
    id: '17',
    user_id: 'athlete',
    plan_name: 'Build',
    schedule_type: 'sequential',
    sessions: [
      {
        id: firstId,
        name: 'A',
        day_of_week: null,
        is_optional: false,
        sort_order: 0,
        assignments: [
          {
            id: 101,
            workout_preset_id: 42,
            preset_snapshot: structuredClone(preset),
            sort_order: 0,
            sets: [],
          },
        ],
      },
      {
        id: secondId,
        name: 'A',
        day_of_week: null,
        is_optional: false,
        sort_order: 1,
        assignments: [
          {
            id: 102,
            workout_preset_id: 42,
            preset_snapshot: {
              ...structuredClone(preset),
              exercises: [
                {
                  ...structuredClone(preset.exercises[0]!),
                  sets: [
                    set,
                    { ...set, set_number: 2 },
                    { ...set, set_number: 3 },
                  ],
                },
              ],
            },
            sort_order: 0,
            sets: [],
          },
        ],
      },
    ],
  };
}

it('edits one repeated-label prescription without changing another session or loaded source', () => {
  const original = fixture();
  const { result } = renderHook(() => useWorkoutPlanAssignments(original));
  const changed = structuredClone(
    result.current.assignments[0]!.preset_snapshot!
  );
  changed.exercises[0]!.sets[0]!.reps = 10;
  act(() => result.current.handlePresetSnapshotChange(0, changed));
  const saved = result.current.buildSessionsForSave();
  expect(
    saved[0]!.assignments[0]!.preset_snapshot!.exercises[0]!.sets[0]!.reps
  ).toBe(10);
  expect(
    original.sessions[0]!.assignments[0]!.preset_snapshot!.exercises[0]!
      .sets[0]!.reps
  ).toBe(8);
  expect(saved[1]!.assignments[0]!.preset_snapshot).toEqual(
    original.sessions[1]!.assignments[0]!.preset_snapshot
  );
  expect(saved.map((s) => [s.id, s.assignments[0]!.id])).toEqual([
    [firstId, 101],
    [secondId, 102],
  ]);
});

it('keeps UUID membership and persisted assignment IDs when reordering or removing sessions', () => {
  const { result } = renderHook(() => useWorkoutPlanAssignments(fixture()));
  act(() => result.current.moveSession(secondId, 'up'));
  expect(
    result.current
      .buildSessionsForSave()
      .map((s) => [s.id, s.sort_order, s.assignments[0]!.id])
  ).toEqual([
    [secondId, 0, 102],
    [firstId, 1, 101],
  ]);
  act(() => result.current.removeSession(firstId));
  expect(
    result.current
      .buildSessionsForSave()
      .map((s) => [s.id, s.assignments[0]!.id])
  ).toEqual([[secondId, 102]]);
});

it('copies a full frozen preset into another session without sharing mutable prescriptions or assignment identities', () => {
  const { result } = renderHook(() => useWorkoutPlanAssignments(fixture()));
  act(() =>
    result.current.handleCopyAssignment(result.current.assignments[0]!)
  );
  act(() => result.current.handlePasteAssignment(secondId));
  const pasted = result.current.assignments[2]!;
  const changed = structuredClone(pasted.preset_snapshot!);
  changed.exercises[0]!.sets[0]!.rest_time = 120;
  act(() => result.current.handlePresetSnapshotChange(2, changed));
  const saved = result.current.buildSessionsForSave();
  expect(saved[1]!.assignments[1]!.id).toBeUndefined();
  expect(
    saved[1]!.assignments[1]!.preset_snapshot!.exercises[0]!.sets[0]
  ).toMatchObject({ ...set, rest_time: 120 });
  expect(
    saved[0]!.assignments[0]!.preset_snapshot!.exercises[0]!.sets[0]
  ).toEqual(set);
});

it('preserves null, zero and complete per-set fields for individual exercises through local editing', () => {
  const plan = fixture();
  plan.sessions[0]!.assignments = [
    {
      id: 101,
      exercise_id: 'exercise',
      sets: [set, { ...set, set_number: 2, weight: 0 }],
    },
  ];
  const { result } = renderHook(() => useWorkoutPlanAssignments(plan));
  act(() => result.current.handleSetChangeInPlan(0, 0, 'reps', 9));
  const saved = result.current.buildSessionsForSave()[0]!.assignments[0]!;
  expect(saved.sets[0]).toMatchObject({ ...set, reps: 9 });
  expect(saved.sets[1]!.weight).toBe(0);
  act(() => result.current.handleDuplicateSetInPlan(0, 0));
  expect(
    result.current
      .buildSessionsForSave()[0]!
      .assignments[0]!.sets.map((s) => [
        s.set_number,
        s.reps,
        s.weight,
        s.rpe,
        s.rest_time,
      ])
  ).toEqual([
    [1, 9, null, 7, 75],
    [2, 9, null, 7, 75],
    [3, 8, 0, 7, 75],
  ]);
});

it('keeps weekly membership independent even on the same weekday and freezes picker prescriptions', () => {
  const { result } = renderHook(() => useWorkoutPlanAssignments(null));
  act(() => result.current.addSession());
  const ids = result.current.sessions.map((s) => s.id);
  const pickedPreset = structuredClone(preset);
  act(() => {
    result.current.setScheduleType('weekly');
    ids.forEach((id) => result.current.setSessionDay(id, 2));
    result.current.handleAddExerciseOrPreset(pickedPreset, 'preset', ids[0]);
    result.current.handleAddExerciseOrPreset(
      {
        id: 'run',
        name: 'Run',
        category: 'Cardio',
        modality: 'duration_distance',
      } as Exercise,
      'internal',
      ids[1]
    );
  });
  pickedPreset.exercises[0]!.sets[0]!.reps = 99;
  const saved = result.current.buildSessionsForSave();
  expect(
    saved.map((s) => [s.id, s.day_of_week, s.assignments[0]!.exercise_id])
  ).toEqual([
    [undefined, 2, undefined],
    [undefined, 2, 'run'],
  ]);
  expect(
    saved[0]!.assignments[0]!.preset_snapshot!.exercises[0]!.sets[0]!.reps
  ).toBe(8);
  expect(saved[1]!.assignments[0]!.sets[0]).toMatchObject({
    reps: null,
    weight: null,
  });
});

it('creates repeated-label sessions without sending editor UUIDs as persisted identities', async () => {
  jest.mocked(apiCall).mockResolvedValue({ id: 17 });
  const { result } = renderHook(() => useWorkoutPlanAssignments(null));
  act(() => result.current.addSession());
  const first = result.current.sessions[0];
  const second = result.current.sessions[1];
  if (!first || !second)
    throw new Error('The authoring draft must contain both sessions.');
  const laterPrescription = structuredClone(preset);
  const exercise = laterPrescription.exercises[0];
  if (!exercise)
    throw new Error('The library preset must contain its prescribed exercise.');
  exercise.sets.push({ ...set, set_number: 3 });
  act(() => {
    result.current.setSessionName(first.id, 'A');
    result.current.setSessionName(second.id, 'A');
    result.current.setSessionOptional(second.id, true);
    result.current.handleAddExerciseOrPreset(preset, 'preset', first.id);
    result.current.handleAddExerciseOrPreset(preset, 'preset', second.id);
  });
  act(() => result.current.handlePresetSnapshotChange(1, laterPrescription));
  await createWorkoutPlanTemplate({
    plan_name: 'Build',
    schedule_type: 'sequential',
    sessions: result.current.buildSessionsForSave(),
  });
  const request = jest.mocked(apiCall).mock.calls[0]?.[1];
  if (typeof request?.body !== 'string')
    throw new Error('Plan creation must serialize its request body.');
  const payload = workoutPlanCreateRequestSchema.parse(
    JSON.parse(request.body)
  );
  expect(payload.sessions.map((session) => session.is_optional)).toEqual([
    false,
    true,
  ]);
  expect(
    payload.sessions.map((session) => [
      session.id,
      session.name,
      session.sort_order,
    ])
  ).toEqual([
    [undefined, 'A', 0],
    [undefined, 'A', 1],
  ]);
  payload.sessions.forEach((session) =>
    expect(session).not.toHaveProperty('id')
  );
  expect(
    payload.sessions.map((session) =>
      session.assignments.flatMap(
        (assignment) =>
          assignment.preset_snapshot?.exercises.flatMap((item) =>
            item.sets.map((prescription) => prescription.reps)
          ) ?? []
      )
    )
  ).toEqual([
    [8, 8],
    [8, 8, 8],
  ]);
  expect(result.current.sessions.map((session) => session.id)).toEqual([
    first.id,
    second.id,
  ]);
  expect(
    preset.exercises[0]?.sets.map((prescription) => prescription.reps)
  ).toEqual([8, 8]);
});

it('preserves loaded session and assignment identities while adding and reordering a new session on update', async () => {
  jest.mocked(apiCall).mockResolvedValue({ id: 17 });
  const original = fixture();
  original.sessions[1]!.is_optional = true;
  const { result } = renderHook(() => useWorkoutPlanAssignments(original));
  act(() => result.current.addSession());
  const added = result.current.sessions[2];
  if (!added)
    throw new Error('Adding a session must retain its editor identity.');
  act(() => {
    result.current.setSessionName(added.id, 'A');
    result.current.handleAddExerciseOrPreset(preset, 'preset', added.id);
    result.current.moveSession(added.id, 'up');
    result.current.moveSession(added.id, 'up');
    result.current.moveSession(secondId, 'up');
  });
  await updateWorkoutPlanTemplate(original.id, {
    schedule_type: 'sequential',
    sessions: result.current.buildSessionsForSave(),
  });
  const request = jest.mocked(apiCall).mock.calls[0]?.[1];
  if (typeof request?.body !== 'string')
    throw new Error('Plan update must serialize its request body.');
  const payload = workoutPlanUpdateRequestSchema.parse(
    JSON.parse(request.body)
  );
  if (!payload.sessions)
    throw new Error('Plan update must contain the authored sessions.');
  expect(payload.sessions.map((session) => session.is_optional)).toEqual([
    false,
    true,
    false,
  ]);
  expect(
    payload.sessions.map((session) => [
      session.id,
      session.sort_order,
      session.assignments.map((assignment) => assignment.id),
    ])
  ).toEqual([
    [undefined, 0, [undefined]],
    [secondId, 1, [102]],
    [firstId, 2, [101]],
  ]);
  expect(payload.sessions[0]).not.toHaveProperty('id');
  expect(
    payload.sessions
      .slice(1)
      .map((session) =>
        session.assignments.flatMap(
          (assignment) =>
            assignment.preset_snapshot?.exercises.flatMap((item) =>
              item.sets.map((prescription) => prescription.reps)
            ) ?? []
        )
      )
  ).toEqual([
    [8, 8, 8],
    [8, 8],
  ]);
  expect(result.current.sessions.map((session) => session.id)).toEqual([
    added.id,
    secondId,
    firstId,
  ]);
  expect(original.sessions.map((session) => session.id)).toEqual([
    firstId,
    secondId,
  ]);
});
