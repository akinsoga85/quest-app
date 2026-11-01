import { describe, expect, it } from "vitest";
import {
  Api,
  CoachReview,
  bracketForAge,
  coachReviewJsonSchema,
  isSkillOfZone,
  levelFor,
  levelledUp,
  modeFor,
  needsParentConsent,
  questRuleProblems,
  reviewGuardrailIssues,
  skillIdsFor,
  type QuestDraft,
} from "./index";

describe("age and mode", () => {
  it("brackets ages and stops under-13s", () => {
    expect(bracketForAge(12)).toBe("under_13");
    expect(bracketForAge(13)).toBe("13_15");
    expect(bracketForAge(16)).toBe("16_17");
    expect(bracketForAge(19)).toBe("18_19");
    expect(bracketForAge(20)).toBe("over_19");
  });

  it("Lean V1 puts everyone in Studio", () => {
    expect(modeFor({ country: "US", bracket: "16_17", wallsLive: false })).toBe("studio");
  });

  it("with walls live, Canadian 13–15s stay in Studio (R44)", () => {
    expect(modeFor({ country: "ca", bracket: "13_15", wallsLive: true })).toBe("studio");
    expect(modeFor({ country: "CA", bracket: "16_17", wallsLive: true })).toBe("walls");
    expect(modeFor({ country: "US", bracket: "13_15", wallsLive: true })).toBe("walls");
  });

  it("under-18s need parent consent", () => {
    expect(needsParentConsent("13_15")).toBe(true);
    expect(needsParentConsent("16_17")).toBe(true);
    expect(needsParentConsent("18_19")).toBe(false);
  });
});

describe("zones", () => {
  it("every zone has four skills", () => {
    for (const z of ["photography", "fashion", "art_crafts", "music", "words"] as const) {
      expect(skillIdsFor(z)).toHaveLength(4);
    }
    expect(isSkillOfZone("photography.light", "photography")).toBe(true);
    expect(isSkillOfZone("photography.light", "fashion")).toBe(false);
  });
});

describe("quest rules", () => {
  const ok: QuestDraft = {
    zone: "photography",
    title: "Shadows that tell a story",
    brief: "Find hard light (a window, a lamp, a streetlight) and photograph the shadow, not the thing.",
    minutes: 15,
    trainsSkill: "photography.light",
    tips: ["Side light makes longer shadows", "Get low and tilt up"],
  };

  it("passes a good quest", () => {
    expect(questRuleProblems(ok)).toEqual([]);
  });

  it("rejects quests that ask for faces or schools", () => {
    expect(questRuleProblems({ ...ok, brief: "Take a selfie in hard light from the window next to you." })).not.toEqual([]);
    expect(questRuleProblems({ ...ok, tips: ["Show your school sign"] })).not.toEqual([]);
  });

  it("requires fashion quests to be flat-lay", () => {
    const fashion: QuestDraft = { ...ok, zone: "fashion", trainsSkill: "fashion.colour", title: "Three pieces, one colour", brief: "Pick three pieces in one colour and arrange them so they work together." };
    expect(questRuleProblems(fashion)).toContain("fashion quests must be flat-lay (no one wears the outfit)");
    expect(questRuleProblems({ ...fashion, brief: fashion.brief + " Shoot it as a flat-lay." })).toEqual([]);
  });

  it("rejects a skill from another zone", () => {
    expect(questRuleProblems({ ...ok, trainsSkill: "fashion.colour" })).toHaveLength(1);
  });
});

describe("coach review", () => {
  const good: CoachReview = {
    worked:
      "The blind throws clean diagonal stripes across the wall, and keeping the window itself out of the frame makes the shadow the subject.",
    tryNext: "Next time, get lower and tilt up so the stripes run in from a corner of the frame.",
    why: "Diagonals that start at an edge pull the eye through the picture.",
    question: "What would change if something moved through the light?",
    skillPoints: [{ skill: "photography.light", points: 1 }],
    lessonId: "photo.leading-lines",
    confidence: 0.86,
  };

  it("accepts the house-voice example", () => {
    expect(CoachReview.parse(good)).toEqual(good);
    expect(reviewGuardrailIssues(good)).toEqual([]);
  });

  it("flags appearance, comparison and generic praise", () => {
    const bad = { ...good, worked: good.worked + " You look great and this is better than other teens. Great job" };
    const rules = reviewGuardrailIssues(bad).map((i) => i.rule);
    expect(rules).toEqual(expect.arrayContaining(["appearance", "comparison", "generic_praise"]));
  });

  it("flags reviews that are too short", () => {
    const short = { ...good, worked: "Nice clean stripes on the wall.", tryNext: "Get lower next time, tilt up.", why: "Pulls the eye.", question: null };
    expect(reviewGuardrailIssues(short).map((i) => i.rule)).toContain("length");
  });

  it("exports a JSON schema for structured output", () => {
    expect(coachReviewJsonSchema).toMatchObject({ type: "object" });
  });
});

describe("levels", () => {
  it("maps points to levels", () => {
    expect(levelFor(0)).toMatchObject({ level: 1, name: "Spark", nextAt: 10 });
    expect(levelFor(25)).toMatchObject({ level: 3, name: "Maker" });
    expect(levelFor(41).progress).toBeCloseTo(0.8);
    expect(levelFor(999)).toMatchObject({ level: 5, nextAt: null, progress: 1 });
  });

  it("detects a level-up", () => {
    expect(levelledUp(44, 45)).toBe(true);
    expect(levelledUp(45, 46)).toBe(false);
  });
});

describe("api", () => {
  it("every function names an owning package", () => {
    for (const def of Object.values(Api)) expect(def.owner).toMatch(/^A\d+$/);
  });

  it("validates a review response", () => {
    const out = Api["review.forMake"].output.parse({ state: "pending" });
    expect(out.state).toBe("pending");
  });
});
