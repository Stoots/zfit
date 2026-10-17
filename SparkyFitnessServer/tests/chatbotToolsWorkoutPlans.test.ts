import {
  workoutPlanCreateRequestSchema,
  workoutPlanUpdateRequestSchema,
} from '@workspace/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/workoutPlanTemplateService.js', () => ({
  default: {
    getWorkoutPlanTemplatesByUserId: vi.fn(),
    getWorkoutPlanTemplateById: vi.fn(),
    getActiveWorkoutPlanForDate: vi.fn(),
    createWorkoutPlanTemplate: vi.fn(),
    updateWorkoutPlanTemplate: vi.fn(),
    deleteWorkoutPlanTemplate: vi.fn(),
  },
}));
vi.mock('../models/workoutPresetRepository.js', () => ({
  default: {
    getWorkoutPresetByName: vi.fn(),
    getWorkoutPresetById: vi.fn(),
  },
}));
vi.mock('../services/exerciseService.js', () => ({
  default: { searchExercises: vi.fn() },
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

import workoutPlanTemplateService from '../services/workoutPlanTemplateService.js';
import workoutPresetRepository from '../models/workoutPresetRepository.js';
import exerciseService from '../services/exerciseService.js';
import { buildWorkoutPlanTools } from '../ai/tools/workoutPlanTools.js';
import { HttpError } from '../utils/errors.js';
import { toolOpts } from './helpers/toolExecutionOptions.js';

const svc = vi.mocked(workoutPlanTemplateService);
const presets = vi.mocked(workoutPresetRepository);
const sessionA = '11111111-1111-4111-8111-111111111111';
const sessionB = '22222222-2222-4222-8222-222222222222';
const exerciseId = '33333333-3333-4333-8333-333333333333';
const set = {
  set_number: 1,
  set_type: 'Working Set',
  reps: 8,
  weight: null,
  duration: null,
  distance: null,
  rest_time: 90,
  notes: '8–10 reps; RPE 7; each side',
};
const preset = {
  id: 7,
  name: 'Strength',
  description: null,
  workout_format: 'standard',
  exercises: [
    {
      id: 70,
      exercise_id: exerciseId,
      exercise_name: 'Row',
      image_url: null,
      category: 'Strength',
      modality: 'weight_reps',
      superset_group: null,
      progression_mode: 'manual',
      ramp_increment: null,
      sets: [{ id: 700, ...set }],
    },
  ],
};
const assignment = (count: number) => ({
  exercise_id: exerciseId,
  exercise_name: 'Row',
  sort_order: 0,
  sets: Array.from({ length: count }, (_, index) => ({
    ...set,
    set_number: index + 1,
  })),
});
const sessions = () => [
  {
    id: sessionA,
    name: 'A',
    day_of_week: null,
    sort_order: 0,
    assignments: [{ id: 10, ...assignment(2) }],
  },
  {
    id: sessionB,
    name: 'A',
    day_of_week: null,
    sort_order: 1,
    assignments: [{ id: 11, ...assignment(3) }],
  },
];
const execute = (args: unknown) =>
  buildWorkoutPlanTools('user-1', 'UTC').sparky_manage_workout_plans.execute!(
    args as never,
    toolOpts
  );

describe('AI independently prescribed Workout Sessions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    svc.createWorkoutPlanTemplate.mockResolvedValue({
      id: 42,
      plan_name: 'Cycle',
    } as never);
    svc.updateWorkoutPlanTemplate.mockResolvedValue({
      id: 42,
      plan_name: 'Cycle',
    } as never);
    svc.getWorkoutPlanTemplateById.mockResolvedValue({
      id: 42,
      plan_name: 'Cycle',
      schedule_type: 'sequential',
      entry_mode: 'prompt',
      sessions: sessions(),
    } as never);
  });

  it('counts distinct session identities even when labels and weekdays repeat', async () => {
    svc.getWorkoutPlanTemplatesByUserId.mockResolvedValue([
      {
        id: 42,
        plan_name: 'Cycle',
        schedule_type: 'weekly',
        sessions: sessions().map((session) => ({ ...session, day_of_week: 1 })),
      },
    ] as never);
    expect(await execute({ action: 'list_workout_plans' })).toContain(
      'weekly, 2 sessions'
    );
  });

  it('displays same-label sessions separately with their exact identities and different prescriptions', async () => {
    const result = await execute({ action: 'get_workout_plan', plan_id: 42 });
    expect(result).toContain(`Session 1 — A (ID: ${sessionA})`);
    expect(result).toContain(`Session 2 — A (ID: ${sessionB})`);
    expect(result).toContain('Row — 2 sets');
    expect(result).toContain('Row — 3 sets');
  });

  it('creates two independent same-label sessions and preserves null load and detailed notes', async () => {
    const result = await execute({
      action: 'create_workout_plan',
      plan_name: 'Cycle',
      sessions: sessions().map((session) => ({
        ...session,
        assignments: session.assignments.map(
          ({ exercise_name: _name, ...item }) => item
        ),
      })),
    });
    expect(result).toContain('Workout plan "Cycle" created');
    expect(svc.createWorkoutPlanTemplate).toHaveBeenCalledTimes(1);
    const input = workoutPlanCreateRequestSchema.parse(
      svc.createWorkoutPlanTemplate.mock.calls[0]![1]
    );
    expect(input.sessions).toHaveLength(2);
    expect(input.sessions[0]!.assignments[0]!.sets).toHaveLength(2);
    expect(input.sessions[1]!.assignments[0]!.sets).toHaveLength(3);
    expect(input.sessions[0]!.assignments[0]!.sets![0]).toEqual(set);
    expect(input.sessions.map((session) => session.id)).toEqual([
      sessionA,
      sessionB,
    ]);
  });

  it('resolves exercise names inside nested assignments without grouping session labels', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([
      { id: exerciseId, name: 'Row' },
    ] as never);
    const result = await execute({
      action: 'create_workout_plan',
      plan_name: 'Cycle',
      sessions: [
        { name: 'A', assignments: [{ exercise_name: 'Row', sets: [set] }] },
      ],
    });
    expect(result).toContain('Workout plan "Cycle" created');
    expect(svc.createWorkoutPlanTemplate).toHaveBeenCalledTimes(1);
    expect(
      workoutPlanCreateRequestSchema.parse(
        svc.createWorkoutPlanTemplate.mock.calls[0]![1]
      ).sessions[0]!.assignments[0]!.exercise_id
    ).toBe(exerciseId);
  });

  it('rejects invalid live preset prescriptions before creating a plan instead of forwarding malformed snapshots', async () => {
    presets.getWorkoutPresetById.mockResolvedValue({
      ...preset,
      exercises: [{ ...preset.exercises[0], modality: 'strength' }],
    } as never);
    const result = await execute({
      action: 'create_workout_plan',
      plan_name: 'Cycle',
      sessions: [{ name: 'A', assignments: [{ workout_preset_id: 7 }] }],
    });
    expect(result).toContain('VALIDATION');
    expect(svc.createWorkoutPlanTemplate).not.toHaveBeenCalled();
  });

  it('freezes complete preset exercise/set prescriptions by ID at authoring', async () => {
    presets.getWorkoutPresetById.mockResolvedValue(preset as never);
    const result = await execute({
      action: 'create_workout_plan',
      plan_name: 'Cycle',
      sessions: [{ name: 'A', assignments: [{ workout_preset_id: 7 }] }],
    });
    expect(result).toContain('Workout plan "Cycle" created');
    expect(svc.createWorkoutPlanTemplate).toHaveBeenCalledTimes(1);
    const snapshot = workoutPlanCreateRequestSchema.parse(
      svc.createWorkoutPlanTemplate.mock.calls[0]![1]
    ).sessions[0]!.assignments[0]!.preset_snapshot;
    expect(presets.getWorkoutPresetById).toHaveBeenCalledWith(7, 'user-1');
    expect(snapshot).toEqual(preset);
    preset.exercises[0]!.sets[0]!.notes = 'Library changed';
    expect(snapshot!.exercises[0]!.sets[0]!.notes).toBe(set.notes);
    preset.exercises[0]!.sets[0]!.notes = set.notes;
  });

  it('resolves a preset name and snapshots the full accessible detail', async () => {
    presets.getWorkoutPresetByName.mockResolvedValue(preset as never);
    presets.getWorkoutPresetById.mockResolvedValue(preset as never);
    const result = await execute({
      action: 'create_workout_plan',
      plan_name: 'Cycle',
      sessions: JSON.stringify([
        { name: 'A', assignments: [{ preset_name: 'Strength' }] },
      ]),
    });
    expect(result).toContain('Workout plan "Cycle" created');
    expect(svc.createWorkoutPlanTemplate).toHaveBeenCalledTimes(1);
    expect(
      workoutPlanCreateRequestSchema.parse(
        svc.createWorkoutPlanTemplate.mock.calls[0]![1]
      ).sessions[0]!.assignments[0]!.preset_snapshot!.exercises[0]!.sets[0]
    ).toEqual({ id: 700, ...set });
  });

  it('retains an edited frozen preset without consulting the live library', async () => {
    const result = await execute({
      action: 'update_workout_plan',
      plan_id: 42,
      confirmed: true,
      sessions: [
        {
          id: sessionA,
          name: 'A',
          day_of_week: null,
          assignments: [
            { id: 10, workout_preset_id: 7, preset_snapshot: preset },
          ],
        },
      ],
    });
    expect(result).toContain('Workout plan "Cycle" updated');
    expect(svc.updateWorkoutPlanTemplate).toHaveBeenCalledTimes(1);
    expect(presets.getWorkoutPresetById).not.toHaveBeenCalled();
    expect(presets.getWorkoutPresetByName).not.toHaveBeenCalled();
    expect(
      workoutPlanUpdateRequestSchema.parse(
        svc.updateWorkoutPlanTemplate.mock.calls[0]![2]
      ).sessions![0]!.assignments[0]
    ).toMatchObject({ id: 10, preset_snapshot: preset });
  });

  it('does not refresh existing preset assignments whose snapshot was omitted', async () => {
    const result = await execute({
      action: 'update_workout_plan',
      plan_id: 42,
      confirmed: true,
      sessions: [
        {
          id: sessionA,
          name: 'A',
          assignments: [{ id: 10, workout_preset_id: 7 }],
        },
      ],
    });
    expect(result).toContain('retain their frozen preset_snapshot');
    expect(presets.getWorkoutPresetById).not.toHaveBeenCalled();
    expect(svc.updateWorkoutPlanTemplate).not.toHaveBeenCalled();
  });

  it('uses only selected next-session assignments and frozen preset labels for progression', async () => {
    svc.getActiveWorkoutPlanForDate.mockResolvedValue([
      {
        id: 42,
        plan_name: 'Cycle',
        schedule_type: 'sequential',
        sessions: sessions(),
        next_session: { ...sessions()[1], name: 'Second A' },
        next_assignments: [{ id: 11, preset_snapshot: preset }],
        sequence_position: { current: 2, total: 2 },
      },
    ] as never);
    const result = await execute({
      action: 'get_active_workout_plan',
      date: '2026-10-11',
    });
    expect(result).toContain('Session 2 of 2 — Second A');
    expect(result).toContain('Strength (preset) — 1 set');
    expect(result).not.toContain('Row — 2 sets');
    expect(presets.getWorkoutPresetById).not.toHaveBeenCalled();
  });

  it('reports a weekly rest day instead of falling back to a stored session', async () => {
    svc.getActiveWorkoutPlanForDate.mockResolvedValue([
      {
        id: 42,
        plan_name: 'Cycle',
        schedule_type: 'weekly',
        sessions: sessions(),
        next_session: null,
        next_assignments: [],
      },
    ] as never);
    expect(
      await execute({ action: 'get_active_workout_plan', date: '2026-10-11' })
    ).toContain('Rest day: nothing scheduled for Sunday');
  });

  it.each([
    { assignments: [{ exercise_id: exerciseId }] },
    {
      sessions: [
        {
          name: 'A',
          assignments: [{ exercise_id: exerciseId, session_index: 1 }],
        },
      ],
    },
    {
      sessions: [
        {
          name: 'A',
          assignments: [{ exercise_id: exerciseId, session_name: 'A' }],
        },
      ],
    },
    { sessions: '[{"name":"A","assignments":[{"exercise_id":"bad"}]}]' },
    { sessions: 'invalid JSON' },
    {
      schedule_type: 'weekly',
      sessions: [{ name: 'A', assignments: [{ exercise_id: exerciseId }] }],
    },
    {
      sessions: [
        {
          name: 'A',
          assignments: [{ workout_preset_id: 7, exercise_id: exerciseId }],
        },
      ],
    },
  ])(
    'rejects obsolete, malformed, or ambiguous authoring without writes: %j',
    async (payload) => {
      expect(
        await execute({
          action: 'create_workout_plan',
          plan_name: 'Cycle',
          ...payload,
        })
      ).toContain('VALIDATION');
      expect(svc.createWorkoutPlanTemplate).not.toHaveBeenCalled();
    }
  );

  it('requires confirmation before inspecting or mutating a plan', async () => {
    expect(
      await execute({ action: 'update_workout_plan', plan_id: 42 })
    ).toContain('Nothing was changed');
    expect(
      await execute({ action: 'delete_workout_plan', plan_id: 42 })
    ).toContain('Nothing was deleted');
    expect(svc.getWorkoutPlanTemplateById).not.toHaveBeenCalled();
    expect(svc.updateWorkoutPlanTemplate).not.toHaveBeenCalled();
    expect(svc.deleteWorkoutPlanTemplate).not.toHaveBeenCalled();
  });

  it('keeps weekly prefill and session prescriptions unchanged during metadata edits', async () => {
    svc.getWorkoutPlanTemplateById.mockResolvedValue({
      id: 42,
      plan_name: 'Cycle',
      schedule_type: 'weekly',
      entry_mode: 'prefill',
      sessions: sessions(),
    } as never);
    const result = await execute({
      action: 'update_workout_plan',
      plan_id: 42,
      confirmed: true,
      description: null,
      end_date: null,
    });
    expect(result).toContain('Workout plan "Cycle" updated');
    expect(svc.updateWorkoutPlanTemplate).toHaveBeenCalledTimes(1);
    expect(svc.updateWorkoutPlanTemplate.mock.calls[0]![2]).toMatchObject({
      schedule_type: 'weekly',
      entry_mode: 'prefill',
      description: null,
      end_date: null,
      sessions: undefined,
    });
    expect(presets.getWorkoutPresetById).not.toHaveBeenCalled();
  });

  it('does not report an inaccessible preset as a missing workout plan', async () => {
    presets.getWorkoutPresetById.mockResolvedValue(null);
    expect(
      await execute({
        action: 'create_workout_plan',
        plan_name: 'Cycle',
        sessions: [{ name: 'A', assignments: [{ workout_preset_id: 7 }] }],
      })
    ).toContain('VALIDATION');
    expect(svc.createWorkoutPlanTemplate).not.toHaveBeenCalled();
  });

  it('retains frozen prescriptions after the live preset has been deleted without resurrecting its ID', async () => {
    const result = await execute({
      action: 'update_workout_plan',
      plan_id: 42,
      confirmed: true,
      sessions: [
        {
          id: sessionA,
          name: 'A',
          day_of_week: null,
          assignments: [
            {
              id: 10,
              workout_preset_id: null,
              exercise_id: null,
              preset_snapshot: preset,
            },
          ],
        },
      ],
    });
    expect(result).toContain('Workout plan "Cycle" updated');
    expect(svc.updateWorkoutPlanTemplate).toHaveBeenCalledTimes(1);
    expect(presets.getWorkoutPresetById).not.toHaveBeenCalled();
    expect(presets.getWorkoutPresetByName).not.toHaveBeenCalled();
    expect(
      workoutPlanUpdateRequestSchema.parse(
        svc.updateWorkoutPlanTemplate.mock.calls[0]![2]
      ).sessions![0]!.assignments[0]
    ).toMatchObject({
      id: 10,
      workout_preset_id: null,
      exercise_id: null,
      preset_snapshot: preset,
    });
  });

  it.each([
    [
      { id: sessionA, name: 'A', assignments: [{ exercise_id: exerciseId }] },
      { id: sessionA, name: 'B', assignments: [{ exercise_id: exerciseId }] },
    ],
    [
      { name: 'A', assignments: [{ id: 10, exercise_id: exerciseId }] },
      { name: 'B', assignments: [{ id: 10, exercise_id: exerciseId }] },
    ],
    [
      {
        name: 'A',
        assignments: [{ exercise_id: exerciseId, sets: [set, set] }],
      },
    ],
    [{ name: 'A', day_of_week: 1, assignments: [{ exercise_id: exerciseId }] }],
  ])(
    'rejects conflicting session identities, assignment identities, set numbers, or sequential weekdays: %j',
    async (...invalidSessions) => {
      expect(
        await execute({
          action: 'create_workout_plan',
          plan_name: 'Cycle',
          sessions: invalidSessions,
        })
      ).toContain('VALIDATION');
      expect(svc.createWorkoutPlanTemplate).not.toHaveBeenCalled();
    }
  );

  it('preserves an explicitly unspecified set type rather than inventing a prescription', async () => {
    const result = await execute({
      action: 'create_workout_plan',
      plan_name: 'Cycle',
      sessions: [
        {
          name: 'A',
          assignments: [
            { exercise_id: exerciseId, sets: [{ ...set, set_type: null }] },
          ],
        },
      ],
    });
    expect(result).toContain('Workout plan "Cycle" created');
    expect(svc.createWorkoutPlanTemplate).toHaveBeenCalledTimes(1);
    expect(
      workoutPlanCreateRequestSchema.parse(
        svc.createWorkoutPlanTemplate.mock.calls[0]![1]
      ).sessions[0]!.assignments[0]!.sets![0]!.set_type
    ).toBeNull();
  });

  it.each([
    'A supplied session ID does not belong to this plan or is duplicated.',
    'Sequential sessions must have a null weekday.',
    'Changing schedule_type requires providing sessions.',
  ])(
    'preserves a repository 400 as actionable validation: %s',
    async (message) => {
      svc.updateWorkoutPlanTemplate.mockRejectedValue(
        Object.assign(new Error(message), { status: 400 })
      );

      const result = await execute({
        action: 'update_workout_plan',
        plan_id: 42,
        confirmed: true,
      });

      expect(result).toBe(`Error [VALIDATION]: ${message}`);
    }
  );

  it.each([
    'A diary-linked assignment cannot be changed to another exercise or preset. Create a new assignment instead.',
    'Remove the exact Workout Session references from Training Programs before deleting a session.',
    'Diary-linked assignments cannot be removed; their identity and history links must be retained.',
  ])(
    'preserves a repository 409 as actionable validation: %s',
    async (message) => {
      svc.updateWorkoutPlanTemplate.mockRejectedValue(
        new HttpError(message, 409)
      );

      const result = await execute({
        action: 'update_workout_plan',
        plan_id: 42,
        confirmed: true,
      });

      expect(result).toBe(`Error [VALIDATION]: ${message}`);
    }
  );

  it('preserves a plan deletion conflict as actionable validation', async () => {
    const message =
      'This Workout Plan has diary-linked assignments and cannot be deleted without removing their history links explicitly.';
    svc.deleteWorkoutPlanTemplate.mockRejectedValue(
      new HttpError(message, 409)
    );

    const result = await execute({
      action: 'delete_workout_plan',
      plan_id: 42,
      confirmed: true,
    });

    expect(result).toBe(`Error [VALIDATION]: ${message}`);
  });

  it('reports a repository missing preset as validation rather than a missing Workout plan', async () => {
    presets.getWorkoutPresetById.mockResolvedValue(preset as never);
    svc.createWorkoutPlanTemplate.mockRejectedValue(
      Object.assign(new Error('Workout preset not found or not accessible.'), {
        status: 400,
      })
    );

    const result = await execute({
      action: 'create_workout_plan',
      plan_name: 'Cycle',
      sessions: [{ name: 'A', assignments: [{ workout_preset_id: 7 }] }],
    });

    expect(result).toBe(
      'Error [VALIDATION]: Workout preset not found or not accessible.'
    );
  });

  it('returns database errors without retrying writes', async () => {
    svc.createWorkoutPlanTemplate.mockRejectedValue(
      new Error('Database unavailable')
    );
    expect(
      await execute({
        action: 'create_workout_plan',
        plan_name: 'Cycle',
        sessions: [],
      })
    ).toContain('DB_ERROR');
    expect(svc.createWorkoutPlanTemplate).toHaveBeenCalledTimes(1);
  });
});
