import { z } from "zod";
import type { AgeBracket } from "./age";

// Plus (A9). Prices are the plan's starting points, to test.
//   13–15: Plus is included, free.
//   16–17: a linked parent buys it on the parent page (Stripe), or the teen
//          buys it in the app (App Store or Google Play, through RevenueCat)
//          once a linked parent has approved it.
//   18–19: in the app, or on the parent page if a parent is linked.
// Every purchase arrives as a webhook and becomes an EntitlementEvent; the
// database applies each one once. The App Store asks that a subscription the
// app unlocks is also sold in the app (3.1.3(b)), hence in-app for 16+.

export const PLUS = {
  monthlyUsd: 7.99,
  extraTeenUsd: 3.99,
  // Fixed Canadian prices: Stripe's checkout shows them to parents in Canada.
  // Set them in the App Store and Google Play for Canada too (docs/payments-setup.md).
  monthlyCad: 10.99,
  extraTeenCad: 5.49,
  perks: [
    "Deeper coaching and a second take after a redo",
    "A printed postcard every month they level up (when prints launch)",
    "A monthly skill report for you",
  ],
  // What the teen's Plus screen promises: only perks that exist today.
  teenPerks: ["Deeper coaching: the coach takes more time over every make", "A second take: make each quest twice and see what changed"],
  // The RevenueCat entitlement the store products unlock.
  entitlement: "plus",
} as const;

// 13–15s get Plus free.
export function plusIncluded(bracket: AgeBracket): boolean {
  return bracket === "13_15";
}

// A 16–17 asks; a linked parent says yes or not now on the parent page. A yes
// lasts this long, for one purchase.
export const PLUS_APPROVAL_DAYS = 7;
export const PlusApproval = z.enum(["none", "pending", "approved", "declined"]);
export type PlusApproval = z.infer<typeof PlusApproval>;

// Who may buy in the app: 18–19s, and 16–17s once a linked parent has
// approved it. 13–15s never need to.
export function canBuyInApp(bracket: AgeBracket, approval: PlusApproval): boolean {
  if (bracket === "18_19") return true;
  if (bracket === "16_17") return approval === "approved";
  return false;
}

export const EntitlementSource = z.enum(["app_store", "google_play", "web"]);
export type EntitlementSource = z.infer<typeof EntitlementSource>;

// What a store event means for the teen's Plus.
//   active        bought or renewed: Plus until activeUntil
//   cancelled     won't renew: Plus stays until activeUntil
//   expired       ended: Plus stops now
//   refunded      money back: Plus stops now
//   billing_issue payment failed: nothing changes while the store retries
export const EntitlementKind = z.enum(["active", "cancelled", "expired", "refunded", "billing_issue"]);
export type EntitlementKind = z.infer<typeof EntitlementKind>;

export const EntitlementEvent = z.object({
  eventId: z.string().min(1),
  teenId: z.uuid(),
  source: EntitlementSource,
  kind: EntitlementKind,
  activeUntil: z.iso.datetime({ offset: true }).nullable(),
  sandbox: z.boolean(),
});
export type EntitlementEvent = z.infer<typeof EntitlementEvent>;

const iso = (ms: number | null | undefined) => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

// RevenueCat webhooks (App Store and Google Play). app_user_id is the teen's id.
export function fromRevenueCat(body: unknown): EntitlementEvent | null {
  const e = (body as { event?: Record<string, unknown> })?.event;
  if (!e || typeof e.id !== "string" || typeof e.app_user_id !== "string") return null;
  const store = e.store === "APP_STORE" ? "app_store" : e.store === "PLAY_STORE" ? "google_play" : e.store === "STRIPE" || e.store === "RC_BILLING" ? "web" : null;
  if (!store) return null;
  const until = iso(e.expiration_at_ms as number | undefined);
  let kind: EntitlementKind | null;
  switch (e.type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "UNCANCELLATION":
    case "PRODUCT_CHANGE":
    case "SUBSCRIPTION_EXTENDED":
    case "NON_RENEWING_PURCHASE":
    case "TEMPORARY_ENTITLEMENT_GRANT":
    case "REFUND_REVERSED":
      kind = "active";
      break;
    case "CANCELLATION":
      // A refund through the store arrives as a cancellation for customer support.
      kind = e.cancel_reason === "CUSTOMER_SUPPORT" ? "refunded" : "cancelled";
      break;
    case "EXPIRATION":
      kind = "expired";
      break;
    case "BILLING_ISSUE":
      kind = "billing_issue";
      break;
    default:
      kind = null; // TRANSFER, SUBSCRIBER_ALIAS, test pings: nothing to apply
  }
  if (!kind) return null;
  const parsed = EntitlementEvent.safeParse({ eventId: `rc:${e.id}`, teenId: e.app_user_id, source: store, kind, activeUntil: until, sandbox: e.environment === "SANDBOX" });
  return parsed.success ? parsed.data : null;
}

// Stripe webhooks (the parent page). The subscription carries the teen's id
// in metadata.teen_id, set at checkout. A refund on the web is done by
// cancelling the subscription immediately with a refund, which arrives here
// as customer.subscription.deleted.
export function fromStripe(body: unknown): EntitlementEvent | null {
  const ev = body as { id?: string; type?: string; livemode?: boolean; data?: { object?: Record<string, unknown> } };
  const sub = ev?.data?.object;
  if (!ev?.id || !ev.type || !sub || sub.object !== "subscription") return null;
  const teenId = (sub.metadata as Record<string, string> | undefined)?.teen_id;
  const items = (sub.items as { data?: { current_period_end?: number }[] } | undefined)?.data;
  const periodEnd = (sub.current_period_end as number | undefined) ?? items?.[0]?.current_period_end;
  const until = iso(typeof periodEnd === "number" ? periodEnd * 1000 : undefined);
  let kind: EntitlementKind | null = null;
  if (ev.type === "customer.subscription.deleted") kind = "expired";
  else if (ev.type === "customer.subscription.created" || ev.type === "customer.subscription.updated") {
    const status = sub.status;
    if (status === "active" || status === "trialing") kind = sub.cancel_at_period_end ? "cancelled" : "active";
    else if (status === "past_due") kind = "billing_issue";
    else if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") kind = "expired";
  }
  if (!kind) return null;
  const parsed = EntitlementEvent.safeParse({ eventId: `stripe:${ev.id}`, teenId, source: "web", kind, activeUntil: until, sandbox: ev.livemode === false });
  return parsed.success ? parsed.data : null;
}

// plus.status: what the app shows the teen.
export const PlusStatus = z.object({
  active: z.boolean(),
  included: z.boolean(), // free for 13–15; `until` and `source` are then null
  until: z.string().nullable(),
  source: EntitlementSource.nullable(),
  canBuyInApp: z.boolean(),
  needsParent: z.boolean(), // 16–17 with no parent linked yet
  approval: PlusApproval, // 16–17s: where their request stands ("none" for everyone else)
});
export type PlusStatus = z.infer<typeof PlusStatus>;

// parent.plus: Plus for each linked teen, on the parent page.
export const ParentPlus = z.array(
  z.object({
    teenId: z.uuid(),
    active: z.boolean(),
    included: z.boolean(),
    until: z.string().nullable(),
    source: EntitlementSource.nullable(),
    request: z.object({ id: z.uuid(), requestedAt: z.string() }).nullable(), // a 16–17 waiting for a yes
  }),
);
export type ParentPlus = z.infer<typeof ParentPlus>;
