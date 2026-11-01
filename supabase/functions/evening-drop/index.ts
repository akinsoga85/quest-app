// The evening drop (A10) as a Supabase edge function, run every 10 minutes by
// a schedule. The code lives in packages/notify; `npm run build:functions`
// bundles it into drop.bundle.mjs next to this file before
// `supabase functions deploy evening-drop`.
//
// Secrets: DROP_WEBHOOK_SECRET, and optionally EXPO_ACCESS_TOKEN (if push
// security is turned on in Expo).
// @ts-expect-error: the bundle is generated and not type-checked here
import { handleDropRequest } from "./drop.bundle.mjs";

declare const Deno: { serve(handler: (req: Request) => Promise<Response>): void; env: { toObject(): Record<string, string> } };

Deno.serve((req: Request) => handleDropRequest(req, Deno.env.toObject()));
