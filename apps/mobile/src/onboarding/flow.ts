import type { AgeBracket } from "@quest/contract";

export type OnboardingStep = "loading" | "welcome" | "age" | "parent" | "done";

export interface OnboardingState {
  loading: boolean;
  signedIn: boolean;
  teen: { ageBracket: AgeBracket } | null;
  parentLinked: boolean; // an active parent link exists
  waitingForParent: boolean; // the teen chose "Start making while I wait"
}

// Where the app should be: sign in, then age, then (under 18) ask a parent.
export function onboardingStep(s: OnboardingState): OnboardingStep {
  if (s.loading) return "loading";
  if (!s.signedIn) return "welcome";
  if (!s.teen) return "age";
  if (s.teen.ageBracket !== "18_19" && !s.parentLinked && !s.waitingForParent) return "parent";
  return "done";
}
