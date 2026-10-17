import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import IntervalCard from '../../src/components/recording/IntervalCard';
import IntervalSetup, {
  DEFAULT_CUSTOM_INTERVALS,
} from '../../src/components/recording/IntervalSetup';
import { buildIntervalPlan, intervalPosition } from '@workspace/shared';

const plan = buildIntervalPlan({
  style: 'runWalk',
  warmupSeconds: 0,
  workSeconds: 60,
  recoverySeconds: 90,
  rounds: 2,
  cooldownSeconds: 0,
});

describe('IntervalCard', () => {
  it('shows the step, time left, round and what is next', () => {
    render(<IntervalCard plan={plan} position={intervalPosition(plan, 20)!} />);
    expect(screen.getByText('Run')).toBeTruthy();
    expect(screen.getByText('0:40')).toBeTruthy();
    expect(screen.getByText('Round 1 of 2')).toBeTruthy();
    expect(screen.getByText('Next: Walk 1:30')).toBeTruthy();
  });

  it('says so when the plan is finished', () => {
    render(
      <IntervalCard plan={plan} position={intervalPosition(plan, 9999)!} />
    );
    expect(screen.getByText('Intervals complete')).toBeTruthy();
  });
});

describe('IntervalSetup custom builder', () => {
  it('changes rounds with the steppers', () => {
    const onCustom = jest.fn();
    render(
      <IntervalSetup
        choice="custom"
        onChoice={jest.fn()}
        custom={DEFAULT_CUSTOM_INTERVALS}
        onCustom={onCustom}
      />
    );
    fireEvent.press(screen.getByLabelText('Increase Rounds'));
    expect(onCustom).toHaveBeenCalledWith({
      ...DEFAULT_CUSTOM_INTERVALS,
      rounds: DEFAULT_CUSTOM_INTERVALS.rounds + 1,
    });
  });
});

describe('IntervalSetup for a walk or ride', () => {
  it('calls the steps Fast and Easy and hides the run/walk style', () => {
    render(
      <IntervalSetup
        choice="custom"
        onChoice={jest.fn()}
        custom={DEFAULT_CUSTOM_INTERVALS}
        onCustom={jest.fn()}
        activity="walk"
      />
    );
    expect(screen.getByText('Fast')).toBeTruthy();
    expect(screen.getByText('Easy')).toBeTruthy();
    expect(screen.queryByText('Run')).toBeNull();
    expect(screen.queryByText('Run / walk')).toBeNull();
    expect(
      screen.getByText(
        'Follow timed steps of fast and easy effort. You are told when to switch.'
      )
    ).toBeTruthy();
  });

  it('keeps the run/walk wording for a run', () => {
    render(
      <IntervalSetup
        choice="custom"
        onChoice={jest.fn()}
        custom={DEFAULT_CUSTOM_INTERVALS}
        onCustom={jest.fn()}
        activity="run"
      />
    );
    expect(screen.getByText('Run / walk')).toBeTruthy();
    expect(screen.getByText('Run')).toBeTruthy();
  });
});
