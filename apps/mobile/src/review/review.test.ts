import { describe, expect, it } from "vitest";
import { helplines, makeStatusLabel, pollDelay, skillChips } from "./logic";

describe("coach review screen", () => {
  it("shows a chip for each skill that earned points", () => {
    const review = {
      worked: "w".repeat(20),
      tryNext: "t".repeat(20),
      why: "y".repeat(10),
      question: null,
      lessonId: null,
      confidence: 0.9,
      skillPoints: [
        { skill: "photography.light", points: 1 as const },
        { skill: "photography.story", points: 0 as const },
      ],
    };
    expect(skillChips(review)).toEqual(["Light +1"]);
  });

  it("asks quickly while the coach works, then slows down, then stops", () => {
    expect(pollDelay(0)).toBe(2_000);
    expect(pollDelay(25)).toBe(10_000);
    expect(pollDelay(40)).toBeNull();
  });

  it("gives helplines for the teen's country, and a finder elsewhere", () => {
    expect(helplines("US")[0]!.how).toBe("Call or text 988");
    expect(helplines("CA").map((h) => h.label)).toContain("Kids Help Phone");
    expect(helplines("FR")[0]!.url).toBe("https://findahelpline.com");
    expect(helplines(undefined)).toHaveLength(1);
  });

  it("labels makes on Today by where they are", () => {
    expect(makeStatusLabel("reviewing")).toBe("Your coach is looking");
    expect(makeStatusLabel("reviewed")).toBe("Review ready");
    expect(makeStatusLabel("blocked")).toBe("With our safety team");
    expect(makeStatusLabel("retake")).toBeNull();
  });
});
