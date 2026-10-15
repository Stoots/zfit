import { describe, expect, it } from 'vitest';
import {
  cardioTestAttemptInputSchema,
  sprintPowerResults,
} from '@workspace/shared';

describe('power Test Attempt contract', () => {
  it('calculates maximum and drop-off from five peaks', () => {
    expect(sprintPowerResults([900, 800, 700, 600, 500])).toEqual({
      maximum_watts: 900,
      drop_off_watts: 400,
      drop_off_percent: (400 / 900) * 100,
    });
    expect(sprintPowerResults([600, 600, 600, 600, 600])).toEqual({
      maximum_watts: 600,
      drop_off_watts: 0,
      drop_off_percent: 0,
    });
    expect(sprintPowerResults([0, 0, 0, 0, 0])).toEqual({
      maximum_watts: 0,
      drop_off_watts: 0,
      drop_off_percent: 0,
    });
  });

  it('rejects incomplete and inconsistent power efforts', () => {
    expect(
      cardioTestAttemptInputSchema.safeParse({
        test_type: 'sprint_6s',
        attempt_date: '2026-10-01',
        results: { peak_watts: [100, 200, 300, 400] },
      }).success
    ).toBe(false);
    expect(
      cardioTestAttemptInputSchema.safeParse({
        test_type: 'power_30s',
        attempt_date: '2026-10-01',
        results: {
          efforts: [
            { peak_watts: 300, average_watts: 310 },
            { peak_watts: 200, average_watts: 100 },
          ],
        },
      }).success
    ).toBe(false);
  });
});
