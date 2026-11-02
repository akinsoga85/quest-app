import { PLUS, type PlusStatus } from "@quest/contract";
import { shortDate } from "../settings/logic";

// Plus in the app: the pure parts, tested in plus.test.ts.

export type PlusView = "included" | "active" | "buy" | "needs_parent" | "ask_parent" | "waiting" | "declined" | "none";

// What the Plus screen (and the Settings row) should show. 16–17s link a
// parent, ask them, and buy once they say yes.
export function plusView(s: PlusStatus | null): PlusView {
  if (!s) return "none";
  if (s.included) return "included";
  if (s.active) return "active";
  if (s.canBuyInApp) return "buy";
  if (s.needsParent) return "needs_parent";
  if (s.approval === "pending") return "waiting";
  if (s.approval === "declined") return "declined";
  return "ask_parent";
}

// The Settings row: null hides it.
export function plusRow(s: PlusStatus | null): { value: string; opens: boolean } | null {
  switch (plusView(s)) {
    case "included":
      return { value: "Included free", opens: true };
    case "active":
      return { value: `On${s?.until ? ` until ${shortDate(s.until)}` : ""}`, opens: true };
    case "waiting":
      return { value: "Waiting for a yes", opens: true };
    case "buy":
    case "needs_parent":
    case "ask_parent":
    case "declined":
      return { value: "Get Plus", opens: true };
    default:
      return null;
  }
}

// Where a paid Plus is managed. Never points to buying anywhere else.
export function manageLine(s: PlusStatus): string {
  if (s.source === "web") return "Your parent manages Plus.";
  return "Manage or cancel it in your phone's subscriptions.";
}

// The subscription terms the stores ask to be shown before buying.
export function renewalTerms(price: string, platform: "ios" | "android"): string {
  const account = platform === "ios" ? "Apple Account" : "Google Play account";
  return (
    `Plus is ${price} a month and renews every month until you cancel. ` +
    `Payment is charged to your ${account} when you confirm. ` +
    `Cancel any time in your ${account} subscriptions, at least 24 hours before it renews.`
  );
}

// Whether the store's customer info shows Plus.
export function storeHasPlus(activeEntitlements: Record<string, unknown> | undefined): boolean {
  return !!activeEntitlements && PLUS.entitlement in activeEntitlements;
}

// After a purchase the store tells our server by webhook; ask again a few
// times, a little further apart, before saying it'll show up soon.
export const SYNC_WAITS_MS = [1000, 2000, 3000, 5000, 8000];

export const MANAGE_SUBSCRIPTIONS_URL = {
  ios: "https://apps.apple.com/account/subscriptions",
  android: "https://play.google.com/store/account/subscriptions",
} as const;
