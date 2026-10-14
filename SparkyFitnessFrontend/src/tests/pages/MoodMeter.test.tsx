import { fireEvent, render } from '@testing-library/react';
import '@testing-library/jest-dom';
import MoodMeter from '@/pages/CheckIn/MoodMeter';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, arg?: unknown) =>
      typeof arg === 'string'
        ? arg
        : ((arg as { defaultValue?: string } | undefined)?.defaultValue ?? key),
  }),
}));

jest.mock('@/hooks/CheckIn/useMood', () => ({
  useCustomMoods: () => ({ data: [] }),
  useCreateCustomMoodMutation: () => ({
    mutateAsync: jest.fn(),
    isPending: false,
  }),
  useDeleteCustomMoodMutation: () => ({ mutate: jest.fn() }),
  useMoodDisplayPreferences: () => ({ data: { hidden_moods: [] } }),
  useUpdateMoodDisplayPreferencesMutation: () => ({ mutate: jest.fn() }),
}));

// The slider's own bounds. Derived here rather than imported so the test states
// the geometry independently of the table the component builds it from.
const MOOD_MIN = 10;
const MOOD_MAX = 95;
const MOOD_STEP = 5;

const renderMeter = (mood = 50) => {
  const onMoodChange = jest.fn();
  const { container } = render(
    <MoodMeter
      mood={mood}
      notes=""
      moodTags={[]}
      onMoodChange={onMoodChange}
      onNotesChange={jest.fn()}
      onTagsChange={jest.fn()}
    />
  );
  return { container, onMoodChange };
};

/** The nine legend faces: the only buttons in the meter carrying a `title`. */
const legendFaces = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button[title]'));

/** The value a face writes when tapped. */
const valueWrittenBy = (
  face: HTMLButtonElement,
  onMoodChange: jest.Mock
): number => {
  onMoodChange.mockClear();
  fireEvent.click(face);
  return onMoodChange.mock.calls[0]![0] as number;
};

describe('MoodMeter band legend', () => {
  test('offers every band as a named segment with its original slider value', () => {
    const { container, onMoodChange } = renderMeter();
    const faces = legendFaces(container);
    expect(faces).toHaveLength(9);
    expect(faces.map((face) => valueWrittenBy(face, onMoodChange))).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90,
    ]);
    faces.forEach((face) => {
      expect(face).toHaveAccessibleName(face.title);
      expect(face).toHaveTextContent(face.title);
    });
  });

  test('retains every fine-grained slider stop between segments', () => {
    const { container, onMoodChange } = renderMeter();
    const thumb = container.querySelector('[role="slider"]')!;
    expect(thumb).toHaveAttribute('aria-valuemin', String(MOOD_MIN));
    expect(thumb).toHaveAttribute('aria-valuemax', String(MOOD_MAX));
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(onMoodChange).toHaveBeenLastCalledWith(50 + MOOD_STEP);
  });

  test('never writes a value the slider cannot show', () => {
    const { container, onMoodChange } = renderMeter();
    const faces = legendFaces(container);

    // "Sad" spans 0-15, so its midpoint is 8 -- under the slider's own minimum.
    expect(valueWrittenBy(faces[0]!, onMoodChange)).toBe(MOOD_MIN);
    faces.forEach((face) => {
      const value = valueWrittenBy(face, onMoodChange);
      expect(value).toBeGreaterThanOrEqual(MOOD_MIN);
      expect(value).toBeLessThanOrEqual(MOOD_MAX);
    });
  });
});

describe('MoodMeter header', () => {
  test.each([
    [10, '😢', 'Sad'],
    [50, '🤔', 'Thoughtful'],
    [65, '🙂', 'Calm'],
    [100, '😍', 'Excited'],
  ])('at %i it names the band it highlights', (mood, emoji, label) => {
    const { container } = renderMeter(mood);
    const active = legendFaces(container).find(
      (face) => face.getAttribute('aria-pressed') === 'true'
    );

    expect(container.querySelector('span.font-medium')).toHaveTextContent(
      `${emoji}${label}`
    );
    expect(active?.title).toBe(label);
    expect(active).toHaveTextContent(emoji);
    expect(active).toHaveTextContent(label);
  });
});

describe('MoodMeter with a value from outside the picker', () => {
  // A CSV import may carry 96-100, and rows logged before the picker stopped at
  // 95 still hold them. Radix reports the controlled value verbatim, so passing
  // one straight through announces a mood above the maximum it declares.
  test('keeps the thumb it announces inside the range it declares', () => {
    const { container } = renderMeter(100);
    const thumb = container.querySelector('[role="slider"]')!;
    const now = Number(thumb.getAttribute('aria-valuenow'));

    expect(now).toBeLessThanOrEqual(
      Number(thumb.getAttribute('aria-valuemax'))
    );
    expect(now).toBeGreaterThanOrEqual(
      Number(thumb.getAttribute('aria-valuemin'))
    );
  });

  test('still reads the value back as the band it belongs to', () => {
    const { container } = renderMeter(100);

    expect(container.querySelector('span.font-medium')).toHaveTextContent(
      '😍Excited'
    );
  });

  test('leaves the stored value alone until the slider is moved', () => {
    const { onMoodChange } = renderMeter(100);

    // Clamping is for display: a day opened and saved untouched keeps its 100.
    expect(onMoodChange).not.toHaveBeenCalled();
  });
});
