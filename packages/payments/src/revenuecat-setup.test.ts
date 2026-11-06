import { describe, expect, it } from "vitest";
import { REVENUECAT, setupRevenueCat } from "./revenuecat-setup";
import type { Fetch } from "./stripe";

// A small in-memory RevenueCat: the v2 endpoints the setup uses, with pages
// of two items so the setup has to follow next_page.
function fakeRevenueCat(appTypes: string[] = ["app_store", "play_store"], projects = 1) {
  let n = 0;
  const id = (prefix: string) => `${prefix}${++n}`;
  const db = {
    projects: Array.from({ length: projects }, (_, i) => ({ id: `proj${i + 1}`, name: `Project ${i + 1}` })),
    apps: appTypes.map((type) => ({ id: id("app"), type, name: type })),
    entitlements: [] as Record<string, unknown>[],
    products: [] as Record<string, unknown>[],
    offerings: [] as Record<string, unknown>[],
    packages: [] as Record<string, unknown>[],
    hooks: [] as Record<string, unknown>[],
    onEntitlement: new Map<string, string[]>(),
    inPackage: new Map<string, string[]>(),
    pushed: [] as Record<string, unknown>[],
  };
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  const page = (items: unknown[], url: URL) => {
    const after = url.searchParams.get("starting_after");
    const start = after ? items.findIndex((x) => (x as { id: string }).id === after) + 1 : 0;
    const slice = items.slice(start, start + 2);
    const more = start + 2 < items.length;
    return { object: "list", items: slice, ...(more ? { next_page: `${url.pathname}?starting_after=${(slice.at(-1) as { id: string }).id}` } : {}) };
  };
  const fetch: Fetch = async (raw, init) => {
    const url = new URL(raw);
    const path = url.pathname.replace("/v2", "").replace(/^\/projects\/proj1/, "");
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ method: init.method ?? "GET", path, body });
    const ok = (b: unknown, status = 200) => ({ ok: true, status, json: async () => b });
    if (init.headers.Authorization !== "Bearer sk_test") return { ok: false, status: 401, json: async () => ({ type: "authentication_error", message: "Invalid API key" }) };
    const get = init.method === "GET";
    let m: RegExpMatchArray | null;
    if (get && path === "/projects") return ok(page(db.projects, url));
    if (get && path === "/apps") return ok(page(db.apps, url));
    if (get && (m = path.match(/^\/apps\/(\w+)\/public_api_keys$/))) {
      const app = db.apps.find((a) => a.id === m![1])!;
      return ok(page([{ id: `key_${app.id}`, key: `${app.type === "app_store" ? "appl" : "goog"}_${app.id}`, environment: "production" }], url));
    }
    if (path === "/entitlements") {
      if (get) return ok(page(db.entitlements, url));
      const e = { id: id("entl"), state: "active", ...body };
      db.entitlements.push(e);
      return ok(e, 201);
    }
    if ((m = path.match(/^\/entitlements\/(\w+)\/products$/))) return ok(page((db.onEntitlement.get(m[1]!) ?? []).map((pid) => ({ id: pid })), url));
    if ((m = path.match(/^\/entitlements\/(\w+)\/actions\/attach_products$/))) {
      db.onEntitlement.set(m[1]!, [...(db.onEntitlement.get(m[1]!) ?? []), ...(body!.product_ids as string[])]);
      return ok({});
    }
    if (path === "/products") {
      if (get) return ok(page(db.products, url));
      const p = { id: id("prod"), state: "active", ...body };
      db.products.push(p);
      return ok(p, 201);
    }
    if ((m = path.match(/^\/products\/(\w+)\/create_in_store$/))) {
      db.pushed.push({ product: m[1], ...body });
      return ok({});
    }
    if (path === "/offerings") {
      if (get) return ok(page(db.offerings, url));
      const o = { id: id("ofrng"), state: "active", is_current: false, ...body };
      db.offerings.push(o);
      return ok(o, 201);
    }
    if ((m = path.match(/^\/offerings\/(\w+)$/))) {
      const o = db.offerings.find((x) => x.id === m![1])!;
      Object.assign(o, body);
      return ok(o);
    }
    if ((m = path.match(/^\/offerings\/(\w+)\/packages$/))) {
      if (get) return ok(page(db.packages.filter((x) => x.offering === m![1]), url));
      const p = { id: id("pkge"), offering: m[1], ...body };
      db.packages.push(p);
      return ok(p, 201);
    }
    if ((m = path.match(/^\/packages\/(\w+)\/products$/))) return ok(page((db.inPackage.get(m[1]!) ?? []).map((pid) => ({ id: `assoc_${pid}`, product: { id: pid } })), url));
    if ((m = path.match(/^\/packages\/(\w+)\/actions\/attach_products$/))) {
      const ids = (body!.products as { product_id: string }[]).map((x) => x.product_id);
      db.inPackage.set(m[1]!, [...(db.inPackage.get(m[1]!) ?? []), ...ids]);
      return ok({});
    }
    if (path === "/integrations/webhooks") {
      if (get) return ok(page(db.hooks, url));
      const h = { id: id("wh"), ...body };
      db.hooks.push(h);
      return ok(h, 201);
    }
    return { ok: false, status: 404, json: async () => ({ type: "resource_missing", message: `no fake for ${path}` }) };
  };
  return { fetch, db, calls };
}

