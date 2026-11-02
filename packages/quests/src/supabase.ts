import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { claudeWriter, draftMissingWeeks, type WeeksDb, type WriterLLM } from "./writer";

export function supabaseWeeksDb(sb: SupabaseClient): WeeksDb {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as unknown;
  };
  return {
    weeksToDraft: async (ahead) =>
      ((await rpc("weeks_to_draft", { p_ahead: ahead })) as { zone_id: string; week_of: string }[]).map((r) => ({ zone: r.zone_id, weekOf: r.week_of })),
    recentTitles: async (zone) => (await rpc("recent_quest_titles", { p_zone: zone })) as string[],
    saveWeek: async (week, model) => (await rpc("save_quest_week", { p_zone: week.zone, p_week_of: week.weekOf, p_quests: week.quests, p_model: model })) as string,
  };
}

// The edge function's handler (supabase/functions/quest-writer), run by a
// weekly schedule. Drafts wait in the admin for a person to approve them.
export async function handleWriterRequest(req: Request, env: Record<string, string | undefined>, deps?: { db: WeeksDb; llm: WriterLLM }): Promise<Response> {
  const secret = env.QUESTS_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-quests-secret") !== secret) return new Response("forbidden", { status: 403 });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  let d = deps;
  if (!d) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return new Response("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set", { status: 503 });
    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    d = { db: supabaseWeeksDb(sb), llm: claudeWriter(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }), env.QUESTS_MODEL || undefined) };
  }
  const body = (await req.json().catch(() => ({}))) as { ahead?: unknown };
  const ahead = typeof body.ahead === "number" ? body.ahead : 2;
  return Response.json({ results: await draftMissingWeeks(d.db, d.llm, ahead) });
}
