import type { CoachClaim, CoachContext, CoachReview } from "@quest/contract";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MODELS, guardParams, modelsFromEnv, reviewParams, type CoachLLM, type ModelReply } from "./claude";
import { checkDraft, runCoach } from "./coach";
import { EvalCase, runEval } from "./eval";
import { PROMPT_VERSION } from "./knowledge";
import { reviewSystem, type CoachDraft, type GuardVerdict } from "./prompt";
import { handleCoachRequest } from "./supabase";
import { reviewMake, sweep, toBase64, type CoachDb, type WorkerDeps } from "./worker";

const ctx: CoachContext = {
  makeId: "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a11",
  storagePath: "teen/make.jpg",
  zone: "photography",
  quest: { title: "Shadows that tell a story", brief: "Find hard light and photograph the shadow, not the thing.", trainsSkill: "photography.light", tips: ["Side light makes longer shadows"] },
  zonePoints: 12,
  history: { questsDone: 4, skillPoints: { "photography.light": 5 }, recentTips: ["Keep the horizon level."] },
};
const image = { base64: "AAAA", mediaType: "image/jpeg" as const };

const GOOD: CoachDraft = {
  outcome: "review",
  worked: "The blind throws clean diagonal stripes across the wall, and keeping the window out of the frame makes the shadow the subject.",
  tryNext: "Next time, get lower and tilt up so the stripes run in from a corner of the frame.",
  why: "Diagonals that start at an edge pull the eye through the picture.",
  question: "What would change if something moved through the light?",
  skillPoints: [{ skill: "photography.light", points: 2 }, { skill: "photography.framing", points: 1 }],
  lessonId: "photography.framing.leading-lines",
  confidence: 0.86,
  note: null,
};

const reply = <T>(parsed: T | null, refused = false): ModelReply<T> => ({ parsed, refused, model: "claude-opus-5-5", turn: [{ type: "text", text: "{}" }] });
const clean = reply<GuardVerdict>({ problems: [] });

// A stand-in for Claude: answers from a script, and records what it was asked.
function fakeLLM(drafts: (ModelReply<CoachDraft>)[], verdicts: ModelReply<GuardVerdict>[] = [clean, clean]): CoachLLM & { calls: string[]; rewriteProblems: string[][] } {
  const calls: string[] = [];
  const rewriteProblems: string[][] = [];
  return {
    calls,
    rewriteProblems,
    review: vi.fn(async () => {
      calls.push("review");
      return drafts.shift()!;
    }),
    rewrite: vi.fn(async (_input, _prev, problems: string[]) => {
      calls.push("rewrite");
      rewriteProblems.push(problems);
      return drafts.shift()!;
    }),
    check: vi.fn(async () => {
      calls.push("check");
      return verdicts.shift()!;
    }),
  };
}

describe("the coach pipeline", () => {
  it("passes a good review through both checks", async () => {
    const llm = fakeLLM([reply(GOOD)]);
    const r = await runCoach(llm, { ctx, image });
    expect(r).toMatchObject({ kind: "review", promptVersion: PROMPT_VERSION, review: { lessonId: "photography.framing.leading-lines", confidence: 0.86 } });
    expect(llm.calls).toEqual(["review", "check"]);
  });

  it("sends an appearance comment back for one rewrite", async () => {
    const bad = { ...GOOD, worked: GOOD.worked + " You look great in the reflection." };
    const llm = fakeLLM([reply(bad), reply(GOOD)]);
    const r = await runCoach(llm, { ctx, image });
    expect(r.kind).toBe("review");
    expect(llm.calls).toEqual(["review", "rewrite", "check"]);
    expect(llm.rewriteProblems[0]!.join(" ")).toMatch(/appearance/);
  });

  it("gives a lesson instead when the guardrail check fails twice", async () => {
    const flagged = reply<GuardVerdict>({ problems: [{ rule: "companion_or_feelings", quote: "I'm always here for you" }] });
    const llm = fakeLLM([reply(GOOD), reply(GOOD)], [flagged, flagged]);
    const r = await runCoach(llm, { ctx, image });
    expect(r).toEqual({ kind: "unavailable", lessonId: "photography.light.side-light", model: "claude-opus-5-5", why: "failed checks twice" });
    expect(llm.calls).toEqual(["review", "check", "rewrite", "check"]);
  });

  it("fails closed when the guardrail check doesn't answer", async () => {
    const llm = fakeLLM([reply(GOOD), reply(GOOD)], [reply<GuardVerdict>(null, true), reply<GuardVerdict>(null)]);
    expect((await runCoach(llm, { ctx, image })).kind).toBe("unavailable");
  });

  it("asks for a retake when it can't see the work, kindly", async () => {
    const llm = fakeLLM([reply({ ...GOOD, outcome: "retake", worked: "", tryNext: "", why: "", skillPoints: [], note: "It's too dark to see the shadows. Try again near a window?" })]);
    expect(await runCoach(llm, { ctx, image })).toEqual({ kind: "retake", note: "It's too dark to see the shadows. Try again near a window?", model: "claude-opus-5-5" });
    // Low confidence counts as a retake too, with a default note if none fits.
    const unsure = fakeLLM([reply({ ...GOOD, confidence: 0.3, note: null })]);
    const r = await runCoach(unsure, { ctx, image });
    expect(r.kind).toBe("retake");
    expect(unsure.calls).toEqual(["review"]); // nothing to check: no review is shown
  });

  it("raises a concern without reviewing", async () => {
    const llm = fakeLLM([reply({ ...GOOD, outcome: "concern", worked: "", tryNext: "", why: "", skillPoints: [], note: "Note in the photo mentions hurting themself." })]);
    expect(await runCoach(llm, { ctx, image })).toEqual({ kind: "concern", note: "Note in the photo mentions hurting themself.", model: "claude-opus-5-5" });
    expect(llm.calls).toEqual(["review"]);
  });

  it("gives a lesson instead when Claude and its fallback decline", async () => {
    const llm = fakeLLM([reply<CoachDraft>(null, true)]);
    expect((await runCoach(llm, { ctx, image })).kind).toBe("unavailable");
    expect(llm.calls).toEqual(["review"]);
  });

  it("rewrites an answer that didn't match the format", async () => {
    const llm = fakeLLM([reply<CoachDraft>(null), reply(GOOD)]);
    expect((await runCoach(llm, { ctx, image })).kind).toBe("review");
  });
});

