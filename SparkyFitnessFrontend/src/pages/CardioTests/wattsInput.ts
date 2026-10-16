import { toNumber } from '@workspace/shared';

const wattInputPattern = /^\d+(?:[.,]\d+)?$/;

export function parseWattsInput(value: string): number {
  const text = value.trim();
  // These short measurements use one separator as a decimal, never grouping.
  if (!wattInputPattern.test(text)) return Number.NaN;
  return toNumber(text, text.includes(',') ? 'eu' : 'us') ?? Number.NaN;
}
