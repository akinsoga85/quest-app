import type { EntitlementEvent } from "@quest/contract";
import { describe, expect, it, vi } from "vitest";
import { handlePayments, type Parent, type PaymentsDeps } from "./handler";
import { cancelSubscriptionsFor, formEncode, verifyStripeSignature, type Fetch } from "./stripe";

const TEEN = "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a11";
const OTHER_TEEN = "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a12";
const PARENT: Parent = { id: "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6aaa", email: "mom@example.com", teenIds: [TEEN], includedTeenIds: [], webPlusTeenIds: [] };
const NOW = Date.UTC(2026, 10, 1, 12);
const env = {
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  REVENUECAT_WEBHOOK_SECRET: "rc_secret",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_PRICE_PLUS: "price_plus",
  PARENT_SITE_URL: "https://parents.example.com/",
};

async function sign(body: string, t: number, secret = env.STRIPE_WEBHOOK_SECRET): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  return `t=${t},v1=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function deps(over: Partial<PaymentsDeps> = {}): PaymentsDeps & { applied: EntitlementEvent[]; calls: { url: string; body: string }[] } {
  const applied: EntitlementEvent[] = [];
  const calls: { url: string; body: string }[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, body: init.body ?? "" });
    return { ok: true, status: 200, json: async () => ({ url: "https://checkout.stripe.com/c/pay/cs_test_1" }) };
  };
  return {
    applied,
    calls,
    apply: async (e) => (applied.push(e), "applied"),
    saveCustomer: vi.fn(async () => undefined),
    customerFor: async () => null,
    parentFromJwt: async (jwt) => (jwt === "parent-jwt" ? PARENT : null),
    fetch,
    now: () => NOW,
    ...over,
  };
}

const post = (path: string, body: string, headers: Record<string, string> = {}) => new Request(`https://x.supabase.co/functions/v1/payments${path}`, { method: "POST", headers, body });

describe("webhooks", () => {
  const sub = JSON.stringify({
    id: "evt_1",
    type: "customer.subscription.created",
    livemode: false,
    data: { object: { object: "subscription", status: "active", metadata: { teen_id: TEEN }, current_period_end: NOW / 1000 + 30 * 86400 } },
  });

  it("applies a Stripe event only with a valid signature", async () => {
    const d = deps();
    const ok = await handlePayments(post("/webhook", sub, { "stripe-signature": await sign(sub, NOW / 1000) }), env, d);
    expect(await ok.json()).toEqual({ received: true, applied: "applied" });
    expect(d.applied[0]).toMatchObject({ teenId: TEEN, kind: "active", source: "web" });

    for (const header of [await sign(sub, NOW / 1000, "whsec_wrong"), await sign(sub, NOW / 1000 - 3600), "t=1,v1=00"]) {
      expect((await handlePayments(post("/webhook", sub, { "stripe-signature": header }), env, d)).status).toBe(400);
    }
    expect(d.applied).toHaveLength(1);
  });

  it("remembers the parent's Stripe customer after checkout", async () => {
    const d = deps();
    const done = JSON.stringify({ id: "evt_2", type: "checkout.session.completed", data: { object: { client_reference_id: PARENT.id, customer: "cus_123" } } });
    await handlePayments(post("/webhook", done, { "stripe-signature": await sign(done, NOW / 1000) }), env, d);
    expect(d.saveCustomer).toHaveBeenCalledWith(PARENT.id, "cus_123");
  });

  it("applies RevenueCat events only with the shared secret", async () => {
    const d = deps();
    const body = JSON.stringify({ event: { id: "rc1", type: "INITIAL_PURCHASE", app_user_id: TEEN, store: "APP_STORE", expiration_at_ms: NOW + 86400000 } });
    expect((await handlePayments(post("/webhook", body, { authorization: "Bearer nope" }), env, d)).status).toBe(401);
    expect((await handlePayments(post("/webhook", body, { authorization: "Bearer rc_secret" }), env, d)).status).toBe(200);
    expect(d.applied.map((e) => e.source)).toEqual(["app_store"]);
    // Events Plus ignores are acknowledged so the store stops resending them.
    const ping = JSON.stringify({ event: { id: "rc2", type: "TEST", app_user_id: TEEN, store: "APP_STORE" } });
    expect(await (await handlePayments(post("/webhook", ping, { authorization: "Bearer rc_secret" }), env, d)).json()).toEqual({ received: true, applied: "ignored" });
  });
});

