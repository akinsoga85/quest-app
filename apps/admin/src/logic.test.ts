import { SpotCheckItem } from "@quest/contract";
import { describe, expect, it } from "vitest";
import { actionsFor, gradeSummary, reasonLabel, shortDate, tabFor, weekMonday } from "./logic";

describe("admin site", () => {
  it("routes by hash, starting on the safety queue", () => {
    expect(tabFor("")).toBe("safety");
    expect(tabFor("#/weeks")).toBe("weeks");
    expect(tabFor("#spot-check")).toBe("spot-check");
    expect(tabFor("#/nope")).toBe("safety");
  });

  it("finds the Monday of a week", () => {
    expect(weekMonday(new Date("2026-11-01T10:00:00Z"))).toBe("2026-10-26"); // a Sunday
    expect(weekMonday(new Date("2026-11-02T00:00:00Z"))).toBe("2026-11-02");
    expect(weekMonday(new Date("2026-11-07T23:59:00Z"))).toBe("2026-11-02");
  });

  it("never offers to release (or show) known abuse imagery", () => {
    expect(actionsFor({ reasons: ["hash_match:vendor-1"] }).map((a) => a.resolution)).toEqual(["reported"]);
    expect(actionsFor({ reasons: ["nudity:0.35"] }).map((a) => a.resolution)).toEqual(["released", "kept_blocked", "removed", "reported"]);
  });

  it("labels reasons in plain words", () => {
    expect(["nudity:0.35", "coach_concern", "hash_match:vendor-1", "self_harm:0.6"].map(reasonLabel)).toEqual([
      "Nudity 35%",
      "Coach raised a concern",
      "Known abuse imagery (vendor-1)",
      "Self-harm 60%",
    ]);
    expect(shortDate("2026-11-08T15:00:00Z")).toBe("Nov 8");
  });

  it("totals the spot check grades", () => {
    const item = (grade: SpotCheckItem["grade"]): SpotCheckItem => ({
      reviewId: "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a11", storagePath: "t/a.jpg", quest: "q", zone: "photography",
      worked: "w", tryNext: "t", why: "y", question: null, confidence: 0.8, helpful: null, grade,
    });
    const s = gradeSummary([
      item({ specific: 5, accurate: 4, kind: 5, actionable: 3, guardrail_break: false }),
      item({ specific: 4, accurate: 4, kind: 5, actionable: 4, guardrail_break: true }),
      item(null),
    ]);
    expect(s).toEqual({ graded: 2, total: 3, specific: 4.5, accurate: 4, kind: 5, actionable: 3.5, breaks: 1 });
  });
});
