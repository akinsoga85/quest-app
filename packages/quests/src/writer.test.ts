import { weekRuleProblems, type QuestWeekDraft } from "@quest/contract";
import { describe, expect, it, vi } from "vitest";
import { handleWriterRequest } from "./supabase";
import { draftMissingWeeks, writeWeek, writerParams, writerSystem, type DraftWeek, type WeeksDb, type WriterLLM, type WriterReply } from "./writer";

const SKILLS = ["photography.light", "photography.colour", "photography.framing", "photography.story"];
const GOOD: DraftWeek = {
  quests: Array.from({ length: 7 }, (_, i) => ({
    title: `Window light ${i + 1}`,
    brief: "Find one thing at home and photograph it in window light from a low angle.",
    minutes: 5 + i * 2,
    trainsSkill: SKILLS[i % 4]!,
    tips: ["Turn off the room light"],
  })),
};
const req = { zone: "photography", weekOf: "2026-11-09", recentTitles: [] };
const reply = (parsed: DraftWeek | null, refused = false): WriterReply => ({ parsed, refused, model: "claude-opus-5-5", turn: [] });

function fakeLLM(replies: WriterReply[]): WriterLLM & { problems: string[][] } {
  const problems: string[][] = [];
  return {
    problems,
    draft: vi.fn(async () => replies.shift()!),
    rewrite: vi.fn(async (_r, _p, found: string[]) => {
      problems.push(found);
      return replies.shift()!;
    }),
  };
}

describe("the quest writer", () => {
  it("A6 done when: drafts a week per zone with zero rule problems", async () => {
    const r = await writeWeek(fakeLLM([reply(GOOD)]), req);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(weekRuleProblems(r.week)).toEqual([]);
      expect(r.week.quests).toHaveLength(7);
      expect(r.week.quests.every((q) => q.zone === "photography")).toBe(true);
    }
  });

  it("sends a week with problems back once, with the problems listed", async () => {
    const risky: DraftWeek = { quests: GOOD.quests.map((q, i) => (i === 2 ? { ...q, brief: "Climb onto the roof at golden hour and shoot the street below." } : q)) };
    const llm = fakeLLM([reply(risky), reply(GOOD)]);
    const r = await writeWeek(llm, req);
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(llm.problems[0]!.join("|")).toMatch(/day 3: asks for something unsafe/);
  });

  it("never returns a week that still has problems", async () => {
    const noStory: DraftWeek = { quests: GOOD.quests.map((q) => ({ ...q, trainsSkill: "photography.light" })) };
    const r = await writeWeek(fakeLLM([reply(noStory), reply(noStory)]), req);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join("|")).toMatch(/no quest this week trains photography.story/);
  });

  it("avoids recent titles", async () => {
    const r = await writeWeek(fakeLLM([reply(GOOD), reply(GOOD)]), { ...req, recentTitles: ["Window light 4"] });
    expect(r.ok).toBe(false);
  });

  it("stops when Claude declines", async () => {
    expect(await writeWeek(fakeLLM([reply(null, true)]), req)).toEqual({ ok: false, problems: ["the model declined"], attempts: 1 });
  });

  it("asks Claude with the rules and curriculum in a cached system prompt", () => {
    const p = writerParams(req, "claude-opus-5-5");
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.fallbacks).toBe("default");
    expect(p.output_config.effort).toBe("high");
    expect(p.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(writerSystem("fashion")).toMatch(/flat-lays/);
    expect(writerSystem("photography")).toMatch(/photography.story/);
    expect(() => writerSystem("music")).toThrow();
  });
});

describe("the weekly job", () => {
  function fakeDb(): WeeksDb & { saved: QuestWeekDraft[] } {
    const saved: QuestWeekDraft[] = [];
    return {
      saved,
      weeksToDraft: async () => [
        { zone: "photography", weekOf: "2026-11-09" },
        { zone: "photography", weekOf: "2026-11-16" },
      ],
      recentTitles: async () => [],
      saveWeek: async (w) => {
        saved.push(w);
        return `week-${saved.length}`;
      },
    };
  }

  it("saves the good weeks and reports the rest, without saving them", async () => {
    const db = fakeDb();
    const bad: DraftWeek = { quests: GOOD.quests.slice(0, 5) };
    const results = await draftMissingWeeks(db, fakeLLM([reply(GOOD), reply(bad), reply(bad)]));
    expect(results.map((r) => [r.weekOf, r.saved])).toEqual([
      ["2026-11-09", "week-1"],
      ["2026-11-16", null],
    ]);
    expect(db.saved).toHaveLength(1);
    expect(results[1]!.problems.length).toBeGreaterThan(0);
  });

  it("the edge function needs its secret", async () => {
    const post = (s: string) => new Request("https://x/quest-writer", { method: "POST", headers: { "x-quests-secret": s }, body: "{}" });
    expect((await handleWriterRequest(post("nope"), { QUESTS_WEBHOOK_SECRET: "s" })).status).toBe(403);
    const res = await handleWriterRequest(post("s"), { QUESTS_WEBHOOK_SECRET: "s" }, { db: fakeDb(), llm: fakeLLM([reply(GOOD), reply(GOOD)]) });
    expect((await res.json()).results.map((r: { saved: string }) => r.saved)).toEqual(["week-1", "week-2"]);
  });
});
