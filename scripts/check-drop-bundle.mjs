// Smoke test for the bundled evening-drop edge function: it loads, needs its
// secret, and pushes a due drop with stand-ins for the database and Expo.
import assert from "node:assert/strict";
import { handleDropRequest } from "../supabase/functions/evening-drop/drop.bundle.mjs";

const pushed = [];
const deps = {
  candidates: async () => [{ teenId: "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a11", localDay: "2026-11-02", localTime: "20:01", prefs: { dropTime: "20:00", quietStart: "21:00", quietEnd: "07:00", dailyReminder: false }, lastDropDay: null, tokens: ["ExponentPushToken[a]"], pointsToday: 3, cheersToday: 0, madeToday: true }],
  record: async () => true,
  push: async (m) => (pushed.push(...m), { deadTokens: [] }),
  removeToken: async () => undefined,
  now: () => new Date(),
};
const post = (s) => new Request("https://x/evening-drop", { method: "POST", headers: { "x-drop-secret": s } });
assert.equal((await handleDropRequest(post("nope"), { DROP_WEBHOOK_SECRET: "s" })).status, 403);
assert.equal((await handleDropRequest(post("s"), { DROP_WEBHOOK_SECRET: "s" })).status, 503);
const res = await handleDropRequest(post("s"), { DROP_WEBHOOK_SECRET: "s" }, deps);
assert.equal((await res.json()).pushed.length, 1);
assert.equal(pushed[0].body, "You earned 3 skill points today.");
console.log("drop bundle ok");
