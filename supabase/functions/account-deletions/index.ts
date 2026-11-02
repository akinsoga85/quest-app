// The account deletion job (A11) as a Supabase edge function, run once a day
// by a schedule. The code lives in packages/ops; `npm run build:functions`
// bundles it into deletions.bundle.mjs next to this file before
// `supabase functions deploy account-deletions`.
//
// Secrets: DELETIONS_WEBHOOK_SECRET, and STRIPE_SECRET_KEY once Plus is sold
// on the web (to stop the subscriptions of deleted accounts).
// @ts-expect-error: the bundle is generated and not type-checked here
import { handleDeletionsRequest } from "./deletions.bundle.mjs";

declare const Deno: { serve(handler: (req: Request) => Promise<Response>): void; env: { toObject(): Record<string, string> } };

Deno.serve((req: Request) => handleDeletionsRequest(req, Deno.env.toObject()));
