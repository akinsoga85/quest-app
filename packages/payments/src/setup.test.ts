import { PLUS } from "@quest/contract";
import { describe, expect, it } from "vitest";
import { STRIPE_EVENTS, STRIPE_LOOKUP, setupStripe } from "./setup";
import type { Fetch } from "./stripe";

// A small in-memory Stripe: just the endpoints the setup uses.
function fakeStripe() {
  const db = { products: [] as Record<string, unknown>[], prices: [] as Record<string, unknown>[], portals: [] as Record<string, unknown>[], hooks: [] as Record<string, unknown>[] };
  const posts: { path: string; form: Record<string, string> }[] = [];
  let n = 0;
  const metadata = (f: Record<string, string>) => Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith("metadata[")).map(([k, v]) => [k.slice(9, -1), v]));
  const list = (prefix: string, f: Record<string, string>) => Object.entries(f).filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
  const fetch: Fetch = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace("/v1/", "");
    const form = Object.fromEntries(new URLSearchParams(init.body ?? ""));
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (init.method === "GET") {
      if (path === "products") return ok({ data: db.products });
      if (path === "prices") {
        const keys = [...u.searchParams.entries()].filter(([k]) => k.startsWith("lookup_keys")).map(([, v]) => v);
        return ok({ data: db.prices.filter((p) => keys.includes(p.lookup_key as string)) });
      }
      if (path === "billing_portal/configurations") return ok({ data: db.portals });
      if (path === "webhook_endpoints") return ok({ data: db.hooks });
    }
    posts.push({ path, form });
    if (path === "products") {
      const p = { id: `prod_${++n}`, name: form.name, metadata: metadata(form) };
      db.products.push(p);
      return ok(p);
    }
    if (path === "prices") {
      if (form.transfer_lookup_key === "true") for (const p of db.prices) if (p.lookup_key === form.lookup_key) p.lookup_key = null;
      const p = { id: `price_${++n}`, product: form.product, lookup_key: form.lookup_key, unit_amount: Number(form.unit_amount), currency: form.currency, metadata: metadata(form) };
      db.prices.push(p);
      return ok(p);
    }
    if (path === "billing_portal/configurations") {
      const p = { id: `bpc_${++n}`, metadata: metadata(form) };
      db.portals.push(p);
      return ok(p);
    }
    if (path === "webhook_endpoints") {
      const h = { id: `we_${++n}`, url: form.url, enabled_events: list("enabled_events", form), secret: `whsec_${n}`, metadata: metadata(form) };
      db.hooks.push({ ...h, secret: undefined });
      return ok(h);
    }
    if (path.startsWith("webhook_endpoints/")) {
      const h = db.hooks.find((x) => path.endsWith(x.id as string))!;
      h.enabled_events = list("enabled_events", form);
      return ok(h);
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: `no fake for ${path}` } }) };
  };
  return { fetch, db, posts };
}

const opts = { webhookUrl: "https://ref.supabase.co/functions/v1/payments/webhook", returnUrl: "https://parents.example.com", privacyUrl: "https://example.com/privacy" };

describe("setting up Stripe for Plus", () => {
  it("creates the product, both prices from the contract, the portal and the webhook", async () => {
    const s = fakeStripe();
    const r = await setupStripe(s.fetch, "sk_test_x", opts);
    expect(r.live).toBe(false);
    expect(r.created).toHaveLength(5);
    const plus = s.db.prices.find((p) => p.id === r.pricePlus)!;
    const extra = s.db.prices.find((p) => p.id === r.priceExtraTeen)!;
    expect([plus.unit_amount, plus.lookup_key, extra.unit_amount, extra.lookup_key]).toEqual([Math.round(PLUS.monthlyUsd * 100), STRIPE_LOOKUP.plus, Math.round(PLUS.extraTeenUsd * 100), STRIPE_LOOKUP.extraTeen]);
    const recurring = s.posts.filter((p) => p.path === "prices").map((p) => [p.form.currency, p.form["recurring[interval]"]]);
    expect(recurring).toEqual([["usd", "month"], ["usd", "month"]]);
    // Parents cancel at the end of the month they've paid for.
    const portal = s.posts.find((p) => p.path === "billing_portal/configurations")!.form;
    expect([portal["features[subscription_cancel][mode]"], portal.default_return_url, portal["business_profile[privacy_policy_url]"]]).toEqual(["at_period_end", opts.returnUrl, opts.privacyUrl]);
    // The webhook sends exactly what fromStripe reads, and its secret is handed back once.
    expect(s.db.hooks[0]!.enabled_events).toEqual([...STRIPE_EVENTS]);
    expect(r.webhook).toMatchObject({ created: true, secret: expect.stringMatching(/^whsec_/) });
  });

  it("is safe to run again: nothing new, and no secret it can't know", async () => {
    const s = fakeStripe();
    const first = await setupStripe(s.fetch, "sk_test_x", opts);
    const again = await setupStripe(s.fetch, "sk_test_x", opts);
    expect(again.created).toEqual([]);
    expect([again.pricePlus, again.priceExtraTeen, again.portalConfiguration, again.webhook.id]).toEqual([first.pricePlus, first.priceExtraTeen, first.portalConfiguration, first.webhook.id]);
    expect(again.webhook).toMatchObject({ created: false, secret: null });
  });

  it("makes a new price when the contract's price changes, and fixes a webhook missing events", async () => {
    const s = fakeStripe();
    const first = await setupStripe(s.fetch, "sk_live_x", opts);
    expect(first.live).toBe(true);
    s.db.prices.find((p) => p.id === first.pricePlus)!.unit_amount = 499; // as if the price was 4.99 before
    s.db.hooks[0]!.enabled_events = ["checkout.session.completed"];
    const again = await setupStripe(s.fetch, "sk_live_x", opts);
    expect(again.pricePlus).not.toBe(first.pricePlus);
    expect(again.priceExtraTeen).toBe(first.priceExtraTeen);
    expect(s.posts.at(-2)!.form.transfer_lookup_key).toBe("true");
    expect(s.db.hooks[0]!.enabled_events).toEqual([...STRIPE_EVENTS]);
  });

  it("stops with Stripe's own message when something's wrong", async () => {
    const fetch: Fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "Invalid API Key provided" } }) });
    await expect(setupStripe(fetch, "sk_test_bad", opts)).rejects.toThrow(/Invalid API Key/);
  });
});
