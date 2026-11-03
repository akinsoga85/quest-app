import { PLUS } from "@quest/contract";
import { formEncode, type Fetch } from "./stripe";

// Sets up a Stripe account for Plus: the product, its two monthly prices, the
// customer portal and the webhook to the payments function. Run by
// scripts/setup-stripe.mjs, first with a test key, then with the live key.
// Safe to run again: it finds what's there by lookup key or metadata and only
// creates what's missing. Prices come from PLUS in the contract, the same
// numbers the parent page shows; change them there and run it again (new
// subscribers get the new price, existing ones keep theirs).

export const STRIPE_LOOKUP = { plus: "quest_plus_monthly", extraTeen: "quest_plus_extra_teen_monthly" } as const;
export const STRIPE_EVENTS = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"] as const;
const TAG = "plus"; // metadata[quest] on everything this creates

export interface StripeSetupOptions {
  webhookUrl: string; // https://<project>.supabase.co/functions/v1/payments/webhook
  returnUrl: string; // the parent site
  privacyUrl?: string;
  termsUrl?: string;
}

export interface StripeSetupResult {
  live: boolean;
  productId: string;
  pricePlus: string;
  priceExtraTeen: string;
  portalConfiguration: string;
  webhook: { id: string; secret: string | null; created: boolean };
  created: string[]; // what this run made, for the log
}

type Obj = { id: string; metadata?: Record<string, string>; [k: string]: unknown };

export async function setupStripe(fetch: Fetch, secretKey: string, o: StripeSetupOptions): Promise<StripeSetupResult> {
  const auth = { Authorization: `Bearer ${secretKey}` };
  const call = async <T>(method: "GET" | "POST", path: string, params: Record<string, string | number | undefined> = {}): Promise<T> => {
    const query = method === "GET" ? `?${formEncode(params)}` : "";
    const res = await fetch(`https://api.stripe.com/v1/${path}${query}`, {
      method,
      headers: method === "POST" ? { ...auth, "Content-Type": "application/x-www-form-urlencoded" } : auth,
      body: method === "POST" ? formEncode(params) : undefined,
    });
    const body = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`Stripe ${method} ${path}: ${body.error?.message ?? res.status}`);
    return body;
  };
  const created: string[] = [];
  const mine = (x: Obj) => x.metadata?.quest === TAG;

  // The product.
  const products = await call<{ data: Obj[] }>("GET", "products", { limit: 100, active: "true" });
  let product = products.data.find(mine);
  if (!product) {
    product = await call<Obj>("POST", "products", {
      name: "Quest Plus",
      description: "Deeper coaching and a second take on each quest, for one teen.",
      "metadata[quest]": TAG,
    });
    created.push(`product ${product.id}`);
  }

  // The two monthly prices, found by lookup key. A changed amount makes a new
  // price that takes over the lookup key.
  const prices = await call<{ data: (Obj & { lookup_key: string; unit_amount: number; currency: string })[] }>("GET", "prices", {
    "lookup_keys[0]": STRIPE_LOOKUP.plus,
    "lookup_keys[1]": STRIPE_LOOKUP.extraTeen,
    active: "true",
    limit: 10,
  });
  const price = async (lookupKey: string, usd: number, nickname: string): Promise<string> => {
    const cents = Math.round(usd * 100);
    const existing = prices.data.find((p) => p.lookup_key === lookupKey);
    if (existing && existing.unit_amount === cents && existing.currency === "usd") return existing.id;
    const p = await call<Obj>("POST", "prices", {
      product: product.id,
      currency: "usd",
      unit_amount: cents,
      "recurring[interval]": "month",
      lookup_key: lookupKey,
      transfer_lookup_key: existing ? "true" : undefined,
      nickname,
      "metadata[quest]": TAG,
    });
    created.push(`price ${p.id} (${nickname}, $${usd})`);
    return p.id;
  };
  const pricePlus = await price(STRIPE_LOOKUP.plus, PLUS.monthlyUsd, "Plus, monthly");
  const priceExtraTeen = await price(STRIPE_LOOKUP.extraTeen, PLUS.extraTeenUsd, "Plus, each extra teen, monthly");

  // The customer portal parents use to change their card, see receipts or
  // cancel (at the end of the month they've paid for).
  const portals = await call<{ data: Obj[] }>("GET", "billing_portal/configurations", { limit: 100 });
  let portal = portals.data.find(mine);
  if (!portal) {
    portal = await call<Obj>("POST", "billing_portal/configurations", {
      "business_profile[headline]": "Manage Quest Plus",
      "business_profile[privacy_policy_url]": o.privacyUrl,
      "business_profile[terms_of_service_url]": o.termsUrl,
      default_return_url: o.returnUrl,
      "features[invoice_history][enabled]": "true",
      "features[payment_method_update][enabled]": "true",
      "features[subscription_cancel][enabled]": "true",
      "features[subscription_cancel][mode]": "at_period_end",
      "metadata[quest]": TAG,
    });
    created.push(`customer portal ${portal.id}`);
  }

  // The webhook. Stripe shows its signing secret only when it's created.
  const hooks = await call<{ data: (Obj & { url: string; enabled_events: string[] })[] }>("GET", "webhook_endpoints", { limit: 100 });
  const hook = hooks.data.find((h) => h.url === o.webhookUrl);
  const events = Object.fromEntries(STRIPE_EVENTS.map((e, i) => [`enabled_events[${i}]`, e]));
  let webhook: StripeSetupResult["webhook"];
  if (!hook) {
    const h = await call<Obj & { secret: string }>("POST", "webhook_endpoints", {
      url: o.webhookUrl,
      description: "Quest Plus: subscriptions to the payments function",
      ...events,
      "metadata[quest]": TAG,
    });
    created.push(`webhook ${h.id}`);
    webhook = { id: h.id, secret: h.secret, created: true };
  } else {
    if (!STRIPE_EVENTS.every((e) => hook.enabled_events.includes(e) || hook.enabled_events.includes("*"))) {
      await call<Obj>("POST", `webhook_endpoints/${hook.id}`, events);
      created.push(`webhook ${hook.id} events updated`);
    }
    webhook = { id: hook.id, secret: null, created: false };
  }

  return { live: secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_"), productId: product.id, pricePlus, priceExtraTeen, portalConfiguration: portal.id, webhook, created };
}
