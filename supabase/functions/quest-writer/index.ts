// The quest writer agent (A6) as a Supabase edge function, run weekly by a
// schedule. The code lives in packages/quests; `npm run build:functions`
// bundles it into writer.bundle.mjs next to this file before
// `supabase functions deploy quest-writer`.
//
// Secrets: ANTHROPIC_API_KEY, QUESTS_WEBHOOK_SECRET, optionally QUESTS_MODEL.
// Drafted weeks wait in the admin (A11) for a person to approve them.
// @ts-expect-error: the bundle is generated and not type-checked here
import { handleWriterRequest } from "./writer.bundle.mjs";

declare const Deno: { serve(handler: (req: Request) => Promise<Response>): void; env: { toObject(): Record<string, string> } };

Deno.serve((req: Request) => handleWriterRequest(req, Deno.env.toObject()));
