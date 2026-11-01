import { z } from "zod";
import { CoachReview } from "./review";
import { Cheer } from "./family";

// Server functions (Supabase edge functions). Each package builds its own
// functions against these shapes, and the app calls them only through these.
// `owner` is the build package responsible for the function.
export const Api = {
  "parent.invite": {
    owner: "A1",
    input: z.object({}),
    output: z.object({ inviteUrl: z.url(), expiresAt: z.iso.datetime() }),
  },
  "ai.consent": {
    owner: "A1",
    input: z.object({ allow: z.boolean() }),
    output: z.object({ ok: z.literal(true) }),
  },
  "make.createUpload": {
    owner: "A3",
    input: z.object({ questId: z.uuid() }),
    output: z.object({ makeId: z.uuid(), path: z.string(), uploadUrl: z.url() }),
  },
  "make.submit": {
    owner: "A5",
    input: z.object({ makeId: z.uuid() }),
    output: z.object({ status: z.enum(["reviewing", "blocked", "held_for_review"]) }),
  },
  "review.forMake": {
    owner: "A4",
    input: z.object({ makeId: z.uuid() }),
    output: z.discriminatedUnion("state", [
      z.object({ state: z.literal("pending") }),
      z.object({ state: z.literal("ready"), reviewId: z.uuid(), review: CoachReview }),
      z.object({ state: z.literal("retake"), reason: z.string() }),
      z.object({ state: z.literal("no_consent") }),
    ]),
  },
  "review.rate": {
    owner: "A7",
    input: z.object({ reviewId: z.uuid(), helpful: z.boolean() }),
    output: z.object({ ok: z.literal(true) }),
  },
  "family.share": {
    owner: "A8",
    input: z.object({ makeId: z.uuid() }),
    output: z.object({ shareId: z.uuid() }),
  },
  "family.cheer": {
    owner: "A8",
    input: z.object({ shareId: z.uuid(), cheer: Cheer }),
    output: z.object({ ok: z.literal(true) }),
  },
  "account.export": {
    owner: "A11",
    input: z.object({}),
    output: z.object({ downloadUrl: z.url(), expiresAt: z.iso.datetime() }),
  },
  "account.delete": {
    owner: "A11",
    input: z.object({}),
    output: z.object({ requestId: z.uuid(), completesBy: z.iso.datetime() }),
  },
} as const;

export type ApiName = keyof typeof Api;
export type ApiInput<N extends ApiName> = z.infer<(typeof Api)[N]["input"]>;
export type ApiOutput<N extends ApiName> = z.infer<(typeof Api)[N]["output"]>;

// Account deletion completes within this many days (Settings copy, H21).
export const DELETION_DAYS = 30;
