import { PLUS } from "@quest/contract";
import type { Fetch } from "./stripe";

// Sets up RevenueCat for Plus in the app, through its REST API v2: the `plus`
// entitlement the app checks, the monthly product in each store, the
// `default` offering with its monthly package, and (optionally) the webhook
// to the payments function. Run by scripts/setup-revenuecat.mjs. Safe to run
// again: it finds what's there by lookup key or store identifier and only
// creates what's missing. Prices aren't set here: they live in each store.
//
// The apps themselves (App Store and Play Store, with their store
// credentials) are added in the RevenueCat dashboard first.

export const REVENUECAT = {
  entitlement: PLUS.entitlement, // "plus": what the app looks for
  offering: "default",
  package: "$rc_monthly", // RevenueCat's standard monthly package
  appStoreProduct: "quest_plus_monthly",
  playStoreProduct: "quest_plus:monthly", // subscription id : base plan id
  subscriptionGroup: "Plus",
} as const;

export interface RevenueCatSetupOptions {
  projectId?: string; // found automatically when the key sees one project
  webhook?: { url: string; secret: string }; // https://<project>.supabase.co/functions/v1/payments/webhook
  pushToAppStore?: boolean; // also create the subscription in App Store Connect (no price yet)
}

export interface RevenueCatSetupResult {
  projectId: string;
  apps: { appStore: string | null; playStore: string | null };
  entitlementId: string;
  productIds: string[];
  offeringId: string;
  packageId: string;
  webhook: { id: string; created: boolean } | null;
  publicKeys: { ios: string | null; android: string | null };
  created: string[]; // what this run made or changed, for the log
  todo: string[]; // what still needs doing by hand
}

type Item = { id: string; [k: string]: unknown };