describe("checking a draft", () => {
  it("catches skills from other zones, too many skills and bad points", () => {
    const { problems } = checkDraft(
      { ...GOOD, skillPoints: [{ skill: "fashion.colour", points: 1 }, { skill: "photography.light", points: 3 }, { skill: "photography.story", points: 1 }] },
      ctx,
    );
    expect(problems.join("|")).toMatch(/one or two skills/);
    expect(problems.join("|")).toMatch(/fashion.colour isn't a skill/);
    expect(problems.join("|")).toMatch(/points must be 0, 1 or 2/);
  });

  it("swaps a made-up lesson for the trained skill's", () => {
    const { review } = checkDraft({ ...GOOD, lessonId: "photography.light.made-up" }, ctx);
    expect(review?.lessonId).toBe("photography.light.side-light");
  });

  it("holds reviews to 40–110 words and the contract's limits", () => {
    expect(checkDraft({ ...GOOD, worked: "Nice light.", tryNext: "Get lower.", why: "It helps.", question: null }, ctx).review).toBeNull();
  });
});

describe("what's sent to Claude", () => {
  const params = reviewParams({ ctx, image }, DEFAULT_MODELS);

  it("uses Claude Opus 5.5 with refusal fallbacks, a cached system prompt and the photo", () => {
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.fallbacks).toBe("default");
    expect(params.output_config.effort).toBe("medium");
    expect(params.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    const [img, text] = params.messages[0]!.content;
    expect(img).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } });
    expect(text && "text" in text ? text.text : "").toContain('Today\'s quest: "Shadows that tell a story"');
    expect(guardParams(GOOD, ctx, DEFAULT_MODELS).model).toBe("claude-haiku-5-5");
  });

  it("keeps the system prompt the same for every review in a zone, so it caches", () => {
    const other = reviewParams({ ctx: { ...ctx, makeId: "00000000-0000-4000-8000-000000000001", zonePoints: 70 }, image }, DEFAULT_MODELS);
    expect(other.system).toEqual(params.system);
    expect(reviewSystem("photography")).toContain("Leading lines");
    expect(reviewSystem("photography")).toMatch(/Never:/);
  });

  it("sends nothing personal: no ids, handle or place", () => {
    const sent = JSON.stringify(params.messages);
    expect(sent).not.toContain(ctx.makeId);
    expect(sent).not.toContain(ctx.storagePath);
  });

  it("can switch models and effort from the environment", () => {
    expect(modelsFromEnv({ COACH_MODEL: "claude-sonnet-5-5", COACH_EFFORT: "low" })).toEqual({ review: "claude-sonnet-5-5", guard: "claude-haiku-5-5", reviewEffort: "low" });
    expect(modelsFromEnv({ COACH_EFFORT: "max" }).reviewEffort).toBe("medium");
  });
});

// ---------------------------------------------------------------------------

function fakeDb(claim: CoachClaim): CoachDb & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    pending: vi.fn(async () => ["m1"]),
    claim: vi.fn(async () => claim),
    saveReview: vi.fn(async (id: string, review: CoachReview) => {
      saved.push(["review", id, review.worked]);
      return "r1";
    }),
    saveOutcome: vi.fn(async (id: string, outcome: string, note: string | null, lesson: string | null) => {
      saved.push([outcome, id, note, lesson]);
    }),
  };
}

