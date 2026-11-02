import { z } from "zod";
import { AgeBracket, AgeSource, AppMode } from "./age";
import { ReviewState } from "./review";
import { Cheer } from "./family";
import { NewPostcard, StudioPage, ZoneLevel } from "./levels";
import { MakeStatus } from "./photo";
import { Today } from "./today";
import { MAX_ZONES_PER_TEEN, ZoneId } from "./zones";

// Server functions the app calls. Each package builds its own functions against these shapes,
// and the app calls them only through these. `owner` is the build package
// responsible. Functions with `rpc` are Postgres functions (supabase.rpc(name),
// arguments prefixed p_); the rest are Supabase edge functions. Server-only
// steps (the safety scan, A5, and the coach, A4) aren't here: the app never
// calls them; the database starts them (see safety.ts and review.ts).
export const Api = {
  "teen.create": {
    owner: "A1",
    rpc: "create_teen_profile",
    input: z.object({
      ageBracket: AgeBracket,
      ageSource: AgeSource,
      country: z.string().regex(/^[A-Z]{2}$/),
      region: z.string().max(8).nullable(),
      timezone: z.string().min(1),
    }),
    output: z.object({ handle: z.string(), mode: AppMode, needsParent: z.boolean() }),
  },
  "signup.abandon": {
    owner: "A1",
    rpc: "abandon_signup",
    input: z.object({}),
    output: z.object({ ok: z.literal(true) }),
  },
  "parent.invite": {
    owner: "A1",
    rpc: "create_parent_invite",
    input: z.object({}),
    // The app turns the token into a link with parentInviteUrl().
    output: z.object({ token: z.string().regex(/^[0-9a-f]{64}$/), expiresAt: z.iso.datetime({ offset: true }) }),
  },
  "parent.accept": {
    owner: "A1",
    rpc: "accept_parent_invite",
    input: z.object({ token: z.string() }),
    output: z.object({ teenHandle: z.string() }),
  },
  "ai.consent": {
    owner: "A1",
    rpc: "set_ai_coach_consent",
    // A teen can switch coach reviews on or off; a linked parent can only switch them off.
    input: z.object({ allow: z.boolean(), teenId: z.uuid().nullable() }),
    output: z.object({ ok: z.literal(true) }),
  },
  "zones.set": {
    owner: "A2",
    rpc: "set_teen_zones",
    // Replaces the teen's zones. Progress in a dropped zone is kept for when they come back.
    input: z.object({ zones: z.array(ZoneId).min(1).max(MAX_ZONES_PER_TEEN) }),
    output: z.object({ ok: z.literal(true) }),
  },
  "today.get": {
    owner: "A2",
    rpc: "get_today",
    // Today's quests in the teen's zones, by their local day, plus this week and the streak.
    input: z.object({}),
    output: Today,
  },
  "make.record": {
    owner: "A3",
    rpc: "record_make",
    // Called after the photo is in storage at makePath(teenId, makeId). The app
    // makes the id when the photo is taken, so a retry after a dropped
    // connection never makes a second make. capturedAt lets a photo taken
    // offline count for the day it was taken (within MAKE_UPLOAD_WINDOW_HOURS).
    input: z.object({ makeId: z.uuid(), questId: z.uuid(), capturedAt: z.iso.datetime({ offset: true }) }),
    output: z.object({ makeId: z.uuid(), status: MakeStatus, localDay: z.iso.date() }),
  },
  "review.forMake": {
    owner: "A4",
    rpc: "get_review",
    input: z.object({ makeId: z.uuid() }),
    output: ReviewState,
  },
  "review.rate": {
    owner: "A4",
    rpc: "rate_review",
    // "Was this helpful?" on the review screen (H16).
    input: z.object({ reviewId: z.uuid(), helpful: z.boolean() }),
    output: z.object({ ok: z.literal(true) }),
  },
  "levels.get": {
    owner: "A7",
    rpc: "get_levels",
    input: z.object({}),
    output: z.array(ZoneLevel),
  },
  "studio.list": {
    owner: "A7",
    rpc: "get_studio",
    input: z.object({ zone: z.string().nullable(), before: z.string().nullable(), limit: z.number().int().min(1).max(60) }),
    output: StudioPage,
  },
  "postcards.new": {
    owner: "A7",
    rpc: "get_new_postcards",
    input: z.object({}),
    output: z.array(NewPostcard),
  },
  "postcards.seen": {
    owner: "A7",
    rpc: "mark_postcards_seen",
    input: z.object({ ids: z.array(z.uuid()) }),
    output: z.object({ ok: z.literal(true) }),
  },
  "postcards.pick": {
    owner: "A7",
    rpc: "pick_postcard",
    // Which of the teen's own finished makes in that zone goes on the postcard.
    input: z.object({ postcardId: z.uuid(), makeId: z.uuid() }),
    output: z.object({ ok: z.literal(true) }),
  },
  "make.delete": {
    owner: "A7",
    rpc: "delete_make",
    // Returns the photo's path; the app then removes it from storage.
    input: z.object({ makeId: z.uuid() }),
    output: z.string(),
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
