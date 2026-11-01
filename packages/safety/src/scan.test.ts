import { jpegMetadata, stripJpegMetadata, type SafetyLabel, type ScanResult } from "@quest/contract";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { exactHashMatcher, passingClassifier, scanMake, sha256Hex, sweep, vendorsFromEnv, type Classifier, type ScanDeps } from "./scan";
import { handleScanRequest } from "./supabase";

const RAW = new Uint8Array(readFileSync(new URL("../../contract/src/fixtures/gps.jpg", import.meta.url)));
const CLEAN = stripJpegMetadata(RAW);
const KNOWN_BAD = stripJpegMetadata(new Uint8Array(readFileSync(new URL("../../contract/src/fixtures/gps-progressive.jpg", import.meta.url))));

// A pretend database and storage. Each make's bytes come from `photos`.
function world(photos: Record<string, Uint8Array>, classifier: Classifier = passingClassifier, knownHashes: Record<string, string> = {}) {
  const saved: [string, ScanResult, string[], string][] = [];
  const stored = { ...photos };
  const deps: ScanDeps = {
    db: {
      pending: async () => Object.keys(photos),
      claim: async (id) => (id in stored ? { makeId: "00000000-0000-4000-8000-000000000001", storagePath: id } : null),
      save: async (id, result, reasons, vendor) => {
        saved.push([id, result, reasons, vendor]);
        return result;
      },
    },
    store: {
      read: async (path) => stored[path]!,
      replace: async (path, bytes) => {
        stored[path] = bytes;
      },
    },
    hashes: exactHashMatcher(knownHashes),
    classifier,
  };
  return { deps, saved, stored };
}

const scoring = (labels: Partial<Record<SafetyLabel, number>>): Classifier & { calls: number } => {
  const c = { name: "stub", calls: 0, classify: async () => (c.calls++, labels) };
  return c;
};

describe("the safety scan", () => {
  it("A5 done when: test hashes are always blocked", async () => {
    const badHash = await sha256Hex(KNOWN_BAD);
    const classifier = scoring({}); // a classifier that would pass everything
    const w = world({ "teen/a.jpg": KNOWN_BAD, "teen/b.jpg": KNOWN_BAD, "teen/ok.jpg": CLEAN }, classifier, { [badHash]: "vendor-test-1" });
    expect(await sweep(w.deps)).toEqual({ "teen/a.jpg": "block", "teen/b.jpg": "block", "teen/ok.jpg": "pass" });
    expect(w.saved.filter((s) => s[1] === "block").map((s) => s[2])).toEqual([["hash_match:vendor-test-1"], ["hash_match:vendor-test-1"]]);
    // A known image never goes on to the classifier (another third party).
    expect(classifier.calls).toBe(1);
  });

  it("holds a photo for a person when the classifier flags it", async () => {
    const w = world({ "teen/a.jpg": CLEAN }, scoring({ self_harm: 0.41 }));
    expect(await scanMake("teen/a.jpg", w.deps)).toBe("human_review");
    expect(w.saved[0]).toEqual(["teen/a.jpg", "human_review", ["self_harm:0.41"], "test-exact-sha256+stub"]);
  });

  it("fails closed: if a vendor breaks, nothing is saved and nothing passes", async () => {
    const broken: Classifier = { name: "broken", classify: async () => Promise.reject(new Error("vendor timeout")) };
    const log = vi.fn();
    const w = world({ "teen/a.jpg": CLEAN }, broken);
    expect(await scanMake("teen/a.jpg", { ...w.deps, log })).toBe("failed");
    expect(w.saved).toEqual([]);
    expect(log.mock.calls[0]![0]).toMatchObject({ result: "failed", error: "vendor timeout" });
  });

  it("removes metadata the phone missed, from the stored copy, before scanning", async () => {
    const w = world({ "teen/a.jpg": RAW });
    expect(await scanMake("teen/a.jpg", w.deps)).toBe("pass");
    expect(jpegMetadata(w.stored["teen/a.jpg"]!)).toMatchObject({ exif: false, gps: false });
  });

  it("holds anything that isn't a JPEG", async () => {
    const w = world({ "teen/a.jpg": new TextEncoder().encode("<html>not a photo</html>") });
    expect(await scanMake("teen/a.jpg", w.deps)).toBe("human_review");
    expect(w.saved[0]![2]).toEqual(["not_a_jpeg"]);
  });

  it("does nothing when there's nothing to claim", async () => {
    const w = world({});
    expect(await scanMake("nope", w.deps)).toBe("skipped");
  });
});

describe("setting up vendors", () => {
  it("refuses to run without vendors, so nothing reaches the coach unscanned", () => {
    expect(() => vendorsFromEnv({})).toThrow(/no vendors/);
  });

  it("runs test vendors only when asked by name, with the vendor's test hashes", async () => {
    const v = vendorsFromEnv({ SAFETY_VENDORS: "test", SAFETY_TEST_HASHES: `${await sha256Hex(KNOWN_BAD)}:t1,ABC:t2` });
    expect(await v.hashes.match(KNOWN_BAD)).toEqual(["t1"]);
    expect(await v.hashes.match(CLEAN)).toEqual([]);
  });

  it("the edge function refuses callers without the secret, and says when it isn't set up", async () => {
    const post = (secret: string) => new Request("https://x/safety-scan", { method: "POST", headers: { "x-safety-secret": secret }, body: "{}" });
    expect((await handleScanRequest(post("nope"), { SAFETY_WEBHOOK_SECRET: "s" })).status).toBe(403);
    expect((await handleScanRequest(post("s"), { SAFETY_WEBHOOK_SECRET: "s" })).status).toBe(503);
    const w = world({ "teen/a.jpg": CLEAN });
    const res = await handleScanRequest(
      new Request("https://x/safety-scan", { method: "POST", headers: { "x-safety-secret": "s" }, body: JSON.stringify({ record: { id: "teen/a.jpg", status: "uploaded" } }) }),
      { SAFETY_WEBHOOK_SECRET: "s" },
      w.deps,
    );
    expect(await res.json()).toEqual({ results: { "teen/a.jpg": "pass" } });
  });
});
