import {
  advanceProgress,
  findProgram,
  planMinutes,
  programActivity,
  programStatus,
  RUN_PROGRAMS,
  isValidIntervalPlan,
} from '@workspace/shared';

const program = findProgram('beginner5k')!;

describe('beginner 5K', () => {
  test('is nine weeks of three workouts', () => {
    expect(program.weeks).toBe(9);
    expect(program.workoutsPerWeek).toBe(3);
    expect(program.workouts).toHaveLength(27);
    expect(program.workouts[0]).toMatchObject({ week: 0, day: 0 });
    expect(program.workouts[26]).toMatchObject({ week: 8, day: 2 });
  });

  test('every workout is a valid plan with a warm-up and cool-down', () => {
    for (const w of program.workouts) {
      expect(isValidIntervalPlan(w.plan)).toBe(true);
      expect(w.plan.steps[0].kind).toBe('warmup');
      expect(w.plan.steps[w.plan.steps.length - 1].kind).toBe('cooldown');
    }
  });

  test('builds up to 30 minutes of running', () => {
    const run = (i: number) =>
      program.workouts[i].plan.steps
        .filter((s) => s.kind === 'work')
        .reduce((sum, s) => sum + s.seconds, 0);
    expect(run(0)).toBe(8 * 60);
    expect(run(26)).toBe(30 * 60);
    expect(planMinutes(program.workouts[26].plan)).toBe(40);
  });

  test('total running never drops from one week to the next by much', () => {
    const run = (i: number) =>
      program.workouts[i].plan.steps
        .filter((s) => s.kind === 'work')
        .reduce((sum, s) => sum + s.seconds, 0);
    for (let week = 1; week < 9; week++) {
      expect(run(week * 3 + 2)).toBeGreaterThanOrEqual(run((week - 1) * 3));
    }
  });
});

describe('progress', () => {
  test('resolves the next workout', () => {
    const status = programStatus({ programId: 'beginner5k', next: 4 })!;
    expect(status.workout).toMatchObject({ week: 1, day: 1 });
    expect(status.done).toBe(4);
    expect(status.finished).toBe(false);
  });

  test('is finished at the end and clamps a stale index', () => {
    expect(programStatus({ programId: 'beginner5k', next: 999 })).toMatchObject(
      {
        finished: true,
        workout: null,
        done: 27,
      }
    );
    expect(programStatus({ programId: 'beginner5k', next: -3 })!.done).toBe(0);
  });

  test('knows nothing of an unknown program', () => {
    expect(programStatus({ programId: 'gone', next: 0 })).toBeNull();
  });

  test('advances only past the workout that is due', () => {
    const progress = { programId: 'beginner5k', next: 2 };
    expect(advanceProgress(progress, 2).next).toBe(3);
    expect(advanceProgress(progress, 5)).toBe(progress);
    expect(advanceProgress(progress, 1)).toBe(progress);
  });
});

describe('every program', () => {
  test('is listed once, easiest first, and can be found by id', () => {
    expect(RUN_PROGRAMS.map((p) => p.id)).toEqual([
      'walkFit',
      'beginner5k',
      'fiveToTenK',
      'faster5k',
      'halfMarathon',
      'marathon',
    ]);
    for (const p of RUN_PROGRAMS) expect(findProgram(p.id)).toBe(p);
  });

  test.each([
    ['walkFit', 8, 24],
    ['beginner5k', 9, 27],
    ['fiveToTenK', 8, 24],
    ['faster5k', 6, 18],
    ['halfMarathon', 12, 36],
    ['marathon', 16, 63],
  ])('%s has %i weeks and %i workouts', (id, weeks, total) => {
    const p = findProgram(id)!;
    expect(p.weeks).toBe(weeks);
    expect(p.workouts).toHaveLength(total);
    expect(new Set(p.workouts.map((w) => w.week)).size).toBe(weeks);
  });

  test('every workout is a valid plan and workouts follow in order', () => {
    for (const p of RUN_PROGRAMS) {
      let last = -1;
      for (const w of p.workouts) {
        expect(isValidIntervalPlan(w.plan)).toBe(true);
        expect(w.plan.steps[0].kind).toBe('warmup');
        expect(w.plan.steps[w.plan.steps.length - 1].kind).toBe('cooldown');
        expect(w.week).toBeGreaterThanOrEqual(last);
        last = w.week;
      }
    }
  });

  test('the long runs build up and stay under four hours', () => {
    const longest = (id: string) =>
      Math.max(
        ...findProgram(id)!.workouts.map((w) =>
          Math.max(...w.plan.steps.map((s) => s.seconds))
        )
      );
    expect(longest('fiveToTenK')).toBe(65 * 60);
    expect(longest('halfMarathon')).toBe(115 * 60);
    expect(longest('marathon')).toBe(165 * 60);
    for (const p of RUN_PROGRAMS) {
      expect(longest(p.id)).toBeLessThanOrEqual(4 * 3600);
    }
  });

  test('the speed plan is called fast and easy, the others run and walk', () => {
    expect(findProgram('faster5k')!.workouts[0].plan.style).toBe('fastEasy');
    expect(findProgram('marathon')!.workouts[0].plan.style).toBe('runWalk');
  });

  test('an easy run in the speed plan is an easy step, not a run', () => {
    const easyDay = findProgram('faster5k')!.workouts[1].plan.steps;
    expect(easyDay.map((s) => s.kind)).toEqual([
      'warmup',
      'recovery',
      'cooldown',
    ]);
  });
});

describe('the walking program', () => {
  test('is recorded as a walk, and is fast and easy steps with no running wording', () => {
    const p = findProgram('walkFit')!;
    expect(p.activity).toBe('walk');
    expect(programActivity('walkFit')).toBe('walk');
    expect(programActivity('beginner5k')).toBe('run');
    expect(programActivity('gone')).toBe('run');
    for (const w of p.workouts) expect(w.plan.style).toBe('fastEasy');
  });

  test('builds to half an hour of brisk walking and never repeats the first week', () => {
    const p = findProgram('walkFit')!;
    const brisk = (i: number) =>
      p.workouts[i].plan.steps
        .filter((s) => s.kind === 'work')
        .reduce((sum, s) => sum + s.seconds, 0);
    expect(brisk(0)).toBe(12 * 60);
    expect(brisk(p.workouts.length - 1)).toBe(30 * 60);
    expect(brisk(p.workouts.length - 1)).toBeGreaterThan(brisk(0));
  });

  test('a stored program carries the activity', () => {
    const status = programStatus({ programId: 'walkFit', next: 0 })!;
    expect(status.program.activity).toBe('walk');
  });
});
