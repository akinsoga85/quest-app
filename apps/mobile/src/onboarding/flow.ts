import type { AgeBracket } from "@quest/contract";

export type OnboardingStep = "loading" | "welcome" | "age" | "parent" | "zones" | "done";

export interface OnboardingState {
  loading: boolean;
  signedIn: boolean;
  teen: { ageBracket: AgeBracket } | null;
  parentLinked: boolean; // an active parent link exists
  waitingForParent: boolean; // the teen chose "Start making while I wait"
  hasZones: boolean; // picked at least one zone (H4)
}

// Where the app should be: sign in, age, (under 18) ask a parent, pick zones.
export function onboardingStep(s: OnboardingState): OnboardingStep {
  if (s.loading) return "loading";
  if (!s.signedIn) return "welcome";
  if (!s.teen) return "age";
  if (s.teen.ageBracket !== "18_19" && !s.parentLinked && !s.waitingForParent) return "parent";
  if (!s.hasZones) return "zones";
  return "done";
}