describe("checkout and the manage page", () => {
  it("A9 done when (server side): only a signed-in, linked parent can start Plus", async () => {
    const d = deps();
    expect((await handlePayments(post("/checkout", JSON.stringify({ teenId: TEEN })), env, d)).status).toBe(401);
    expect((await handlePayments(post("/checkout", JSON.stringify({ teenId: TEEN }), { authorization: "Bearer teen-jwt" }), env, d)).status).toBe(401);
    expect((await handlePayments(post("/checkout", JSON.stringify({ teenId: OTHER_TEEN }), { authorization: "Bearer parent-jwt" }), env, d)).status).toBe(403);
    expect(d.calls).toHaveLength(0);

    const res = await handlePayments(post("/checkout", JSON.stringify({ teenId: TEEN }), { authorization: "Bearer parent-jwt" }), env, d);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    const form = new URLSearchParams(d.calls[0]!.body);
    expect(d.calls[0]!.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(Object.fromEntries(form)).toMatchObject({
      mode: "subscription",
      "line_items[0][price]": "price_plus",
      client_reference_id: PARENT.id,
      customer_email: "mom@example.com",
      "subscription_data[metadata][teen_id]": TEEN,
      success_url: "https://parents.example.com/?plus=started",
    });
  });

  it("reuses the parent's Stripe customer, and opens the manage page for them", async () => {
    const d = deps({ customerFor: async () => "cus_123" });
    await handlePayments(post("/checkout", JSON.stringify({ teenId: TEEN }), { authorization: "Bearer parent-jwt" }), env, d);
    const form = new URLSearchParams(d.calls[0]!.body);
    expect(form.get("customer")).toBe("cus_123");
    expect(form.get("customer_email")).toBeNull();
    await handlePayments(post("/portal", "{}", { authorization: "Bearer parent-jwt" }), env, d);
    expect(d.calls[1]!.url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
    expect((await handlePayments(post("/portal", "{}", { authorization: "Bearer parent-jwt" }), env, deps())).status).toBe(404);
  });

  it("never charges for a 13–15, who has Plus free", async () => {
    const d = deps({ parentFromJwt: async (jwt) => (jwt === "parent-jwt" ? { ...PARENT, includedTeenIds: [TEEN] } : null) });
    expect((await handlePayments(post("/checkout", JSON.stringify({ teenId: TEEN }), { authorization: "Bearer parent-jwt" }), env, d)).status).toBe(409);
    expect(d.calls).toHaveLength(0);
  });

  it("charges the extra-teen price for each teen after the first a parent pays for", async () => {
    const both = { ...PARENT, teenIds: [TEEN, OTHER_TEEN] };
    const withExtra = { ...env, STRIPE_PRICE_PLUS_EXTRA: "price_extra" };
    const priceFor = async (parent: Parent, e: Record<string, string>) => {
      const d = deps({ parentFromJwt: async () => parent });
      await handlePayments(post("/checkout", JSON.stringify({ teenId: OTHER_TEEN }), { authorization: "Bearer parent-jwt" }), e, d);
      return new URLSearchParams(d.calls[0]!.body).get("line_items[0][price]");
    };
    expect(await priceFor(both, withExtra)).toBe("price_plus"); // the first teen
    expect(await priceFor({ ...both, webPlusTeenIds: [TEEN] }, withExtra)).toBe("price_extra");
    expect(await priceFor({ ...both, webPlusTeenIds: [OTHER_TEEN] }, withExtra)).toBe("price_plus"); // renewing the same teen
    expect(await priceFor({ ...both, webPlusTeenIds: [TEEN] }, env)).toBe("price_plus"); // no extra price set up
  });

  it("opens the manage page with the Plus portal settings when they're set", async () => {
    const d = deps({ customerFor: async () => "cus_123" });
    await handlePayments(post("/portal", "{}", { authorization: "Bearer parent-jwt" }), { ...env, STRIPE_PORTAL_CONFIGURATION: "bpc_1" }, d);
    expect(new URLSearchParams(d.calls[0]!.body).get("configuration")).toBe("bpc_1");
  });

  it("says when payments aren't set up", async () => {
    expect((await handlePayments(post("/checkout", JSON.stringify({ teenId: TEEN }), { authorization: "Bearer parent-jwt" }), {}, deps())).status).toBe(503);
  });
});

describe("Stripe helpers", () => {
  it("encodes forms and rejects stale or forged signatures", async () => {
    expect(formEncode({ a: "1 2", "b[c]": 3, d: undefined })).toBe("a=1%202&b%5Bc%5D=3");
    expect(await verifyStripeSignature("{}", await sign("{}", 1000), env.STRIPE_WEBHOOK_SECRET, 1000)).toBe(true);
    expect(await verifyStripeSignature("{}", await sign("{}", 1000), env.STRIPE_WEBHOOK_SECRET, 1400)).toBe(false);
    expect(await verifyStripeSignature("{ }", await sign("{}", 1000), env.STRIPE_WEBHOOK_SECRET, 1000)).toBe(false);
    expect(await verifyStripeSignature("{}", null, env.STRIPE_WEBHOOK_SECRET, 1000)).toBe(false);
  });
});

describe("cancelling Plus when an account is deleted (A11)", () => {
  const user = "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a11";
  it("finds subscriptions by teen and by parent, and cancels the live ones once", async () => {
    const calls: string[] = [];
    const fetch = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${decodeURIComponent(url)}`);
      if (url.includes("/search")) {
        const byTeen = decodeURIComponent(url).includes("teen_id");
        const data = byTeen
          ? [{ id: "sub_1", status: "active" }, { id: "sub_old", status: "canceled" }]
          : [{ id: "sub_1", status: "active" }, { id: "sub_2", status: "past_due" }];
        return new Response(JSON.stringify({ data }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as Fetch;
    expect(await cancelSubscriptionsFor(fetch, "sk_test", user)).toBe(2);
    expect(calls.filter((c) => c.startsWith("DELETE"))).toEqual(["DELETE https://api.stripe.com/v1/subscriptions/sub_1", "DELETE https://api.stripe.com/v1/subscriptions/sub_2"]);
    expect(calls[0]).toContain(`metadata['teen_id']:'${user}'`);
  });

  it("fails loudly, so the deletion waits and tries again", async () => {
    const fetch = (async () => new Response(JSON.stringify({ error: { message: "down" } }), { status: 500 })) as Fetch;
    await expect(cancelSubscriptionsFor(fetch, "sk_test", user)).rejects.toThrow(/down/);
    await expect(cancelSubscriptionsFor(fetch, "sk_test", "x' OR 1")).rejects.toThrow(/account id/);
  });
});
