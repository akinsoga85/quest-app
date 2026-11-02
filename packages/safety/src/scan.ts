import {
  decideScan,
  hasPrivateMetadata,
  jpegMetadata,
  stripJpegMetadata,
  type SafetyLabel,
  type ScanClaim,
  type ScanDecision,
  type ScanResult,
} from "@quest/contract";

// The safety scan's server loop (A5), kept free of Supabase and of any one
// vendor so it's unit-tested. Order matters: the hash match runs first, and a
// photo that matches known abuse imagery is never sent to anyone else.

export interface HashMatcher {
  name: string;
  match(bytes: Uint8Array): Promise<string[]>; // ids of known-imagery matches
}

export interface Classifier {
  name: string;
  classify(bytes: Uint8Array): Promise<Partial<Record<SafetyLabel, number>>>;
}

export interface ScanDb {
  pending(limit: number): Promise<string[]>;
  claim(makeId: string): Promise<ScanClaim>;
  save(makeId: string, result: ScanResult, reasons: string[], vendor: string): Promise<string>;
}

export interface ScanStore {
  read(path: string): Promise<Uint8Array>;
  replace(path: string, bytes: Uint8Array): Promise<void>;
}

export interface ScanDeps {
  db: ScanDb;
  store: ScanStore;
  hashes: HashMatcher;
  classifier: Classifier;
  log?: (event: Record<string, unknown>) => void;
}

export type ScanOutcome = ScanResult | "skipped" | "failed";

// Scans one make. If anything goes wrong it saves nothing: the make stays in
// 'scanning', can't reach the coach, and the next sweep tries again.
export async function scanMake(makeId: string, deps: ScanDeps): Promise<ScanOutcome> {
  const log = deps.log ?? (() => undefined);
  const claim = await deps.db.claim(makeId);
  if (!claim) return "skipped";
  const started = Date.now();
  try {
    let bytes = await deps.store.read(claim.storagePath);
    let decision: ScanDecision;
    let vendor: string;

    // The phone strips metadata (A3); check again, and clean the stored copy.
    let report;
    try {
      report = jpegMetadata(bytes);
    } catch {
      report = null;
    }
    if (report === null) {
      decision = { result: "human_review", reasons: ["not_a_jpeg"] };
      vendor = "format-check";
    } else {
      if (hasPrivateMetadata(report)) {
        bytes = stripJpegMetadata(bytes);
        await deps.store.replace(claim.storagePath, bytes);
        log({ makeId, metadataRemoved: true });
      }
      const matches = await deps.hashes.match(bytes);
      if (matches.length > 0) {
        decision = decideScan({ hashMatches: matches, labels: {} });
        vendor = deps.hashes.name;
      } else {
        const labels = await deps.classifier.classify(bytes);
        decision = decideScan({ hashMatches: [], labels });
        vendor = `${deps.hashes.name}+${deps.classifier.name}`;
      }
    }
    await deps.db.save(makeId, decision.result, decision.reasons, vendor);
    log({ makeId, result: decision.result, reasons: decision.reasons.length, ms: Date.now() - started });
    return decision.result;
  } catch (e) {
    log({ makeId, result: "failed", error: e instanceof Error ? e.message : String(e), ms: Date.now() - started });
    return "failed";
  }
}

export async function sweep(deps: ScanDeps, limit = 10): Promise<Record<string, ScanOutcome>> {
  const results: Record<string, ScanOutcome> = {};
  for (const id of await deps.db.pending(limit)) results[id] = await scanMake(id, deps);
  return results;
}

// ---------------------------------------------------------------------------
// Test vendors. Real hash matching (PhotoDNA, Thorn Safer) uses perceptual
// hashes that survive re-encoding; this matches exact SHA-256 only, for tests
// and staging. vendorsFromEnv refuses to run with it unless asked by name.

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function exactHashMatcher(known: Record<string, string>): HashMatcher {
  // known: sha256 hex → id
  return {
    name: "test-exact-sha256",
    async match(bytes) {
      const id = known[await sha256Hex(bytes)];
      return id ? [id] : [];
    },
  };
}

// A classifier that never flags anything: for staging only, where every
// photo is the team's own.
export const passingClassifier: Classifier = { name: "test-passing", classify: async () => ({}) };

export function vendorsFromEnv(env: Record<string, string | undefined>): Pick<ScanDeps, "hashes" | "classifier"> {
  if (env.SAFETY_VENDORS === "test") {
    const known: Record<string, string> = {};
    for (const pair of (env.SAFETY_TEST_HASHES ?? "").split(",").filter(Boolean)) {
      const [hash, id] = pair.split(":");
      if (hash) known[hash.toLowerCase()] = id || "test";
    }
    return { hashes: exactHashMatcher(known), classifier: passingClassifier };
  }
  // Fail closed: with no real vendors set up, nothing is scanned, so nothing
  // reaches the coach.
  throw new Error("The safety scan has no vendors set up. Set SAFETY_VENDORS (see README).");
}
