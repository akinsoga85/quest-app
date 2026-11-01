// Smoke test for the bundled quest-writer edge function: it loads, needs its
// secret, and saves only a week with zero rule problems, with stand-ins for
// the database and Claude.
import assert from "node:assert/strict";
import { handleWriterRequest } from "../supabase/functions/quest-writer/writer.bundle.mjs";

const skills = ["photography.light", "photography.colour", "photography.framing", "photography.story"];
const week = { quests: Array.from({ length: 7 }, (_, i) => ({ title: `Window light ${i + 1}`, brief: "Find one thing at home and photograph it in window light.", minutes: 10, trainsSkill: skills[i % 4], tips: [] })) };
const saved = [];
const deps = {
  db: { weeksToDraft: async () => [{ zone: "photography", weekOf: "2026-11-09" }], recentTitles: async () => [], saveWeek: async (w) => (saved.push(w), "w1") },
  llm: { draft: async () => ({ parsed: week, refused: false, model: "stand-in" }), rewrite: async () => assert.fail("no rewrite expected") },
};
const post = (secret) => new Request("https://x/quest-writer", { method: "POST", headers: { "x-quests-secret": secret }, body: "{}" });
assert.equal((await handleWriterRequest(post("nope"), { QUESTS_WEBHOOK_SECRET: "s" })).status, 403);
const res = await handleWriterRequest(post("s"), { QUESTS_WEBHOOK_SECRET: "s" }, deps);
assert.deepEqual((await res.json()).results, [{ zone: "photography", weekOf: "2026-11-09", saved: "w1", problems: [] }]);
assert.equal(saved[0].quests.length, 7);
console.log("writer bundle ok");
