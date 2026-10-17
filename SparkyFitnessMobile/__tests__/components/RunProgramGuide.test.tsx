import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { RUN_PROGRAMS } from '@workspace/shared';
import RunProgramGuide, {
  programStructure,
} from '../../src/components/recording/RunProgramGuide';
import i18n from '../../src/localization/i18n';

describe('RunProgramGuide', () => {
  it('is collapsed until opened, then explains workouts, effort and walking pace', () => {
    render(<RunProgramGuide />);
    expect(screen.queryByText('How fast to walk')).toBeNull();
    fireEvent.press(screen.getByText('How the plans work'));
    expect(screen.getByText('Each workout')).toBeTruthy();
    expect(screen.getByText('How hard to run')).toBeTruthy();
    expect(screen.getByText('How fast to walk')).toBeTruthy();
    expect(screen.getByText(/about 5 to 6 km\/h/)).toBeTruthy();
  });

  it('can start open and describes the program being followed', () => {
    render(<RunProgramGuide programId="beginner5k" defaultOpen />);
    expect(screen.getByText('Beginner 5K')).toBeTruthy();
    expect(screen.getByText(/Weeks 7 to 9 are continuous runs/)).toBeTruthy();
  });

  it('describes every program', () => {
    for (const program of RUN_PROGRAMS) {
      expect(
        programStructure(i18n.t.bind(i18n), program.id).length
      ).toBeGreaterThan(20);
    }
  });
});
