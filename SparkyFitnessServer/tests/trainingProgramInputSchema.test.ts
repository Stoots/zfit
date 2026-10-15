import { describe, expect, it } from 'vitest';
import { trainingProgramInputSchema } from '@workspace/shared';

const input = {
  name: 'Autumn base',
  goal: 'Measure progress',
  start_date: '2026-10-01',
  end_date: '2026-10-31',
  phases: [
    {
      name: 'Build',
      goal: 'Aerobic base',
      weeks: [
        {
          start_date: '2026-10-12',
          end_date: '2026-10-18',
          sessions: [
            {
              name: 'Baseline',
              scheduled_date: '2026-10-14',
              workout_session_id: '00000000-0000-4000-a000-000000000010',
              cardio_test_type: null,
            },
          ],
        },
      ],
    },
  ],
};

describe('Training Program input', () => {
  it('accepts a null Cardio Test type for a Workout Session', () => {
    expect(trainingProgramInputSchema.safeParse(input).success).toBe(true);
  });

  it('rejects an unsupported Cardio Test protocol', () => {
    const withProtocol = {
      ...input,
      phases: [
        {
          ...input.phases[0],
          weeks: [
            {
              ...input.phases[0].weeks[0],
              sessions: [
                {
                  name: 'Baseline',
                  scheduled_date: '2026-10-14',
                  cardio_test_type: 'unknown_test',
                },
              ],
            },
          ],
        },
      ],
    };
    expect(trainingProgramInputSchema.safeParse(withProtocol).success).toBe(
      false
    );
  });
});
