// Smoke test for the bundled safety-scan edge function: it loads, refuses
// callers without the secret, answers 503 with no vendors set up, and blocks
// a test hash end to end with stand-ins for the database and storage.
import assert from "node:assert/strict";
import { handleScanRequest, sha256Hex, exactHashMatcher, passingClassifier } from "../supabase/functions/safety-scan/scan.bundle.mjs";

const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);
const saved = [];
const deps = {
  db: {
    pending: async () => [],
    claim: async () => ({ makeId: "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a11", storagePath: "teen/a.jpg" }),
    save: async (id, result, reasons) => saved.push([id, result, reasons]),
  },
  store: { read: async () => photo, replace: async () => assert.fail("nothing to replace") },
  hashes: exactHashMatcher({ [await sha256Hex(photo)]: "vendor-test-1" }),
  classifier: passingClassifier,
};
const post = (body, secret = "s") => new Request("https://x/safety-scan", { method: "POST", headers: { "x-safety-secret": secret }, body: JSON.stringify(body) });

assert.equal((await handleScanRequest(post({}, "nope"), { SAFETY_WEBHOOK_SECRET: "s" })).status, 403);
assert.equal((await handleScanRequest(post({}), { SAFETY_WEBHOOK_SECRET: "s" })).status, 503);
const res = await handleScanRequest(post({ record: { id: "m1", status: "uploaded" } }), { SAFETY_WEBHOOK_SECRET: "s" }, deps);
assert.deepEqual(await res.json(), { results: { m1: "block" } });
assert.deepEqual(saved, [["m1", "block", ["hash_match:vendor-test-1"]]]);
console.log("safety bundle ok");