const webhook = { url: "https://ref.supabase.co/functions/v1/payments/webhook", secret: "s3cret" };

describe("setting up RevenueCat for Plus", () => {
  it("creates the entitlement, both store products, the current default offering and its monthly package", async () => {
    const rc = fakeRevenueCat();
    const r = await setupRevenueCat(rc.fetch, "sk_test", { webhook });
    expect(r.projectId).toBe("proj1"); // the only project the key sees
    expect(rc.db.entitlements.map((e) => e.lookup_key)).toEqual([REVENUECAT.entitlement]);
    expect(rc.db.products.map((p) => [p.store_identifier, p.type])).toEqual([
      ["quest_plus_monthly", "subscription"],
      ["quest_plus:monthly", "subscription"],
    ]);
    // Each product sits on the app of its store.
    const [ios, android] = rc.db.apps;
    expect(rc.db.products.map((p) => p.app_id)).toEqual([ios!.id, android!.id]);
    expect(rc.db.onEntitlement.get(r.entitlementId)).toEqual(r.productIds);
    expect(rc.db.offerings).toMatchObject([{ lookup_key: "default", is_current: true }]);
    expect(rc.db.packages).toMatchObject([{ lookup_key: "$rc_monthly", position: 1 }]);
    expect(rc.db.inPackage.get(r.packageId)).toEqual(r.productIds);
    const attach = rc.calls.find((c) => c.path.endsWith("/actions/attach_products") && c.path.startsWith("/packages"))!;
    expect(attach.body).toEqual({ products: r.productIds.map((product_id) => ({ product_id, eligibility_criteria: "all" })) });
    // The webhook sends the secret the payments function checks.
    expect(rc.db.hooks).toMatchObject([{ url: webhook.url, authorization_header: "Bearer s3cret" }]);
    expect(r.publicKeys).toEqual({ ios: `appl_${ios!.id}`, android: `goog_${android!.id}` });
    // Nothing is pushed to App Store Connect unless asked, and no prices anywhere.
    expect(rc.db.pushed).toEqual([]);
    expect(JSON.stringify(rc.calls)).not.toMatch(/price/i);
    expect(r.todo.join(" ")).toMatch(/quest_plus.*monthly.*Play/);
  });

  it("is safe to run again: nothing new", async () => {
    const rc = fakeRevenueCat();
    const first = await setupRevenueCat(rc.fetch, "sk_test", { webhook });
    const before = rc.calls.length;
    const again = await setupRevenueCat(rc.fetch, "sk_test", { webhook });
    expect(again.created).toEqual([]);
    expect(rc.calls.slice(before).filter((c) => c.method === "POST")).toEqual([]); // reads only
    expect([again.entitlementId, again.productIds, again.offeringId, again.packageId, again.webhook]).toEqual([
      first.entitlementId,
      first.productIds,
      first.offeringId,
      first.packageId,
      { id: first.webhook!.id, created: false },
    ]);
    expect(rc.db.products).toHaveLength(2);
  });

  it("can create the subscription in App Store Connect, without a price", async () => {
    const rc = fakeRevenueCat();
    await setupRevenueCat(rc.fetch, "sk_test", { pushToAppStore: true });
    expect(rc.db.pushed).toEqual([{ product: rc.db.products[0]!.id, store_information: { duration: "ONE_MONTH", subscription_group_name: "Plus" } }]);
    expect(rc.db.hooks).toEqual([]); // no Supabase project yet: no webhook
  });

  it("works with one store, says what's missing, and stops clearly", async () => {
    const one = fakeRevenueCat(["app_store"]);
    const r = await setupRevenueCat(one.fetch, "sk_test", {});
    expect(r.apps.playStore).toBeNull();
    expect(r.productIds).toHaveLength(1);
    expect(r.todo.join(" ")).toMatch(/Add the Play Store app/);
    await expect(setupRevenueCat(fakeRevenueCat([]).fetch, "sk_test")).rejects.toThrow(/Add the App Store and Play Store apps/);
    await expect(setupRevenueCat(fakeRevenueCat(undefined, 2).fetch, "sk_test")).rejects.toThrow(/RC_PROJECT_ID/);
    await expect(setupRevenueCat(fakeRevenueCat().fetch, "sk_wrong")).rejects.toThrow(/Invalid API key/);
  });
});
