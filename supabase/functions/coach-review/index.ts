// The coach agent (A4) as a Supabase edge function. The code lives in
// packages/coach; `npm run build:functions` bundles it into coach.bundle.mjs
// next to this file before `supabase functions deploy coach-review`.
//
// Secrets (supabase secrets set ...): ANTHROPIC_API_KEY, COACH_WEBHOOK_SECRET,
// and optionally COACH_MODEL, COACH_GUARD_MODEL, COACH_EFFORT.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
// @ts-expect-error: the bundle is generated and not type-checked here
import { handleCoachRequest } from "./coach.bundle.mjs";

declare const Deno: { serve(handler: (req: Request) => Promise<Response>): void; env: { toObject(): Record<string, string> } };

Deno.serve((req: Request) => handleCoachRequest(req, Deno.env.toObject()));
