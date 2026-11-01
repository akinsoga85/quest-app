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