export async function setupRevenueCat(fetch: Fetch, apiKey: string, o: RevenueCatSetupOptions = {}): Promise<RevenueCatSetupResult> {
  const call = async <T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> => {
    const url = path.startsWith("/v2/") ? `https://api.revenuecat.com${path}` : `https://api.revenuecat.com/v2${path}`;
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T & { message?: string; type?: string };
    if (!res.ok) throw Object.assign(new Error(`RevenueCat ${method} ${path}: ${json.message ?? res.status}`), { status: res.status, type: json.type });
    return json;
  };
  // Every list page, following next_page.
  const all = async <T extends Item>(path: string): Promise<T[]> => {
    const items: T[] = [];
    let next: string | undefined = `${path}${path.includes("?") ? "&" : "?"}limit=100`;
    for (let page = 0; next && page < 50; page++) {
      const r: { items: T[]; next_page?: string } = await call("GET", next);
      items.push(...r.items);
      next = r.next_page;
    }
    return items;
  };
  const created: string[] = [];
  const todo: string[] = [];
  const active = (x: Item) => x.state === undefined || x.state === "active";

  // The project.
  let projectId = o.projectId;
  if (!projectId) {
    const projects = await all<Item & { name: string }>("/projects");
    if (projects.length !== 1) throw new Error(`This key sees ${projects.length} projects: set RC_PROJECT_ID to the Quest one.`);
    projectId = projects[0]!.id;
  }
  const p = `/projects/${projectId}`;

  // The apps, added in the dashboard with their store credentials.
  const apps = await all<Item & { type: string; name: string }>(`${p}/apps`);
  const appStore = apps.find((a) => a.type === "app_store") ?? null;
  const playStore = apps.find((a) => a.type === "play_store") ?? null;
  if (!appStore && !playStore) throw new Error("Add the App Store and Play Store apps in the RevenueCat dashboard first (docs/payments-setup.md).");
  if (!appStore) todo.push("Add the App Store app in RevenueCat, then run this again.");
  if (!playStore) todo.push("Add the Play Store app in RevenueCat, then run this again.");

  // The entitlement the app checks.
  const entitlements = await all<Item & { lookup_key: string }>(`${p}/entitlements`);
  let entitlement = entitlements.find((e) => e.lookup_key === REVENUECAT.entitlement && active(e));
  if (!entitlement) {
    entitlement = await call<Item & { lookup_key: string }>("POST", `${p}/entitlements`, { lookup_key: REVENUECAT.entitlement, display_name: "Quest Plus" });
    created.push(`entitlement ${REVENUECAT.entitlement}`);
  }

  // The monthly product in each store.
  const products = await all<Item & { store_identifier: string; app_id: string }>(`${p}/products`);
  const wanted = [
    ...(appStore ? [{ app: appStore, store: REVENUECAT.appStoreProduct }] : []),
    ...(playStore ? [{ app: playStore, store: REVENUECAT.playStoreProduct }] : []),
  ];
  const productIds: string[] = [];
  for (const w of wanted) {
    let product = products.find((x) => x.app_id === w.app.id && x.store_identifier === w.store && active(x));
    if (!product) {
      product = await call<Item & { store_identifier: string; app_id: string }>("POST", `${p}/products`, {
        store_identifier: w.store,
        app_id: w.app.id,
        type: "subscription",
        display_name: "Quest Plus (monthly)",
      });
      created.push(`product ${w.store} (${w.app.type === "app_store" ? "App Store" : "Play Store"})`);
      if (w.app.type === "app_store" && o.pushToAppStore) {
        // Creates the subscription in App Store Connect. Its price is set there later.
        try {
          await call("POST", `${p}/products/${product.id}/create_in_store`, {
            store_information: { duration: "ONE_MONTH", subscription_group_name: REVENUECAT.subscriptionGroup },
          });
          created.push(`App Store Connect subscription ${w.store} in group "${REVENUECAT.subscriptionGroup}" (no price yet)`);
        } catch (e) {
          if ((e as { status?: number }).status !== 409) throw e;
        }
      }
    }
    productIds.push(product.id);
  }
  if (playStore) todo.push(`In Google Play Console, create subscription "quest_plus" with base plan "monthly" (RevenueCat can't create Play subscriptions).`);
  if (appStore && !o.pushToAppStore) todo.push(`In App Store Connect, create subscription "${REVENUECAT.appStoreProduct}" in group "${REVENUECAT.subscriptionGroup}", or run this again with --push-to-app-store.`);
  todo.push("Set the subscription's price in each store when you've agreed on it.");

  // Both products unlock the entitlement.
  const onEntitlement = new Set((await all<Item>(`${p}/entitlements/${entitlement.id}/products`)).map((x) => x.id));
  const toEntitlement = productIds.filter((id) => !onEntitlement.has(id));
  if (toEntitlement.length) {
    await call("POST", `${p}/entitlements/${entitlement.id}/actions/attach_products`, { product_ids: toEntitlement });
    created.push(`${toEntitlement.length} product(s) attached to ${REVENUECAT.entitlement}`);
  }

  // The offering the app shows, set as current.
  const offerings = await all<Item & { lookup_key: string; is_current: boolean }>(`${p}/offerings`);
  let offering = offerings.find((x) => x.lookup_key === REVENUECAT.offering && active(x));
  if (!offering) {
    offering = await call<Item & { lookup_key: string; is_current: boolean }>("POST", `${p}/offerings`, { lookup_key: REVENUECAT.offering, display_name: "Quest Plus" });
    created.push(`offering ${REVENUECAT.offering}`);
  }
  if (!offering.is_current) {
    await call("POST", `${p}/offerings/${offering.id}`, { is_current: true });
    created.push(`offering ${REVENUECAT.offering} set as current`);
  }

  // Its monthly package, holding both products.
  const packages = await all<Item & { lookup_key: string }>(`${p}/offerings/${offering.id}/packages`);
  let pkg = packages.find((x) => x.lookup_key === REVENUECAT.package);
  if (!pkg) {
    pkg = await call<Item & { lookup_key: string }>("POST", `${p}/offerings/${offering.id}/packages`, { lookup_key: REVENUECAT.package, display_name: "Monthly", position: 1 });
    created.push(`package ${REVENUECAT.package}`);
  }
  const inPackage = new Set((await all<{ id: string; product: Item }>(`${p}/packages/${pkg.id}/products`)).map((x) => x.product.id));
  const toPackage = productIds.filter((id) => !inPackage.has(id));
  if (toPackage.length) {
    await call("POST", `${p}/packages/${pkg.id}/actions/attach_products`, { products: toPackage.map((product_id) => ({ product_id, eligibility_criteria: "all" })) });
    created.push(`${toPackage.length} product(s) attached to the monthly package`);
  }

  // The webhook to the payments function, with the shared secret it checks.
  let webhook: RevenueCatSetupResult["webhook"] = null;
  if (o.webhook) {
    const hooks = await all<Item & { url: string }>(`${p}/integrations/webhooks`);
    const hook = hooks.find((h) => h.url === o.webhook!.url);
    if (hook) webhook = { id: hook.id, created: false };
    else {
      const h = await call<Item>("POST", `${p}/integrations/webhooks`, {
        name: "Quest payments function",
        url: o.webhook.url,
        authorization_header: `Bearer ${o.webhook.secret}`,
      });
      created.push("webhook to the payments function");
      webhook = { id: h.id, created: true };
    }
  } else {
    todo.push("Add the webhook once the Supabase project exists: run this again with PROJECT_REF and REVENUECAT_WEBHOOK_SECRET.");
  }

  // The public SDK keys the app is built with.
  const keyFor = async (app: Item | null) => {
    if (!app) return null;
    const keys = await all<Item & { key: string; environment: string }>(`${p}/apps/${app.id}/public_api_keys`);
    return (keys.find((k) => k.environment === "production") ?? keys[0])?.key ?? null;
  };
  const publicKeys = { ios: await keyFor(appStore), android: await keyFor(playStore) };

  return {
    projectId,
    apps: { appStore: appStore?.id ?? null, playStore: playStore?.id ?? null },
    entitlementId: entitlement.id,
    productIds,
    offeringId: offering.id,
    packageId: pkg.id,
    webhook,
    publicKeys,
    created,
    todo,
  };
}
