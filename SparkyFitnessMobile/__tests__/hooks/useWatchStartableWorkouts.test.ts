import {
  startableWorkoutsForWatch,
  watchDistanceUnit,
} from '../../src/hooks/useWatchCheckInBridge';

const exercise = {
  id: 1,
  exercise_id: 'exercise-1',
  image_url: null,
  exercise_name: 'Exercise',
  category: null,
  superset_group: null,
  sets: [],
};

describe('startableWorkoutsForWatch', () => {
  it('sends named presets that have exercises, in name order', () => {
    expect(
      startableWorkoutsForWatch([
        { id: 2, name: 'Pull', exercises: [exercise] },
        { id: 1, name: '  ', exercises: [exercise] },
        { id: 3, name: 'Legs', exercises: [] },
        { id: 4, name: 'Push', exercises: [exercise] },
      ])
    ).toEqual([
      { presetId: '2', name: 'Pull' },
      { presetId: '4', name: 'Push' },
    ]);
  });

  it('keeps numeric library tokens and both same-label exact sessions startable for the native picker', () => {
    const scheduled = [
      { presetId: 'session:11111111-1111-4111-8111-111111111111', name: 'A' },
      { presetId: 'session:22222222-2222-4222-8222-222222222222', name: 'A' },
    ];
    expect(
      startableWorkoutsForWatch(
        [{ id: 42, name: 'A', exercises: [exercise] }],
        scheduled
      )
    ).toEqual([{ presetId: '42', name: 'A' }, ...scheduled]);
  });
});

describe('watchDistanceUnit', () => {
  it('sends miles only when the phone is set to miles', () => {
    expect(watchDistanceUnit('miles')).toBe('miles');
    expect(watchDistanceUnit('km')).toBe('km');
    expect(watchDistanceUnit(undefined)).toBe('km');
    expect(watchDistanceUnit(null)).toBe('km');
  });
});
