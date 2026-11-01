import { createClient } from "@supabase/supabase-js";
import { Candidate, expoPush, runDrops, type DropDeps } from "./drop";

export function dropDepsFromEnv(env: Record<string, string | undefined>): DropDeps {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as unknown;
  };
  return {
    candidates: async (now) => Candidate.array().parse(await rpc("drop_candidates", { p_now: now.toISOString() })),
    record: async (teenId, day, pushed) => (await rpc("record_drop", { p_teen: teenId, p_day: day, p_pushed: pushed })) as boolean,
    push: (messages) => expoPush(fetch, messages, env.EXPO_ACCESS_TOKEN),
    removeToken: async (token) => {
      await rpc("remove_push_token", { p_token: token });
    },
    now: () => new Date(),
  };
}

// The edge function's handler (supabase/functions/evening-drop), run every 10
// minutes by a schedule.
export async function handleDropRequest(req: Request, env: Record<string, string | undefined>, deps?: DropDeps): Promise<Response> {
  const secret = env.DROP_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-drop-secret") !== secret) return new Response("forbidden", { status: 403 });
  let d = deps;
  if (!d) {
    try {
      d = dropDepsFromEnv(env);
    } catch (e) {
      return new Response(e instanceof Error ? e.message : "not configured", { status: 503 });
    }
  }
  return Response.json(await runDrops(d));
}
