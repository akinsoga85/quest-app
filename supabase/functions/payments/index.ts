// Plus and payments (A9) as one Supabase edge function. The code lives in
// packages/payments; `npm run build:functions` bundles it into
// payments.bundle.mjs next to this file before `supabase functions deploy payments`.
//
//   POST /functions/v1/payments/webhook   RevenueCat (shared secret) and Stripe (signature)
//   POST /functions/v1/payments/checkout  a signed-in parent starts Plus for a linked teen
//   POST /functions/v1/payments/portal    a signed-in parent manages Plus on Stripe's page
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PLUS,
// REVENUECAT_WEBHOOK_SECRET, PARENT_SITE_URL. Supabase provides SUPABASE_URL,
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
// @ts-expect-error: the bundle is generated and not type-checked here
import { handlePaymentsRequest } from "./payments.bundle.mjs";

declare const Deno: { serve(handler: (req: Request) => Promise<Response>): void; env: { toObject(): Record<string, string> } };

Deno.serve((req: Request) => handlePaymentsRequest(req, Deno.env.toObject()));