describe("the server worker", () => {
  it("A4 done when (worker side): no consent, no photo read and no call to Claude", async () => {
    const db = fakeDb({ consent: false });
    const photos = { read: vi.fn(async () => new Uint8Array([1, 2, 3])) };
    const llm = fakeLLM([reply(GOOD)]);
    expect(await reviewMake("m1", { db, photos, llm })).toBe("no_consent");
    expect(photos.read).not.toHaveBeenCalled();
    expect(llm.calls).toEqual([]);
    expect(db.saved).toEqual([]);
  });

  it("reviews and saves when consent is there", async () => {
    const db = fakeDb({ consent: true, context: ctx });
    const photos = { read: vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff])) };
    const deps: WorkerDeps = { db, photos, llm: fakeLLM([reply(GOOD)]) };
    expect(await sweep(deps)).toEqual({ m1: "reviewed" });
    expect(photos.read).toHaveBeenCalledWith("teen/make.jpg");
    expect(db.saved).toEqual([["review", "m1", GOOD.worked]]);
  });

  it("saves retakes, concerns and lessons as outcomes", async () => {
    const db = fakeDb({ consent: true, context: ctx });
    const photos = { read: async () => new Uint8Array([1]) };
    await reviewMake("m1", { db, photos, llm: fakeLLM([reply({ ...GOOD, outcome: "concern", note: "staff note" })]) });
    await reviewMake("m1", { db, photos, llm: fakeLLM([reply<CoachDraft>(null, true)]) });
    expect(db.saved).toEqual([
      ["concern", "m1", "staff note", null],
      ["unavailable", "m1", null, "photography.light.side-light"],
    ]);
  });

  it("leaves the make for the next sweep if something breaks", async () => {
    const db = fakeDb({ consent: true, context: ctx });
    const log = vi.fn();
    const r = await reviewMake("m1", { db, photos: { read: async () => Promise.reject(new Error("storage down")) }, llm: fakeLLM([]), log });
    expect(r).toBe("failed");
    expect(db.saved).toEqual([]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("teen/"); // logs carry no paths or text
  });

  it("does nothing when there's nothing to claim", async () => {
    expect(await reviewMake("m1", { db: fakeDb(null), photos: { read: vi.fn() }, llm: fakeLLM([]) })).toBe("skipped");
  });

  it("encodes photos as base64", () => {
    expect(toBase64(new TextEncoder().encode("Man"))).toBe("TWFu");
    expect(toBase64(new TextEncoder().encode("Ma"))).toBe("TWE=");
    expect(toBase64(new TextEncoder().encode("M"))).toBe("TQ==");
    expect(toBase64(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("/9j/4A==");
  });
});

describe("the edge function", () => {
  const env = { COACH_WEBHOOK_SECRET: "s3cret" };
  const deps = (): WorkerDeps => ({ db: fakeDb({ consent: true, context: ctx }), photos: { read: async () => new Uint8Array([1]) }, llm: fakeLLM([reply(GOOD)]) });
  const post = (body: unknown, secret = "s3cret") => new Request("https://x/coach-review", { method: "POST", headers: { "x-coach-secret": secret }, body: JSON.stringify(body) });

  it("refuses callers without the secret", async () => {
    expect((await handleCoachRequest(post({}, "wrong"), env, deps())).status).toBe(403);
    expect((await handleCoachRequest(post({}), {}, deps())).status).toBe(403);
  });

  it("reviews the make from a database webhook, or sweeps", async () => {
    const one = await handleCoachRequest(post({ type: "UPDATE", record: { id: "m9", status: "reviewing" } }), env, deps());
    expect(await one.json()).toEqual({ results: { m9: "reviewed" } });
    const all = await handleCoachRequest(post({}), env, deps());
    expect(await all.json()).toEqual({ results: { m1: "reviewed" } });
  });
});

describe("the test-set runner", () => {
  it("scores outcomes, guardrail breaks and words said that mustn't be", async () => {
    const cases = EvalCase.array().parse([
      { file: "a.jpg", zone: "photography", quest: ctx.quest, expect: "review" },
      { file: "blurry.jpg", zone: "photography", quest: ctx.quest, expect: "retake", hard: true },
      { file: "name.jpg", zone: "photography", quest: ctx.quest, expect: "review", hard: true, mustNotSay: ["Sarah"] },
    ]);
    const llm = fakeLLM(
      [reply(GOOD), reply({ ...GOOD, outcome: "retake", note: "Too blurry to see the shadows. Hold still and try again?" }), reply({ ...GOOD, worked: GOOD.worked.replace("The blind", "Sarah's blind") })],
      [clean, clean, clean],
    );
    const { rows, summary } = await runEval(cases, async () => new Uint8Array([1, 2, 3]), llm);
    expect(rows.map((r) => [r.got, r.ok])).toEqual([["review", true], ["retake", true], ["review", true]]);
    expect(rows[2]!.breaks).toEqual(['said "Sarah"']);
    expect(summary).toMatchObject({ cases: 3, outcomesRight: 3, breaks: 1, hardCaseBreaks: 1, hardCases: 2, hardCasesRight: 2, passed: false });
  });
});
