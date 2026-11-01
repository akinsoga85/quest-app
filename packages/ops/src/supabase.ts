import { cancelSubscriptionsFor } from "@quest/payments";
import { createClient } from "@supabase/supabase-js";
import { DueDeletion, runDaily, type DailyDeps } from "./deletions";

export function deletionDepsFromEnv(env: Record<string, string | undefined>): DailyDeps {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as unknown;
  };
  const stripeKey = env.STRIPE_SECRET_KEY;
  return {
    advanceAgeGroups: async (now) => (await rpc("advance_age_groups", { p_today: now.toISOString().slice(0, 10) })) as number,
    due: async (now) => DueDeletion.array().parse(await rpc("deletions_due", { p_now: now.toISOString() })),
    // Without a Stripe key nobody could have bought Plus on the web.
    cancelBilling: (userId) => (stripeKey ? cancelSubscriptionsFor(fetch, stripeKey, userId) : Promise.resolve(0)),
    listFolder: async (folder) => {
      const { data, error } = await sb.storage.from("makes").list(folder, { limit: 100 });
      if (error) throw new Error(`list ${folder}: ${error.message}`);
      return (data ?? []).map((f) => `${folder}/${f.name}`);
    },
    removeFiles: async (paths) => {
      const { error } = await sb.storage.from("makes").remove(paths);
      if (error) throw new Error(`remove: ${error.message}`);
    },
    complete: async (userId) => {
      await rpc("complete_deletion", { p_user: userId });
    },
    now: () => new Date(),
  };
}

// The edge function's handler (supabase/functions/account-deletions), run daily.
export async function handleDeletionsRequest(req: Request, env: Record<string, string | undefined>, deps?: DailyDeps): Promise<Response> {
  const secret = env.DELETIONS_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-deletions-secret") !== secret) return new Response("forbidden", { status: 403 });
  let d = deps;
  if (!d) {
    try {
      d = deletionDepsFromEnv(env);
    } catch (e) {
      return new Response(e instanceof Error ? e.message : "not configured", { status: 503 });
    }
  }
  const run = await runDaily(d);
  return Response.json(run, { status: run.failed.length ? 500 : 200 });
}
