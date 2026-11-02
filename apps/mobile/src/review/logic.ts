import { skillName, type CoachReview, type MakeStatus, type ReviewState } from "@quest/contract";

// Pure logic for the coach review screen (H16), kept apart so it's unit-tested.

// "↑ Light +1" chips under "What worked". Skills that got no points don't show.
export function skillChips(review: CoachReview): string[] {
  return review.skillPoints.filter((s) => s.points > 0).map((s) => `${skillName(s.skill)} +${s.points}`);
}

// How long to wait before asking again while the coach works: quick at first
// (reviews take about 15 seconds), then slower, then stop.
export function pollDelay(attempt: number): number | null {
  if (attempt < 20) return 2_000;
  if (attempt < 40) return 10_000;
  return null; // after about 4 minutes: show "still working" and stop asking
}

// The state shown before the server knows about the make (it's still uploading).
export const NOT_SAVED_YET: ReviewState = { state: "pending" };

export interface Helpline {
  label: string;
  how: string; // what to do: call, text, or visit
  url: string;
}

// Shown with a held photo (PRD: a calm message and crisis lines).
export function helplines(country: string | undefined): Helpline[] {
  if (country === "US") {
    return [{ label: "988 Suicide & Crisis Lifeline", how: "Call or text 988", url: "sms:988" }];
  }
  if (country === "CA") {
    return [
      { label: "9-8-8 Suicide Crisis Helpline", how: "Call or text 988", url: "sms:988" },
      { label: "Kids Help Phone", how: "Text CONNECT to 686868", url: "sms:686868" },
    ];
  }
  if (country === "GB") {
    return [{ label: "Childline", how: "Call 0800 1111", url: "tel:08001111" }];
  }
  return [{ label: "Find a helpline", how: "findahelpline.com", url: "https://findahelpline.com" }];
}

// The line on Today for a zone whose make is with the coach.
export function makeStatusLabel(status: MakeStatus): string | null {
  switch (status) {
    case "uploaded":
    case "scanning":
    case "reviewing":
      return "Your coach is looking";
    case "reviewed":
      return "Review ready";
    case "no_review":
      return "A lesson for you";
    case "held_for_review":
    case "blocked":
      return "With our safety team";
    default:
      return null;
  }
}
