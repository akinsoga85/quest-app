import { fromRevenueCat, fromStripe, type EntitlementEvent } from "@quest/contract";
import { createCheckout, createPortal, verifyStripeSignature, type Fetch } from "./stripe";

// The `payments` edge function (A9), one URL per job:
//   POST …/payments/webhook   RevenueCat and Stripe webhooks (shared secret / signature)
//   POST …/payments/checkout  a signed-in parent starts Plus for a linked teen
//   POST …/payments/portal    a signed-in parent manages Plus on Stripe's page

export interface Parent {
  id: string;
  email: string | null;
  teenIds: string[]; // actively linked teens
  includedTeenIds: string[]; // of those, the 13–15s, who get Plus free
  webPlusTeenIds: string[]; // of those, the ones this parent already pays for here
}

export interface PaymentsDeps {
  apply(e: EntitlementEvent): Promise<string>;
  saveCustomer(parentId: string, customerId: string): Promise<void>;
  customerFor(parentId: string): Promise<string | null>;
  parentFromJwt(jwt: string): Promise<Parent | null>;
  fetch: Fetch;
  now(): number;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function handlePayments(req: Request, env: Record<string, string | undefined>, deps: PaymentsDeps): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  if (path.endsWith("/webhook")) return webhook(req, env, deps);
  if (path.endsWith("/checkout")) return checkout(req, env, deps);
  if (path.endsWith("/portal")) return portal(req, env, deps);
  return new Response("not found", { status: 404 });
}

async function webhook(req: Request, env: Record<string, string | undefined>, deps: PaymentsDeps): Promise<Response> {
  const raw = await req.text();
  const stripeSig = req.headers.get("stripe-signature");
  let event: EntitlementEvent | null;

  if (stripeSig !== null) {
    if (!(await verifyStripeSignature(raw, stripeSig, env.STRIPE_WEBHOOK_SECRET ?? "", Math.floor(deps.now() / 1000)))) {
      return new Response("bad signature", { status: 400 });
    }
    const body = JSON.parse(raw) as { type?: string; data?: { object?: { client_reference_id?: string; customer?: string } } };
    if (body.type === "checkout.session.completed") {
      const o = body.data?.object;
      if (o?.client_reference_id && typeof o.customer === "string") await deps.saveCustomer(o.client_reference_id, o.customer);
      return json({ received: true, applied: "customer_saved" });
    }
    event = fromStripe(body);
  } else {
    const secret = env.REVENUECAT_WEBHOOK_SECRET;
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
    event = fromRevenueCat(JSON.parse(raw));
  }
  // Events Plus doesn't care about are acknowledged, so the store stops resending them.
  if (!event) return json({ received: true, applied: "ignored" });
  return json({ received: true, applied: await deps.apply(event) });
}

async function signedInParent(req: Request, deps: PaymentsDeps): Promise<Parent | null> {
  const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return jwt ? deps.parentFromJwt(jwt) : null;
}

async function checkout(req: Request, env: Record<string, string | undefined>, deps: PaymentsDeps): Promise<Response> {
  const parent = await signedInParent(req, deps);
  if (!parent) return new Response("sign in first", { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { teenId?: unknown };
  // Under-18s can't buy: only a parent linked to this teen can.
  if (typeof body.teenId !== "string" || !parent.teenIds.includes(body.teenId)) return new Response("not your linked teen", { status: 403 });
  // 13–15s already have Plus, free: never charge for it.
  if (parent.includedTeenIds.includes(body.teenId)) return new Response("Plus is included free for 13–15s", { status: 409 });
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_PLUS || !env.PARENT_SITE_URL) return new Response("payments aren't set up", { status: 503 });
  const site = env.PARENT_SITE_URL.replace(/\/+$/, "");
  // Each teen after the first that this parent pays for is cheaper (PLUS.extraTeenUsd).
  const extraTeen = !!env.STRIPE_PRICE_PLUS_EXTRA && parent.webPlusTeenIds.some((id) => id !== body.teenId);
  const { url } = await createCheckout(deps.fetch, env.STRIPE_SECRET_KEY, {
    priceId: extraTeen ? env.STRIPE_PRICE_PLUS_EXTRA! : env.STRIPE_PRICE_PLUS,
    teenId: body.teenId,
    parentId: parent.id,
    parentEmail: parent.email,
    customerId: await deps.customerFor(parent.id),
    successUrl: `${site}/?plus=started`,
    cancelUrl: `${site}/`,
  });
  return json({ url });
}

async function portal(req: Request, env: Record<string, string | undefined>, deps: PaymentsDeps): Promise<Response> {
  const parent = await signedInParent(req, deps);
  if (!parent) return new Response("sign in first", { status: 401 });
  const customer = await deps.customerFor(parent.id);
  if (!customer) return new Response("no Plus to manage yet", { status: 404 });
  if (!env.STRIPE_SECRET_KEY || !env.PARENT_SITE_URL) return new Response("payments aren't set up", { status: 503 });
  return json(await createPortal(deps.fetch, env.STRIPE_SECRET_KEY, customer, env.PARENT_SITE_URL, env.STRIPE_PORTAL_CONFIGURATION || undefined));
}
