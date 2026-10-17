import { programStatus, INTERVAL_PRESETS } from '@workspace/shared';
import {
  buildWatchRunPlans,
  buildWatchStartPlan,
} from '../../src/utils/watchRunPlans';

const t = ((_key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? _key) as never;
const names = {
  program: () => 'Beginner 5K · Week 1, run 1',
  preset: (id: string) => id,
};

test('offers the built-in plans with the step names already translated', () => {
  const plans = buildWatchRunPlans(t, { status: null, enabled: false }, names);
  expect(plans).toHaveLength(INTERVAL_PRESETS.length);
  expect(plans[0].programId).toBeUndefined();
  expect(plans[0].steps[0]).toEqual({
    label: expect.any(String),
    seconds: expect.any(Number),
  });
  expect(plans[0].steps.every((s) => s.seconds > 0)).toBe(true);
});

test("puts today's program workout first, tagged so the phone can tick it off", () => {
  const status = programStatus({ programId: 'beginner5k', next: 2 })!;
  const plans = buildWatchRunPlans(t, { status, enabled: true }, names);
  expect(plans[0]).toMatchObject({
    id: 'beginner5k',
    programId: 'beginner5k',
    programIndex: 2,
    name: 'Beginner 5K · Week 1, run 1',
  });
  expect(plans).toHaveLength(INTERVAL_PRESETS.length + 1);
});

test('marks the walking program as a walk and leaves runs unmarked', () => {
  const walk = programStatus({ programId: 'walkFit', next: 0 })!;
  const run = programStatus({ programId: 'beginner5k', next: 0 })!;
  expect(
    buildWatchRunPlans(t, { status: walk, enabled: true }, names)[0].activity
  ).toBe('walk');
  expect(
    buildWatchRunPlans(t, { status: run, enabled: true }, names)[0].activity
  ).toBeUndefined();
});

test('leaves the program out while it is off or finished', () => {
  const status = programStatus({ programId: 'beginner5k', next: 2 })!;
  expect(buildWatchRunPlans(t, { status, enabled: false }, names)).toHaveLength(
    INTERVAL_PRESETS.length
  );
  const finished = programStatus({ programId: 'beginner5k', next: 999 })!;
  expect(
    buildWatchRunPlans(t, { status: finished, enabled: true }, names)
  ).toHaveLength(INTERVAL_PRESETS.length);
});

test('builds the single plan chosen on the phone, tagged as a program workout when it is one', () => {
  const status = programStatus({ programId: 'walkFit', next: 1 })!;
  const plan = buildWatchStartPlan(t, status.workout!.plan, {
    id: 'walkFit',
    name: 'Walk for fitness',
    program: { id: 'walkFit', index: status.done, activity: 'walk' },
  });
  expect(plan).toMatchObject({
    id: 'walkFit',
    programId: 'walkFit',
    programIndex: status.done,
    activity: 'walk',
  });
  expect(plan.steps.length).toBeGreaterThan(0);
  expect(
    buildWatchStartPlan(t, status.workout!.plan, { id: 'x', name: 'X' })
      .programId
  ).toBeUndefined();
});
