import { z } from "zod";

// Never a birth date. The bracket is stored, and, for teens who give their
// birth month and year, the month they move up to the next bracket (so free
// Plus ends at 16 and a parent's consent at 18).
export const AgeBracket = z.enum(["13_15", "16_17", "18_19"]);
export type AgeBracket = z.infer<typeof AgeBracket>;

export type AgeCheck = AgeBracket | "under_13" | "over_19";

export function bracketForAge(age: number): AgeCheck {
  if (age < 13) return "under_13";
  if (age <= 15) return "13_15";
  if (age <= 17) return "16_17";
  if (age <= 19) return "18_19";
  return "over_19";
}

// Where the bracket came from: the phone's app store (Apple Declared Age Range,
// Google Play Age Signals) or the teen's own answer when the store shares nothing.
export const AgeSource = z.enum(["store", "self_declared"]);
export type AgeSource = z.infer<typeof AgeSource>;

// Age from a birth month and year. The day is unknown, so a birthday in the
// current month counts as not yet reached: borderline cases get the younger age.
export function ageFromBirthMonth(year: number, month: number, today: Date): number {
  const nowYear = today.getUTCFullYear();
  const nowMonth = today.getUTCMonth() + 1;
  return nowYear - year - (nowMonth <= month ? 1 : 0);
}

// The first day of the month the teen moves to the next age group, matching
// ageFromBirthMonth (a birthday month counts as not yet reached). null for
// 18–19: teens stay in 18–19 after 20 and keep their account. (New sign-ups
// over 19 are still stopped.)
export function ageGroupEndsOn(year: number, month: number, bracket: AgeBracket): string | null {
  const next = bracket === "13_15" ? 16 : bracket === "16_17" ? 18 : null;
  if (next === null) return null;
  // Date.UTC takes a 0-based month, so `month` is already the month after.
  return new Date(Date.UTC(year + next, month, 1)).toISOString().slice(0, 10);
}

export function nextAgeGroup(bracket: AgeBracket): AgeBracket | null {
  return bracket === "13_15" ? "16_17" : bracket === "16_17" ? "18_19" : null;
}

// Teens placed by their app store's age range are asked again this often:
// the store moves them up on their birthday, but we never learn the date.
export const AGE_RECHECK_MONTHS = 6;

// What a store age range tells us. Ask with thresholds 13, 16 and 18. A range
// that spans brackets resolves to the youngest one. "18+" has no upper bound, so
// the app still asks for a birth year to check the teen is 19 or under.
export type StoreAgeVerdict = AgeCheck | "adult_unbounded" | "unknown";

export function bracketFromAgeRange(lower: number | null, upper: number | null): StoreAgeVerdict {
  if (upper !== null && upper < 13) return "under_13";
  if (lower === null && upper === null) return "unknown";
  if (lower !== null && lower >= 18) return upper !== null && upper <= 19 ? "18_19" : "adult_unbounded";
  if (lower !== null && lower >= 16) return "16_17";
  if (lower !== null && lower >= 13) return "13_15";
  // A range reaching below 13 might be a child: stop rather than guess.
  if (lower !== null) return "under_13";
  // Only an upper bound of 13 or more: not enough to place them, so ask instead.
  return "unknown";
}

// "studio": private making, sharing with family only.
// "walls": the full app with teen walls.
export const AppMode = z.enum(["studio", "walls"]);
export type AppMode = z.infer<typeof AppMode>;

export interface ModeInput {
  country: string; // ISO 3166-1 alpha-2
  bracket: AgeBracket;
  wallsLive: boolean; // false for Lean V1
}

// PRD R44: in Canada, 13–15s get Studio until Bill C-34 is settled.
export function modeFor({ country, bracket, wallsLive }: ModeInput): AppMode {
  if (!wallsLive) return "studio";
  if (country.toUpperCase() === "CA" && bracket === "13_15") return "studio";
  return "walls";
}

// Under-18s need a linked, consenting parent before anything leaves the phone.
export function needsParentConsent(bracket: AgeBracket): boolean {
  return bracket !== "18_19";
}
