// Stripe without its SDK: a signature check and two small REST calls, so the
// same code runs in Node (tests) and Deno (the edge function).

// Checks a Stripe-Signature header ("t=…,v1=…") against the raw body:
// HMAC-SHA256 of "t.body" with the endpoint's secret, within 5 minutes.
export async function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSeconds: number, toleranceSeconds = 300): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || sigs.length === 0 || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Compare in constant time.
  return sigs.some((s) => s.length === expected.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ expected.charCodeAt(i)), 0) === 0);
}

export type Fetch = (url: string, init: { method?: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

// Stripe's form encoding: nested keys in brackets.
export function formEncode(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

async function stripePost(fetch: Fetch, secretKey: string, path: string, params: Record<string, string | number | undefined>): Promise<{ url: string }> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: formEncode(params),
  });
  const body = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok || !body.url) throw new Error(`Stripe ${path}: ${body.error?.message ?? res.status}`);
  return { url: body.url };
}

export interface CheckoutParams {
  priceId: string;
  teenId: string;
  parentId: string;
  parentEmail: string | null;
  customerId: string | null; // a returning parent keeps one Stripe customer
  successUrl: string;
  cancelUrl: string;
  automaticTax: boolean; // Stripe Tax works out sales tax / GST from the parent's address
}

// A Plus subscription for one teen, paid by their parent. The teen's id rides
// on the subscription (metadata.teen_id), which the webhook reads back.
// With automatic tax, Checkout asks for as much of the address as tax needs,
// saves it on a returning parent's customer, and every renewal keeps it on.
export function createCheckout(fetch: Fetch, secretKey: string, p: CheckoutParams): Promise<{ url: string }> {
  return stripePost(fetch, secretKey, "checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": p.priceId,
    "line_items[0][quantity]": 1,
    success_url: p.successUrl,
    cancel_url: p.cancelUrl,
    client_reference_id: p.parentId,
    customer: p.customerId ?? undefined,
    customer_email: p.customerId ? undefined : (p.parentEmail ?? undefined),
    "metadata[teen_id]": p.teenId,
    "subscription_data[metadata][teen_id]": p.teenId,
    "subscription_data[metadata][parent_id]": p.parentId,
    "automatic_tax[enabled]": p.automaticTax ? "true" : undefined,
    "customer_update[address]": p.automaticTax && p.customerId ? "auto" : undefined,
  });
}

// Stripe's own page to change the card, see receipts or cancel. With no
// configuration, Stripe uses the account's default one from the dashboard.
export function createPortal(fetch: Fetch, secretKey: string, customerId: string, returnUrl: string, configuration?: string): Promise<{ url: string }> {
  return stripePost(fetch, secretKey, "billing_portal/sessions", { customer: customerId, return_url: returnUrl, configuration });
}

const LIVE = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

// When an account is deleted (A11), any web Plus it paid for or received
// stops at once: subscriptions carry metadata.teen_id and metadata.parent_id.
// Returns how many were cancelled. (App Store and Google Play subscriptions
// are cancelled by the person in their phone's settings.)
export async function cancelSubscriptionsFor(fetch: Fetch, secretKey: string, userId: string): Promise<number> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("not an account id");
  const auth = { Authorization: `Bearer ${secretKey}` };
  const ids = new Set<string>();
  // Stripe search can't mix AND and OR, so one search per field.
  for (const field of ["teen_id", "parent_id"]) {
    const query = encodeURIComponent(`metadata['${field}']:'${userId}'`);
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/search?limit=100&query=${query}`, { headers: auth });
    const body = (await res.json()) as { data?: { id: string; status: string }[]; error?: { message?: string } };
    if (!res.ok || !body.data) throw new Error(`Stripe subscriptions/search: ${body.error?.message ?? res.status}`);
    for (const s of body.data) if (LIVE.has(s.status)) ids.add(s.id);
  }
  for (const id of ids) {
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE", headers: auth });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(`Stripe cancel ${id}: ${body.error?.message ?? res.status}`);
    }
  }
  return ids.size;
}
