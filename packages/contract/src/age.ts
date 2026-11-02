import { z } from "zod";

// Only the bracket is ever stored, never a birth date (state app-store laws).
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
