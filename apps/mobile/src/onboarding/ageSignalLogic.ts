import { bracketFromAgeRange, type AgeBracket, type StoreAgeVerdict } from "@quest/contract";

// What the age screen does with the phone's app-store answer.
export type StoreAgeResult =
  | { kind: "verdict"; verdict: Exclude<StoreAgeVerdict, "unknown"> }
  | { kind: "verification_required" } // Android: the Play Store needs the teen to confirm their age first
  | { kind: "unavailable" }; // not shared, not supported, or failed: ask for birth month and year

export interface StoreRange {
  lowerBound: number | null;
  upperBound: number | null;
}

// Apple's Declared Age Range needs iOS 26. On older versions expo-age-range
// answers "18 or older" for everyone, so that answer must never be trusted.
export const MIN_IOS_MAJOR = 26;

export function iosMajor(version: string | number): number {
  return typeof version === "number" ? Math.floor(version) : parseInt(String(version).split(".")[0] ?? "0", 10) || 0;
}

export function iosSupported(version: string | number): boolean {
  return iosMajor(version) >= MIN_IOS_MAJOR;
}

export function interpretRange(range: StoreRange | null | undefined): StoreAgeResult {
  if (!range) return { kind: "unavailable" };
  const verdict = bracketFromAgeRange(range.lowerBound, range.upperBound);
  return verdict === "unknown" ? { kind: "unavailable" } : { kind: "verdict", verdict };
}

export function interpretAndroidAccess(status: string | null | undefined): "ask_range" | StoreAgeResult {
  if (status === "SHARED") return "ask_range";
  if (status === "VERIFICATION_REQUIRED") return { kind: "verification_required" };
  return { kind: "unavailable" };
}

// Store-placed teens are asked again every AGE_RECHECK_MONTHS, so the app
// learns when the store moves them up (it never shares the birthday).
export function recheckDue(ageSource: "store" | "self_declared", checkedAt: string, now: Date, months: number): boolean {
  if (ageSource !== "store") return false;
  const due = new Date(checkedAt);
  due.setUTCMonth(due.getUTCMonth() + months);
  return now >= due;
}

// What a re-check reports to the server. "18 or older" (the store gives no
// upper age) and "over 19" both mean 18–19: teens stay in 18–19 after 20 and
// keep their account. A younger answer is never sent (groups only move up,
// and the server ignores lower ones anyway).
export function recheckBracket(r: StoreAgeResult): AgeBracket | null {
  if (r.kind !== "verdict") return null;
  if (r.verdict === "adult_unbounded" || r.verdict === "over_19") return "18_19";
  if (r.verdict === "13_15" || r.verdict === "16_17" || r.verdict === "18_19") return r.verdict;
  return null; // under 13: never moves anyone down
}
