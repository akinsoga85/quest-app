// Smoke test for the bundled account-deletions edge function: it loads, needs
// its secret, and runs a deletion with stand-ins for the database and storage.
import assert from "node:assert/strict";
import { handleDeletionsRequest } from "../supabase/functions/account-deletions/deletions.bundle.mjs";

const U = "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a11";
let files = [`${U}/a.jpg`];
const deps = {
  due: async () => [{ userId: U, folder: U }],
  cancelBilling: async () => 0,
  listFolder: async () => files,
  removeFiles: async () => void (files = []),
  complete: async () => undefined,
  now: () => new Date(),
};
const post = (s) => new Request("https://x/account-deletions", { method: "POST", headers: { "x-deletions-secret": s } });
assert.equal((await handleDeletionsRequest(post("nope"), { DELETIONS_WEBHOOK_SECRET: "s" })).status, 403);
assert.equal((await handleDeletionsRequest(post("s"), { DELETIONS_WEBHOOK_SECRET: "s" })).status, 503);
const res = await handleDeletionsRequest(post("s"), { DELETIONS_WEBHOOK_SECRET: "s" }, deps);
assert.deepEqual(await res.json(), { deleted: [U], photosRemoved: 1, subscriptionsCancelled: 0, failed: [] });
console.log("deletions bundle ok");
