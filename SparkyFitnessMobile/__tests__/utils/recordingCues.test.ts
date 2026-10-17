import { createInstance } from 'i18next';
import {
  eventCue,
  finishCue,
  heartRateAlertCue,
  paceAlertCue,
  spokenDuration,
  splitCue,
} from '../../src/utils/recordingCues';

// Falls back to the English defaults, which is what the cues are written in.
const t = createInstance();
void t.init({
  lng: 'en',
  resources: {},
  interpolation: { escapeValue: false },
});
const tt = t.t.bind(t);

describe('spokenDuration', () => {
  it('spells out minutes and seconds', () => {
    expect(spokenDuration(tt, 324)).toBe('5 minutes 24 seconds');
  });

  it('drops zero parts and uses singulars', () => {
    expect(spokenDuration(tt, 3600 + 60 + 1)).toBe('1 hour 1 minute 1 second');
    expect(spokenDuration(tt, 600)).toBe('10 minutes');
  });

  it('says zero seconds rather than nothing', () => {
    expect(spokenDuration(tt, 0)).toBe('0 seconds');
  });
});

describe('splitCue', () => {
  it('announces distance, total time and the last split', () => {
    expect(
      splitCue(tt, {
        completed: 3,
        totalSeconds: 972,
        splitSeconds: 324,
        unit: 'km',
      })
    ).toBe(
      '3 kilometers. Time 16 minutes 12 seconds. Last kilometer 5 minutes 24 seconds.'
    );
  });

  it('speaks in miles when asked', () => {
    expect(
      splitCue(tt, {
        completed: 1,
        totalSeconds: 540,
        splitSeconds: 540,
        unit: 'miles',
      })
    ).toBe('1 mile. Time 9 minutes. Last mile 9 minutes.');
  });
});

describe('eventCue and finishCue', () => {
  it('says what happened', () => {
    expect(eventCue(tt, 'autoPaused')).toBe('Auto paused');
    expect(eventCue(tt, 'resumed')).toBe('Resumed');
  });

  it('rounds the finishing distance to one decimal', () => {
    expect(
      finishCue(tt, { distanceMeters: 5234, totalSeconds: 1800, unit: 'km' })
    ).toBe('Recording finished. 5.2 kilometers. Time 30 minutes.');
  });
});

describe('paceAlertCue', () => {
  it('tells the runner which way to go', () => {
    expect(paceAlertCue(tt, 'tooFast')).toBe('Too fast. Ease off.');
    expect(paceAlertCue(tt, 'tooSlow')).toBe('Too slow. Pick it up.');
  });
});

describe('heartRateAlertCue', () => {
  it('tells the runner which way to go', () => {
    expect(heartRateAlertCue(tt, 'tooHigh')).toBe('Heart rate high. Ease off.');
    expect(heartRateAlertCue(tt, 'tooLow')).toBe('Heart rate low. Pick it up.');
  });
});
