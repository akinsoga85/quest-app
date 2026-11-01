import { z } from "zod";

// The child-safety scan (A5) runs on every photo before the coach or any
// person sees it: a hash match against known abuse imagery first, then a
// classifier. Nothing moves to the coach without a "pass" (the database
// refuses it). Starting thresholds, to tune with the safety vendor and the
// first weeks of the safety queue.

export const ScanResult = z.enum(["pass", "block", "human_review"]);
export type ScanResult = z.infer<typeof ScanResult>;

export const SafetyLabel = z.enum(["sexual", "nudity", "self_harm", "violence", "weapon", "drugs", "hate_symbol"]);
export type SafetyLabel = z.infer<typeof SafetyLabel>;

// At or above `block`, the photo is blocked; at or above `review`, a person
// checks it first. Scores are 0–1 from the classifier.
export const SAFETY_THRESHOLDS: Record<SafetyLabel, { review: number; block: number | null }> = {
  sexual: { review: 0.3, block: 0.8 },
  nudity: { review: 0.3, block: 0.8 },
  self_harm: { review: 0.25, block: null }, // never just blocked: a person follows up
  violence: { review: 0.5, block: null },
  weapon: { review: 0.5, block: null },
  drugs: { review: 0.5, block: null },
  hate_symbol: { review: 0.5, block: 0.9 },
};

export interface ScanEvidence {
  hashMatches: string[]; // ids of known-imagery matches; any match blocks
  labels: Partial<Record<SafetyLabel, number>>;
}

export interface ScanDecision {
  result: ScanResult;
  reasons: string[]; // e.g. "hash_match:abc", "self_harm:0.41"
}

// The rule, in one place: hash match → block; any label over its block line →
// block; any over its review line → a person checks; otherwise pass.
export function decideScan(e: ScanEvidence): ScanDecision {
  if (e.hashMatches.length > 0) {
    return { result: "block", reasons: e.hashMatches.map((id) => `hash_match:${id}`) };
  }
  const reasons: string[] = [];
  let result: ScanResult = "pass";
  for (const label of SafetyLabel.options) {
    const score = e.labels[label];
    if (score === undefined) continue;
    const t = SAFETY_THRESHOLDS[label];
    if (t.block !== null && score >= t.block) {
      result = "block";
      reasons.push(`${label}:${score.toFixed(2)}`);
    } else if (score >= t.review) {
      if (result === "pass") result = "human_review";
      reasons.push(`${label}:${score.toFixed(2)}`);
    }
  }
  return { result, reasons };
}

// What the scanner gets for one make (scan_claim).
export const ScanClaim = z.object({ makeId: z.uuid(), storagePath: z.string() }).nullable();
export type ScanClaim = z.infer<typeof ScanClaim>;
