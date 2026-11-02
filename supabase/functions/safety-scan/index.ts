// The child-safety scan (A5) as a Supabase edge function. The code lives in
// packages/safety; `npm run build:functions` bundles it into scan.bundle.mjs
// next to this file before `supabase functions deploy safety-scan`.
//
// Secrets: SAFETY_WEBHOOK_SECRET and the vendor settings (SAFETY_VENDORS; see
// README). With no vendors set up it answers 503 and scans nothing, so
// nothing reaches the coach.
// @ts-expect-error: the bundle is generated and not type-checked here
import { handleScanRequest } from "./scan.bundle.mjs";

declare const Deno: { serve(handler: (req: Request) => Promise<Response>): void; env: { toObject(): Record<string, string> } };

Deno.serve((req: Request) => handleScanRequest(req, Deno.env.toObject()));
