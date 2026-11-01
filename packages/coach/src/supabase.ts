import Anthropic from "@anthropic-ai/sdk";
import { CoachClaim } from "@quest/contract";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { claudeCoach, modelsFromEnv } from "./claude";
import { reviewMake, sweep, type CoachDb, type PhotoStore, type WorkerDeps } from "./worker";

// The coach's real database and storage: Supabase with the service role key,
// on the server only. Never shipped in the app.
export function supabaseDb(sb: SupabaseClient): CoachDb {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as unknown;
  };
  return {
    pending: async (limit) => (await rpc("coach_pending", { p_limit: limit })) as string[],
    claim: async (makeId) => CoachClaim.parse(await rpc("coach_claim", { p_make_id: makeId })),
    saveReview: async (makeId, review, model, promptVersion) =>
      (await rpc("coach_save_review", { p_make_id: makeId, p_review: review, p_model: model, p_prompt_version: promptVersion })) as string,
    saveOutcome: async (makeId, outcome, note, lessonId, model) => {
      await rpc("coach_save_outcome", { p_make_id: makeId, p_outcome: outcome, p_note: note, p_lesson_id: lessonId, p_model: model });
    },
  };
}

export function supabasePhotos(sb: SupabaseClient): PhotoStore {
  return {
    async read(path) {
      const { data, error } = await sb.storage.from("makes").download(path);
      if (error || !data) throw new Error(`couldn't read the photo: ${error?.message ?? "missing"}`);
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

export function depsFromEnv(env: Record<string, string | undefined>): WorkerDeps {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    db: supabaseDb(sb),
    photos: supabasePhotos(sb),
    llm: claudeCoach(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }), modelsFromEnv(env)),
    log: (e) => console.log(JSON.stringify({ coach: e })),
  };
}

// The edge function's handler (supabase/functions/coach-review). Called by a
// database webhook when a make is ready for the coach, and on a schedule to
// pick up anything missed. Only callers with the shared secret get in.
export async function handleCoachRequest(req: Request, env: Record<string, string | undefined>, deps?: WorkerDeps): Promise<Response> {
  const secret = env.COACH_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-coach-secret") !== secret) return new Response("forbidden", { status: 403 });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const body = (await req.json().catch(() => ({}))) as { makeId?: unknown; record?: { id?: unknown; status?: unknown } };
  const d = deps ?? depsFromEnv(env);
  // A direct call ({ makeId }), a database webhook ({ record }), or a sweep ({}).
  const makeId = typeof body.makeId === "string" ? body.makeId : typeof body.record?.id === "string" && body.record.status === "reviewing" ? body.record.id : null;
  const results = makeId ? { [makeId]: await reviewMake(makeId, d) } : await sweep(d);
  return Response.json({ results });
}
