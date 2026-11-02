// Smoke test for the bundled coach edge function: it loads outside the repo's
// TypeScript, refuses callers without the secret, and runs a review end to end
// with stand-ins for the database, storage and Claude. No network.
import assert from "node:assert/strict";
import { handleCoachRequest } from "../supabase/functions/coach-review/coach.bundle.mjs";

const ctx = {
  makeId: "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a11",
  storagePath: "teen/make.jpg",
  zone: "photography",
  quest: { title: "Shadows that tell a story", brief: "Photograph the shadow, not the thing.", trainsSkill: "photography.light", tips: [] },
  zonePoints: 0,
  history: { questsDone: 0, skillPoints: {}, recentTips: [] },
};
const draft = {
  outcome: "review",
  worked: "The blind throws clean diagonal stripes across the wall, and keeping the window out of the frame makes the shadow the subject.",
  tryNext: "Next time, get lower and tilt up so the stripes run in from a corner of the frame.",
  why: "Diagonals that start at an edge pull the eye through the picture.",
  question: null,
  skillPoints: [{ skill: "photography.light", points: 1 }],
  lessonId: "photography.framing.leading-lines",
  confidence: 0.9,
  note: null,
};
const saved = [];
const deps = {
  db: {
    pending: async () => ["m1"],
    claim: async () => ({ consent: true, context: ctx }),
    saveReview: async (id, review) => saved.push([id, review.lessonId]),
    saveOutcome: async () => assert.fail("no outcome expected"),
  },
  photos: { read: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) },
  llm: {
    review: async () => ({ parsed: draft, refused: false, model: "stand-in" }),
    rewrite: async () => assert.fail("no rewrite expected"),
    check: async () => ({ parsed: { problems: [] }, refused: false, model: "stand-in" }),
  },
};
const env = { COACH_WEBHOOK_SECRET: "s" };
const post = (body, secret = "s") => new Request("https://x/coach-review", { method: "POST", headers: { "x-coach-secret": secret }, body: JSON.stringify(body) });

assert.equal((await handleCoachRequest(post({}, "nope"), env, deps)).status, 403);
const res = await handleCoachRequest(post({ record: { id: "m1", status: "reviewing" } }), env, deps);
assert.deepEqual(await res.json(), { results: { m1: "reviewed" } });
assert.deepEqual(saved, [["m1", "photography.framing.leading-lines"]]);
console.log("coach bundle ok");
