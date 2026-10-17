import {
  applyPaceTargets,
  isValidIntervalPlan,
  INITIAL_PACE_ALERT_STATE,
  normalizePaceBand,
  PACE_ALERT_REPEAT_MS,
  PACE_ALERT_SUSTAIN_MS,
  stepPaceAlert,
  type PaceAlertState,
} from '@workspace/shared';

// 5:00 to 5:30 per km.
const band = { minSecondsPerKm: 300, maxSecondsPerKm: 330 };

const run = (readings: [number, number | null][]) => {
  let state: PaceAlertState = INITIAL_PACE_ALERT_STATE;
  const alerts: (string | null)[] = [];
  for (const [at, pace] of readings) {
    const next = stepPaceAlert(state, pace, band, at);
    state = next.state;
    alerts.push(next.alert);
  }
  return alerts;
};

describe('normalizePaceBand', () => {
  test('accepts a sensible band and rounds it', () => {
    expect(
      normalizePaceBand({ minSecondsPerKm: 299.6, maxSecondsPerKm: 330 })
    ).toEqual({ minSecondsPerKm: 300, maxSecondsPerKm: 330 });
  });

  test.each([
    [null],
    [{ minSecondsPerKm: 330, maxSecondsPerKm: 300 }],
    [{ minSecondsPerKm: 300, maxSecondsPerKm: 305 }],
    [{ minSecondsPerKm: 60, maxSecondsPerKm: 300 }],
    [{ minSecondsPerKm: 300, maxSecondsPerKm: 5000 }],
    [{ minSecondsPerKm: NaN, maxSecondsPerKm: 300 }],
  ])('rejects %j', (value) => {
    expect(normalizePaceBand(value)).toBeNull();
  });
});

describe('stepPaceAlert', () => {
  test('stays quiet inside the band and within the margin', () => {
    expect(
      run([
        [0, 310],
        [10_000, 295],
        [20_000, 335],
      ])
    ).toEqual([null, null, null]);
  });

  test('waits for the pace to stay outside before alerting', () => {
    const alerts = run([
      [0, 280],
      [PACE_ALERT_SUSTAIN_MS - 1, 280],
      [PACE_ALERT_SUSTAIN_MS, 280],
    ]);
    expect(alerts).toEqual([null, null, 'tooFast']);
  });

  test('a return to the band cancels the wait', () => {
    const alerts = run([
      [0, 280],
      [5_000, 310],
      [9_000, 280],
      [PACE_ALERT_SUSTAIN_MS + 5_000, 280],
    ]);
    expect(alerts).toEqual([null, null, null, null]);
  });

  test('repeats no more than every 30 seconds while it stays outside', () => {
    const t0 = PACE_ALERT_SUSTAIN_MS;
    const alerts = run([
      [0, 400],
      [t0, 400],
      [t0 + 10_000, 400],
      [t0 + PACE_ALERT_REPEAT_MS - 1, 400],
      [t0 + PACE_ALERT_REPEAT_MS, 400],
    ]);
    expect(alerts).toEqual([null, 'tooSlow', null, null, 'tooSlow']);
  });

  test('crossing to the other side waits again, then alerts for that side', () => {
    const alerts = run([
      [0, 280],
      [PACE_ALERT_SUSTAIN_MS, 280],
      [PACE_ALERT_SUSTAIN_MS + 1_000, 400],
      [PACE_ALERT_SUSTAIN_MS + 1_000 + PACE_ALERT_SUSTAIN_MS, 400],
    ]);
    expect(alerts).toEqual([null, 'tooFast', null, 'tooSlow']);
  });

  test('a reading with no pace changes nothing', () => {
    const start: PaceAlertState = {
      side: 'tooFast',
      outsideSince: 0,
      lastAlertAt: null,
    };
    const next = stepPaceAlert(start, null, band, 20_000);
    expect(next).toEqual({ state: start, alert: null });
  });
});

describe('applyPaceTargets', () => {
  const plan = {
    style: 'fastEasy' as const,
    steps: [
      { kind: 'warmup' as const, seconds: 300 },
      { kind: 'work' as const, seconds: 180 },
      { kind: 'recovery' as const, seconds: 120 },
      { kind: 'cooldown' as const, seconds: 300 },
    ],
  };
  const fast = { minSecondsPerKm: 270, maxSecondsPerKm: 300 };
  const easy = { minSecondsPerKm: 360, maxSecondsPerKm: 420 };

  it('sets the ranges on work and recovery steps only', () => {
    const result = applyPaceTargets(plan, { work: fast, easy });
    expect(result.steps.map((step) => step.pace)).toEqual([
      undefined,
      fast,
      easy,
      undefined,
    ]);
    expect(isValidIntervalPlan(result)).toBe(true);
  });

  it('leaves the plan as it was when nothing usable is given', () => {
    expect(applyPaceTargets(plan, {})).toBe(plan);
    expect(
      applyPaceTargets(plan, {
        work: { minSecondsPerKm: 300, maxSecondsPerKm: 301 },
      })
    ).toBe(plan);
  });

  it('refuses a plan whose step carries an unusable range', () => {
    const bad = {
      ...plan,
      steps: [
        { ...plan.steps[0], pace: { minSecondsPerKm: 5, maxSecondsPerKm: 6 } },
      ],
    };
    expect(isValidIntervalPlan(bad)).toBe(false);
  });
});
