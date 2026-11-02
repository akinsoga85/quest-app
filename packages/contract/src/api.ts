import { z } from "zod";
import { AdminDeletion, AdminWeek, DataExport, DeletionRequest, Grade, QueueItem, SafetyResolution, SpotCheckItem } from "./admin";
import { AgeBracket, AgeSource, AppMode } from "./age";
import { ReviewState } from "./review";
import { Cheer, FamilyStatus, InvitePreview, ParentFeedItem, ParentOverview } from "./family";
import { NewPostcard, StudioPage, ZoneLevel } from "./levels";
import { MakeStatus } from "./photo";
import { Drop, NotificationPrefs } from "./notifications";
import { ParentPlus, PlusStatus } from "./plus";
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
    rpc: "share_with_family",
    // Sends a reviewed make to every actively linked parent. Returns how many.
    input: z.object({ makeId: z.uuid() }),
    output: z.number().int().min(0),
  },
  "family.status": {
    owner: "A8",
    rpc: "get_family_status",
    input: z.object({ makeId: z.uuid() }),
    output: FamilyStatus,
  },
  "family.cheer": {
    owner: "A8",
    rpc: "cheer_share",
    // A parent sends back one of five cheers, once per share. No free text.
    input: z.object({ shareId: z.uuid(), cheer: Cheer }),
    output: z.object({ ok: z.literal(true) }),
  },
  "parent.preview": {
    owner: "A8",
    rpc: "invite_preview",
    // Works signed out: the consent page shows whose invite it is.
    input: z.object({ token: z.string() }),
    output: InvitePreview,
  },
  "parent.consent": {
    owner: "A8",
    rpc: "give_parent_consent",
    // Confirms the parent is an adult, then accepts the invite.
    input: z.object({ token: z.string(), isAdult: z.literal(true) }),
    output: z.object({ teenHandle: z.string() }),
  },
  "parent.feed": {
    owner: "A8",
    rpc: "parent_feed",
    input: z.object({ before: z.string().nullable(), limit: z.number().int().min(1).max(50) }),
    output: z.array(ParentFeedItem),
  },
  "parent.overview": {
    owner: "A8",
    rpc: "parent_overview",
    input: z.object({}),
    output: ParentOverview,
  },
  "parent.weeklyEmail": {
    owner: "A8",
    rpc: "set_weekly_email",
    input: z.object({ on: z.boolean() }),
    output: z.object({ ok: z.literal(true) }),
  },
  "plus.status": {
    owner: "A9",
    rpc: "plus_status",
    input: z.object({}),
    output: PlusStatus,
  },
  "parent.plus": {
    owner: "A9",
    rpc: "parent_plus",
    input: z.object({}),
    output: ParentPlus,
  },
  "plus.checkout": {
    owner: "A9",
    // Edge function (plus-checkout), called by a signed-in parent for a linked
    // teen. Returns the Stripe Checkout page to send them to.
    input: z.object({ teenId: z.uuid() }),
    output: z.object({ url: z.url() }),
  },
  "plus.portal": {
    owner: "A9",
    // Edge function (plus-portal): Stripe's page to change or cancel Plus.
    input: z.object({}),
    output: z.object({ url: z.url() }),
  },
  "drop.get": {
    owner: "A10",
    rpc: "get_drop",
    input: z.object({}),
    output: Drop,
  },
  "notifications.prefs": {
    owner: "A10",
    rpc: "set_notification_prefs",
    input: NotificationPrefs,
    output: z.object({ ok: z.literal(true) }),
  },
  "push.register": {
    owner: "A10",
    rpc: "register_push_token",
    // An Expo push token for this phone; a teen can have several phones.
    input: z.object({ token: z.string().regex(/^Expo(nent)?PushToken\[.+\]$/), platform: z.enum(["ios", "android"]) }),
    output: z.object({ ok: z.literal(true) }),
  },
  "account.export": {
    owner: "A11",
    rpc: "export_my_data",
    // The app adds short-lived links to each photo and offers it as a file.
    input: z.object({}),
    output: DataExport,
  },
  "account.delete": {
    owner: "A11",
    rpc: "request_account_deletion",
    // Deleted after 7 days (cancellable until then), always within DELETION_DAYS.
    input: z.object({}),
    output: DeletionRequest,
  },
  "account.cancelDelete": {
    owner: "A11",
    rpc: "cancel_account_deletion",
    input: z.object({}),
    output: z.object({ ok: z.literal(true) }),
  },
  "account.deletion": {
    owner: "A11",
    rpc: "my_deletion",
    input: z.object({}),
    output: DeletionRequest.nullable(),
  },
  "admin.weeks": { owner: "A11", rpc: "admin_quest_weeks", input: z.object({ status: z.enum(["draft", "approved", "rejected"]) }), output: z.array(AdminWeek) },
  "admin.decideWeek": { owner: "A11", rpc: "admin_decide_week", input: z.object({ weekId: z.uuid(), approve: z.boolean(), note: z.string().nullable() }), output: z.object({ ok: z.literal(true) }) },
  "admin.safetyQueue": { owner: "A11", rpc: "admin_safety_queue", input: z.object({}), output: z.array(QueueItem) },
  "admin.resolveSafety": { owner: "A11", rpc: "admin_resolve_safety", input: z.object({ itemId: z.uuid(), resolution: SafetyResolution }), output: z.string().nullable() },
  "admin.spotCheck": { owner: "A11", rpc: "admin_spot_check", input: z.object({ weekOf: z.iso.date() }), output: z.array(SpotCheckItem) },
  "admin.grade": { owner: "A11", rpc: "admin_grade_review", input: Grade, output: z.object({ ok: z.literal(true) }) },
  "admin.deletions": { owner: "A11", rpc: "admin_deletions", input: z.object({}), output: z.array(AdminDeletion) },
} as const;

export type ApiName = keyof typeof Api;
export type ApiInput<N extends ApiName> = z.infer<(typeof Api)[N]["input"]>;
export type ApiOutput<N extends ApiName> = z.infer<(typeof Api)[N]["output"]>;

// Account deletion completes within this many days (Settings copy, H21).
export const DELETION_DAYS = 30;
