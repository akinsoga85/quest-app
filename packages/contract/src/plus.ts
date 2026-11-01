import { z } from "zod";
import type { AgeBracket } from "./age";

// Plus (A9). Prices are the plan's starting points, to test. Under-18s can't
// buy anything themselves: a parent buys Plus on the parent page (Stripe).
// 18–19s can also buy in the app (App Store or Google Play, through
// RevenueCat). Every purchase arrives as a webhook and becomes an
// EntitlementEvent; the database applies each one once.

export const PLUS = {
  monthlyUsd: 7.99,
  extraTeenUsd: 3.99,
  perks: [
    "Deeper coaching and a second take after a redo",
    "A printed postcard every month they level up (when prints launch)",
    "A monthly skill report for you",
  ],
} as const;

// Who may buy where.
export function canBuyInApp(bracket: AgeBracket): boolean {
  return bracket === "18_19";
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
  until: z.string().nullable(),
  source: EntitlementSource.nullable(),
  canBuyInApp: z.boolean(),
});
export type PlusStatus = z.infer<typeof PlusStatus>;

// parent.plus: Plus for each linked teen, on the parent page.
export const ParentPlus = z.array(z.object({ teenId: z.uuid(), active: z.boolean(), until: z.string().nullable(), source: EntitlementSource.nullable() }));
export type ParentPlus = z.infer<typeof ParentPlus>;
