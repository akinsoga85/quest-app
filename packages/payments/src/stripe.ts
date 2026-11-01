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

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

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
}

// A Plus subscription for one teen, paid by their parent. The teen's id rides
// on the subscription (metadata.teen_id), which the webhook reads back.
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
  });
}

// Stripe's own page to change the card, see receipts or cancel.
export function createPortal(fetch: Fetch, secretKey: string, customerId: string, returnUrl: string): Promise<{ url: string }> {
  return stripePost(fetch, secretKey, "billing_portal/sessions", { customer: customerId, return_url: returnUrl });
}
