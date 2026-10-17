import {
  buildIntervalPlan,
  INTERVAL_PRESETS,
  intervalPosition,
  isValidIntervalPlan,
  planTotalSeconds,
  stepStartSeconds,
} from '@workspace/shared';

const plan = buildIntervalPlan({
  style: 'runWalk',
  warmupSeconds: 300,
  workSeconds: 60,
  recoverySeconds: 90,
  rounds: 2,
  cooldownSeconds: 300,
});

describe('buildIntervalPlan', () => {
  test('puts recovery between rounds and drops it before a cool-down', () => {
    expect(plan.steps.map((s) => s.kind)).toEqual([
      'warmup',
      'work',
      'recovery',
      'work',
      'cooldown',
    ]);
    expect(planTotalSeconds(plan)).toBe(300 + 60 + 90 + 60 + 300);
  });

  test('keeps the last recovery when there is no cool-down', () => {
    const noCool = buildIntervalPlan({
      style: 'fastEasy',
      warmupSeconds: 0,
      workSeconds: 30,
      recoverySeconds: 30,
      rounds: 2,
      cooldownSeconds: 0,
    });
    expect(noCool.steps.map((s) => s.kind)).toEqual([
      'work',
      'recovery',
      'work',
      'recovery',
    ]);
  });

  test('clamps silly values', () => {
    const odd = buildIntervalPlan({
      style: 'fastEasy',
      warmupSeconds: -5,
      workSeconds: 1,
      recoverySeconds: 99999,
      rounds: 500,
      cooldownSeconds: 0,
    });
    expect(odd.steps.filter((s) => s.kind === 'work')).toHaveLength(30);
    expect(odd.steps[0]).toEqual({ kind: 'work', seconds: 5 });
    expect(odd.steps[1]).toEqual({ kind: 'recovery', seconds: 3600 });
  });
});

describe('intervalPosition', () => {
  test('finds the step, time left and round', () => {
    const pos = intervalPosition(plan, 300 + 60 + 10)!;
    expect(pos.index).toBe(2);
    expect(pos.step.kind).toBe('recovery');
    expect(pos.remaining).toBe(80);
    expect(pos.next?.kind).toBe('work');
    expect(pos.round).toBe(1);
    expect(pos.rounds).toBe(2);
    expect(pos.done).toBe(false);
  });

  test('starts a step exactly on its boundary', () => {
    expect(intervalPosition(plan, 300)!.index).toBe(1);
  });

  test('is done after the last step', () => {
    const pos = intervalPosition(plan, 99999)!;
    expect(pos.done).toBe(true);
    expect(pos.remaining).toBe(0);
    expect(pos.next).toBeNull();
  });

  test('has nothing for an empty plan', () => {
    expect(intervalPosition({ style: 'runWalk', steps: [] }, 5)).toBeNull();
  });
});

test('stepStartSeconds sums the steps before it', () => {
  expect(stepStartSeconds(plan, 0)).toBe(0);
  expect(stepStartSeconds(plan, 3)).toBe(300 + 60 + 90);
});

test('every preset builds a valid plan', () => {
  for (const preset of INTERVAL_PRESETS) {
    expect(isValidIntervalPlan(buildIntervalPlan(preset.options))).toBe(true);
  }
});

test('isValidIntervalPlan rejects junk', () => {
  expect(isValidIntervalPlan(null)).toBe(false);
  expect(isValidIntervalPlan({ style: 'x', steps: [] })).toBe(false);
  expect(
    isValidIntervalPlan({
      style: 'runWalk',
      steps: [{ kind: 'work', seconds: 0 }],
    })
  ).toBe(false);
});
