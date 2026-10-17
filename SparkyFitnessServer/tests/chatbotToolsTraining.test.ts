import { describe, expect, it, vi } from 'vitest';
import { buildTrainingAnalysisTools } from '../ai/tools/trainingAnalysisTools.js';
import { toolOpts } from './helpers/toolExecutionOptions.js';
import type { TrainingAnalysisScope } from '@workspace/shared';

const { query, release } = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({
  getClient: vi.fn(async () => ({ query, release })),
}));

vi.mock('../models/trainingProgramRepository.js', () => ({
  getTrainingPrograms: vi.fn(),
}));
vi.mock('../models/workoutPlanTemplateRepository.js', () => ({
  default: { getWorkoutPlanTemplateById: vi.fn() },
}));
import { getTrainingPrograms } from '../models/trainingProgramRepository.js';
import workoutPlanTemplateRepository from '../models/workoutPlanTemplateRepository.js';

import { getClient } from '../db/poolManager.js';

describe('training analysis read tools', () => {
  it.each<{
    label: string;
    testTypes: TrainingAnalysisScope['test_types'];
    attemptDate: string;
    discloseResults: boolean;
  }>([
    {
      label: 'unselected tests',
      testTypes: [],
      attemptDate: '2026-10-02',
      discloseResults: false,
    },
    {
      label: 'another selected protocol',
      testTypes: ['cooper_run'],
      attemptDate: '2026-10-02',
      discloseResults: false,
    },
    {
      label: 'a late linked attempt',
      testTypes: ['ramp'],
      attemptDate: '2026-10-12',
      discloseResults: false,
    },
    {
      label: 'an earlier linked attempt',
      testTypes: ['ramp'],
      attemptDate: '2026-09-30',
      discloseResults: false,
    },
    {
      label: 'a selected in-range attempt',
      testTypes: ['ramp'],
      attemptDate: '2026-10-07',
      discloseResults: true,
    },
    {
      label: 'an attempt on the first selected day',
      testTypes: ['ramp'],
      attemptDate: '2026-10-01',
      discloseResults: true,
    },
  ])(
    'keeps linked attempt identity but scopes results for $label',
    async ({ testTypes, attemptDate, discloseResults }) => {
      const attempt = {
        id: 'attempt',
        test_type: 'ramp',
        attempt_date: attemptDate,
        results: {
          maximum_watts: 340,
          peak_heart_rate: 180,
          one_minute_heart_rate: 145,
        },
      };
      vi.mocked(getTrainingPrograms).mockResolvedValue([
        {
          id: 'program',
          name: 'Build',
          goal: 'Fitness',
          phases: [
            {
              id: 'phase',
              name: 'Base',
              goal: 'Consistency',
              weeks: [
                {
                  id: 'week',
                  sessions: [
                    {
                      id: 'session',
                      name: 'Ramp',
                      effective_date: '2026-10-02',
                      status: 'completed',
                      workout_plan_id: null,
                      cardio_test_type: 'ramp',
                      completed_test_attempt: attempt,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ] as unknown as Awaited<ReturnType<typeof getTrainingPrograms>>);
      const tools = buildTrainingAnalysisTools('owner', {
        start_date: '2026-10-01',
        end_date: '2026-10-07',
        programs: true,
        test_types: testTypes,
        health_metrics: [],
      });
      const result = JSON.parse(
        String(
          await tools.sparky_read_training_programs!.execute!({}, toolOpts)
        )
      );
      expect(result.sessions[0]).toMatchObject({
        id: 'session',
        status: 'completed',
        completed_test_attempt: {
          id: 'attempt',
          test_type: 'ramp',
          attempt_date: attemptDate,
        },
      });
      if (discloseResults)
        expect(result.sessions[0].completed_test_attempt.results).toEqual(
          attempt.results
        );
      else
        expect(result.sessions[0].completed_test_attempt).not.toHaveProperty(
          'results'
        );
    }
  );

  it('preserves canonical outcomes and only the exact bound session prescription within the selected range', async () => {
    vi.mocked(getTrainingPrograms).mockResolvedValue([
      {
        id: 'p1',
        name: 'Build',
        goal: 'Fitness',
        user_id: 'owner',
        phases: [
          {
            id: 'phase1',
            name: 'Base',
            goal: 'Consistency',
            weeks: [
              {
                id: 'w1',
                sessions: [
                  {
                    id: 's1',
                    effective_date: '2026-10-02',
                    status: 'completed',
                    workout_plan_id: 1,
                    workout_session_id: 'exact',
                    completed_workout: {
                      id: 'diary',
                      entry_date: '2026-10-03',
                    },
                  },
                  {
                    id: 's2',
                    effective_date: '2026-10-03',
                    status: 'missed',
                    workout_plan_id: null,
                  },
                  {
                    id: 's3',
                    effective_date: '2026-10-04',
                    status: 'omitted',
                    is_optional: true,
                    workout_plan_id: null,
                  },
                  {
                    id: 's4',
                    effective_date: '2025-10-04',
                    status: 'completed',
                    workout_plan_id: null,
                  },
                ],
              },
            ],
          },
        ],
      },
    ] as unknown as Awaited<ReturnType<typeof getTrainingPrograms>>);
    vi.mocked(
      workoutPlanTemplateRepository.getWorkoutPlanTemplateById
    ).mockResolvedValue({
      sessions: [
        {
          id: 'exact',
          name: 'Intervals',
          assignments: [{ sets: [{ reps: 5 }], exercise_name: 'Bike' }],
        },
        { id: 'other', name: 'Private unrelated', assignments: [] },
      ],
    } as unknown as NonNullable<
      Awaited<
        ReturnType<
          typeof workoutPlanTemplateRepository.getWorkoutPlanTemplateById
        >
      >
    >);
    const tools = buildTrainingAnalysisTools('owner', {
      start_date: '2026-10-01',
      end_date: '2026-10-07',
      programs: true,
      test_types: [],
      health_metrics: [],
    });
    const text = String(
      await tools.sparky_read_training_programs!.execute!({}, toolOpts)
    );
    expect(text).toContain('completed');
    expect(text).toContain('missed');
    expect(text).toContain('omitted');
    expect(text).toContain('Intervals');
    expect(text).toContain('diary');
    expect(text).not.toContain('Private unrelated');
    expect(text).not.toContain('s4');
    expect(text).not.toContain('user_id');
  });

  it('returns bounded intraday summaries with distinct HRV methods and no unselected daily metrics', async () => {
    query.mockClear();
    query.mockResolvedValue({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          entry_date: '2026-10-01',
          metric: 'hrv',
          method: 'sdnn_ms',
          mean: 48,
          count: 3,
        },
      ],
    });
    const tools = buildTrainingAnalysisTools('owner', {
      start_date: '2026-10-01',
      end_date: '2026-10-07',
      programs: false,
      test_types: [],
      health_metrics: ['hrv'],
    });
    const text = String(
      await tools.sparky_read_training_health!.execute!({}, toolOpts)
    );
    expect(text).toContain('sdnn_ms');
    expect(text).toContain('48');
    expect(query.mock.calls[0]![1]).toEqual([
      'owner',
      '2026-10-01',
      '2026-10-07',
      ['hrv'],
    ]);
    expect(query.mock.calls[0]![0]).toContain('health_metric_samples');
    expect(query.mock.calls[0]![0]).toContain('healthkit');
  });

  it('exposes only selected read tools and returns only selected synced metric columns', async () => {
    query.mockClear();
    const tools = buildTrainingAnalysisTools('owner', {
      start_date: '2026-10-01',
      end_date: '2026-10-07',
      programs: false,
      test_types: [],
      health_metrics: ['resting_heart_rate'],
    });
    expect(Object.keys(tools)).toEqual(['sparky_read_training_health']);
    query.mockResolvedValue({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          entry_date: '2026-10-01',
          source_provider: 'healthkit',
          resting_heart_rate: 52,
        },
      ],
    });
    const result = await tools.sparky_read_training_health!.execute!(
      {},
      toolOpts
    );
    expect(JSON.parse(String(result))).toMatchObject({
      rows: [
        {
          entry_date: '2026-10-01',
          source_provider: 'healthkit',
          resting_heart_rate: 52,
        },
      ],
    });
    expect(getClient).toHaveBeenCalledWith('owner', 'owner');
    expect(query.mock.calls[0]![0]).not.toContain('SELECT *');
    expect(query.mock.calls[0]![0]).toContain('resting_heart_rate');
    expect(query.mock.calls[0]![1]).toEqual([
      'owner',
      '2026-10-01',
      '2026-10-07',
    ]);
    expect(release).toHaveBeenCalled();
  });
});
