const exerciseNameAcronyms = new Set([
  'AMRAP',
  'EMOM',
  'HIIT',
  'MMA',
  'RDL',
  'TRX',
  'VO2',
]);

/** Convert provider enum labels into readable exercise names without recasing mixed-case words. */
export function formatProviderExerciseName(name: string): string {
  if (!name) return 'Unknown Exercise';

  return name
    .replace(/_/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => {
      const uppercase = word.toUpperCase();
      if (exerciseNameAcronyms.has(uppercase)) return uppercase;
      if (word === uppercase)
        return word.charAt(0) + word.slice(1).toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}
