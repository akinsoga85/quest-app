import { CoachClaim, type CoachOutcome, type CoachReview } from "@quest/contract";
import type { CoachLLM } from "./claude";
import { runCoach, type CoachTrace } from "./coach";

// The coach's server loop, kept free of Supabase so it's unit-tested. The real
// database and storage come in through these (see supabase.ts).
export interface CoachDb {
  pending(limit: number): Promise<string[]>;
  claim(makeId: string): Promise<CoachClaim>;
  saveReview(makeId: string, review: CoachReview, model: string, promptVersion: string): Promise<string>;
  saveOutcome(makeId: string, outcome: CoachOutcome, note: string | null, lessonId: string | null, model: string): Promise<void>;
}

export interface PhotoStore {
  read(path: string): Promise<Uint8Array>;
}

export interface WorkerDeps {
  db: CoachDb;
  photos: PhotoStore;
  llm: CoachLLM;
  log?: (event: Record<string, unknown>) => void;
}

export type MakeResult = "reviewed" | "retake" | "concern" | "unavailable" | "skipped" | "no_consent" | "failed";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Base64 without Buffer or btoa, so it runs the same in Node and Deno.
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + "==";
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + "=";
  }
  return out;
}

// Reviews one make. Without consent it stops before reading the photo.
export async function reviewMake(makeId: string, deps: WorkerDeps): Promise<MakeResult> {
  const log = deps.log ?? (() => undefined);
  const claim = await deps.db.claim(makeId);
  if (claim === null) return "skipped";
  if (!claim.consent) return "no_consent";

  const ctx = claim.context;
  const trace: CoachTrace = { attempts: 0, problems: [] };
  const started = Date.now();
  try {
    const bytes = await deps.photos.read(ctx.storagePath);
    const result = await runCoach(deps.llm, { ctx, image: { base64: toBase64(bytes), mediaType: "image/jpeg" } }, trace);
    switch (result.kind) {
      case "review":
        await deps.db.saveReview(makeId, result.review, result.model, result.promptVersion);
        break;
      case "retake":
      case "concern":
        await deps.db.saveOutcome(makeId, result.kind, result.note, null, result.model);
        break;
      case "unavailable":
        await deps.db.saveOutcome(makeId, "unavailable", null, result.lessonId, result.model);
        break;
    }
    // Craft-only log line: no review text, no photo, no teen id.
    log({ makeId, outcome: result.kind, attempts: trace.attempts, problems: trace.problems.map((p) => p.length), ms: Date.now() - started });
    return result.kind === "review" ? "reviewed" : result.kind;
  } catch (e) {
    // The claim runs out after 3 minutes, and the next sweep tries again.
    log({ makeId, outcome: "failed", error: e instanceof Error ? e.message : String(e), ms: Date.now() - started });
    return "failed";
  }
}

// Reviews whatever is waiting, a few at a time.
export async function sweep(deps: WorkerDeps, limit = 10): Promise<Record<string, MakeResult>> {
  const results: Record<string, MakeResult> = {};
  for (const id of await deps.db.pending(limit)) results[id] = await reviewMake(id, deps);
  return results;
}
