import { addDays, type CheckInMeasurementsResponse } from '@workspace/shared';

/** Average recorded weights only; missing days never become zero-weight samples. */
export function weightTrend(
  measurements: ReadonlyArray<
    Pick<CheckInMeasurementsResponse, 'entry_date' | 'weight'>
  >,
  selectedDate: string
) {
  const weights = new Map(
    measurements
      .filter((row) => row.weight != null && Number.isFinite(row.weight))
      .map((row) => [row.entry_date, row.weight as number])
  );
  const average = (end: string) => {
    const values = Array.from({ length: 7 }, (_, index) =>
      weights.get(addDays(end, -index))
    ).filter((value): value is number => value !== undefined);
    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
  };
  const current = average(selectedDate);
  const previous = average(addDays(selectedDate, -7));
  return {
    current,
    delta: current !== null && previous !== null ? current - previous : null,
    points: Array.from({ length: 30 }, (_, index) => {
      const day = addDays(selectedDate, index - 29);
      return { label: day, value: weights.has(day) ? average(day) : null };
    }),
  };
}
