// After an under-13 answer, the age screen stays closed on this phone for a
// day, so a child can't just go back and pick an older year (PRD R2).
export const AGE_GATE_KEY = "age-gate-closed-until";
export const AGE_GATE_HOURS = 24;

export function closedUntil(now: number): number {
  return now + AGE_GATE_HOURS * 3_600_000;
}

export function isClosed(storedUntil: string | null, now: number): boolean {
  const until = Number(storedUntil);
  return Number.isFinite(until) && until > now;
}

// Birth years the picker offers: ages 11 to 21, so children and adults can
// answer truthfully and be stopped, rather than being nudged into range.
export function birthYearsFor(today: Date): number[] {
  const y = today.getUTCFullYear();
  return Array.from({ length: 11 }, (_, i) => y - 11 - i);
}
