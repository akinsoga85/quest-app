// Smoke test for the bundled payments edge function: it loads, refuses a
// RevenueCat call without the secret, says when it isn't set up, and applies
// a purchase end to end with stand-ins.
import assert from "node:assert/strict";
import { handlePaymentsRequest } from "../supabase/functions/payments/payments.bundle.mjs";

const teen = "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a11";
const applied = [];
const deps = {
  apply: async (e) => (applied.push(e), "applied"),
  saveCustomer: async () => undefined,
  customerFor: async () => null,
  parentFromJwt: async () => null,
  fetch: async () => assert.fail("no Stripe call expected"),
  now: () => Date.now(),
};
const body = JSON.stringify({ event: { id: "rc1", type: "INITIAL_PURCHASE", app_user_id: teen, store: "PLAY_STORE", expiration_at_ms: Date.now() + 86400000 } });
const post = (auth) => new Request("https://x/functions/v1/payments/webhook", { method: "POST", headers: { authorization: auth }, body });
const env = { REVENUECAT_WEBHOOK_SECRET: "s" };
assert.equal((await handlePaymentsRequest(post("Bearer nope"), env, deps)).status, 401);
assert.equal((await handlePaymentsRequest(post("Bearer s"), env)).status, 503);
assert.deepEqual(await (await handlePaymentsRequest(post("Bearer s"), env, deps)).json(), { received: true, applied: "applied" });
assert.equal(applied[0].source, "google_play");
console.log("payments bundle ok");
