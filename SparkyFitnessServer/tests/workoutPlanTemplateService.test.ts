import { beforeEach, describe, expect, it, vi } from 'vitest';
import workoutPlanTemplateService from '../services/workoutPlanTemplateService.js';
import workoutPlanTemplateRepository from '../models/workoutPlanTemplateRepository.js';
import type {
  WorkoutPlanCreateRequest,
  WorkoutPlanUpdateRequest,
} from '@workspace/shared';

vi.mock('../models/workoutPlanTemplateRepository.js', () => ({
  default: {
    createWorkoutPlanTemplate: vi.fn(),
    getWorkoutPlanTemplateById: vi.fn(),
    updateWorkoutPlanTemplate: vi.fn(),
    deleteWorkoutPlanTemplate: vi.fn(),
    getWorkoutPlanTemplateOwnerId: vi.fn(),
  },
}));
vi.mock('../utils/timezoneLoader.js', () => ({
  resolveTemplateStartDay: vi.fn(async () => '2026-10-25'),
}));

const OWNER = 'owner';
const OTHER = 'other';
const PLAN = 1;
const SESSION = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const EXERCISE = '33333333-3333-4333-8333-333333333333';
const assignment = () => ({
  id: 1,
  exercise_id: EXERCISE,
  sort_order: 0,
  sets: [{ set_number: 1, reps: 8, weight: null }],
});
const planInput = (): WorkoutPlanCreateRequest => ({
  plan_name: 'A sessions',
  schedule_type: 'sequential',
  sessions: [
    {
      id: SESSION,
      name: 'A',
      day_of_week: null,
      sort_order: 0,
      assignments: [assignment()],
    },
  ],
});

describe('workoutPlanTemplateService authorization and nested validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['update', 'delete'] as const)(
    'denies %s by a non-owner without mutating the plan',
    async (action) => {
      vi.mocked(
        workoutPlanTemplateRepository.getWorkoutPlanTemplateOwnerId
      ).mockResolvedValue(OTHER);
      const result =
        action === 'update'
          ? workoutPlanTemplateService.updateWorkoutPlanTemplate(OWNER, PLAN, {
              plan_name: 'Changed',
            })
          : workoutPlanTemplateService.deleteWorkoutPlanTemplate(OWNER, PLAN);
      await expect(result).rejects.toMatchObject({ status: 403 });
      expect(
        workoutPlanTemplateRepository.updateWorkoutPlanTemplate
      ).not.toHaveBeenCalled();
      expect(
        workoutPlanTemplateRepository.deleteWorkoutPlanTemplate
      ).not.toHaveBeenCalled();
    }
  );

  it.each(['read', 'update', 'delete'] as const)(
    'returns not-found for inaccessible %s identity',
    async (action) => {
      vi.mocked(
        workoutPlanTemplateRepository.getWorkoutPlanTemplateOwnerId
      ).mockResolvedValue(null);
      vi.mocked(
        workoutPlanTemplateRepository.getWorkoutPlanTemplateById
      ).mockResolvedValue(null);
      const result =
        action === 'read'
          ? workoutPlanTemplateService.getWorkoutPlanTemplateById(OWNER, PLAN)
          : action === 'update'
            ? workoutPlanTemplateService.updateWorkoutPlanTemplate(
                OWNER,
                PLAN,
                { plan_name: 'Changed' }
              )
            : workoutPlanTemplateService.deleteWorkoutPlanTemplate(OWNER, PLAN);
      await expect(result).rejects.toMatchObject({ status: 404 });
      expect(
        workoutPlanTemplateRepository.updateWorkoutPlanTemplate
      ).not.toHaveBeenCalled();
      expect(
        workoutPlanTemplateRepository.deleteWorkoutPlanTemplate
      ).not.toHaveBeenCalled();
    }
  );

  it.each(['create', 'update'] as const)(
    'rejects duplicate session identities in %s before persistence',
    async (action) => {
      const input = planInput();
      input.sessions.push({
        ...input.sessions[0]!,
        assignments: [],
        sort_order: 1,
      });
      const result =
        action === 'create'
          ? workoutPlanTemplateService.createWorkoutPlanTemplate(OWNER, input)
          : workoutPlanTemplateService.updateWorkoutPlanTemplate(
              OWNER,
              PLAN,
              input
            );
      await expect(result).rejects.toMatchObject({ status: 400 });
      expect(
        workoutPlanTemplateRepository.createWorkoutPlanTemplate
      ).not.toHaveBeenCalled();
      expect(
        workoutPlanTemplateRepository.updateWorkoutPlanTemplate
      ).not.toHaveBeenCalled();
    }
  );

  it.each(['create', 'update'] as const)(
    'rejects one assignment identity in two different sessions on %s',
    async (action) => {
      const input = planInput();
      input.sessions.push({ ...input.sessions[0]!, id: SECOND, sort_order: 1 });
      const result =
        action === 'create'
          ? workoutPlanTemplateService.createWorkoutPlanTemplate(OWNER, input)
          : workoutPlanTemplateService.updateWorkoutPlanTemplate(
              OWNER,
              PLAN,
              input
            );
      await expect(result).rejects.toMatchObject({ status: 400 });
      expect(
        workoutPlanTemplateRepository.createWorkoutPlanTemplate
      ).not.toHaveBeenCalled();
      expect(
        workoutPlanTemplateRepository.updateWorkoutPlanTemplate
      ).not.toHaveBeenCalled();
    }
  );

  it.each([-1, 7])(
    'rejects weekday %s without writing any sessions',
    async (day) => {
      const input = planInput();
      input.schedule_type = 'weekly';
      input.sessions[0]!.day_of_week = day;
      await expect(
        workoutPlanTemplateService.createWorkoutPlanTemplate(OWNER, input)
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        workoutPlanTemplateService.updateWorkoutPlanTemplate(OWNER, PLAN, input)
      ).rejects.toMatchObject({ status: 400 });
      expect(
        workoutPlanTemplateRepository.createWorkoutPlanTemplate
      ).not.toHaveBeenCalled();
      expect(
        workoutPlanTemplateRepository.updateWorkoutPlanTemplate
      ).not.toHaveBeenCalled();
    }
  );

  it('rejects the obsolete flat authoring body instead of silently discarding its assignments', async () => {
    const legacy = {
      plan_name: 'Legacy',
      assignments: [{ exercise_id: EXERCISE, session_index: 1 }],
    };
    await expect(
      workoutPlanTemplateService.createWorkoutPlanTemplate(
        OWNER,
        legacy as unknown as WorkoutPlanCreateRequest
      )
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      workoutPlanTemplateService.updateWorkoutPlanTemplate(
        OWNER,
        PLAN,
        legacy as unknown as WorkoutPlanUpdateRequest
      )
    ).rejects.toMatchObject({ status: 400 });
    expect(
      workoutPlanTemplateRepository.createWorkoutPlanTemplate
    ).not.toHaveBeenCalled();
    expect(
      workoutPlanTemplateRepository.updateWorkoutPlanTemplate
    ).not.toHaveBeenCalled();
  });
});
