import { z } from "zod";

// The five named cheers (hi-fi H10). Parents can send one back on a family share.
export const Cheer = z.enum(["great_light", "great_framing", "great_moment", "clever_idea", "love_this"]);
export type Cheer = z.infer<typeof Cheer>;

export const CHEER_LABELS: Record<Cheer, string> = {
  great_light: "Great light",
  great_framing: "Great framing",
  great_moment: "Great moment",
  clever_idea: "Clever idea",
  love_this: "Love this",
};

export const ParentLinkStatus = z.enum(["pending", "active", "revoked"]);
export type ParentLinkStatus = z.infer<typeof ParentLinkStatus>;

// Parent invite links expire after 7 days (A1 done-when).
export const PARENT_LINK_TTL_DAYS = 7;

// The link a teen sends to a parent. It opens the parent consent page (H24, A8).
// Built by hand: React Native's URL class doesn't support every method.
export function parentInviteUrl(parentSiteUrl: string, token: string): string {
  return `${parentSiteUrl.replace(/\/+$/, "")}/consent?t=${encodeURIComponent(token)}`;
}

// family.status: for the "Send to family" sheet (H17) and the review screen.
export const FamilyStatus = z.object({
  parents: z.array(z.object({ name: z.string() })),
  sent: z.boolean(),
  cheers: z.array(Cheer),
});
export type FamilyStatus = z.infer<typeof FamilyStatus>;

// parent.preview: what the consent page (H24) shows before sign-in.
export const InvitePreview = z.object({ teenHandle: z.string(), expiresAt: z.string() }).nullable();
export type InvitePreview = z.infer<typeof InvitePreview>;

// parent.feed: a make sent to this parent, with the cheer sent back, if any.
export const ParentFeedItem = z.object({
  shareId: z.uuid(),
  makeId: z.uuid(),
  storagePath: z.string(),
  teenHandle: z.string(),
  questTitle: z.string(),
  zone: z.string(),
  day: z.iso.date(),
  sharedAt: z.string(),
  cheer: Cheer.nullable(),
});
export type ParentFeedItem = z.infer<typeof ParentFeedItem>;

// parent.overview: each linked teen this week (H25), counts and levels only.
export const ParentOverview = z.object({
  weeklyEmail: z.boolean(),
  teens: z.array(
    z.object({
      teenId: z.uuid(),
      handle: z.string(),
      coachOn: z.boolean(),
      questsThisWeek: z.number().int().min(0),
      zones: z.array(z.object({ zone: z.string(), points: z.number().int().min(0) })),
    }),
  ),
});
export type ParentOverview = z.infer<typeof ParentOverview>;
