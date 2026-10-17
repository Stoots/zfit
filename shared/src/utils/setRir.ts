/** Display strength effort consistently, including drafts saved before RIR. */
export function displaySetRir(set: {
  rir?: number | null;
  rpe?: number | null;
}): number | null {
  // An explicit null clears a prescription; only older shapes need a fallback.
  if (set.rir !== undefined) return set.rir;
  return set.rpe != null && Number.isFinite(set.rpe)
    ? Math.min(10, Math.max(0, 10 - set.rpe))
    : null;
}

/** A strength effort edit must not revive the old RPE when RIR is cleared. */
export function legacyRpePatch(field: string): { rpe?: null } {
  return field === "rir" ? { rpe: null } : {};
}
