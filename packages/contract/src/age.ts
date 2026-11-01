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
