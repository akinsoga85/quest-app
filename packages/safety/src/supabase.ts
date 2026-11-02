import { ScanClaim } from "@quest/contract";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { scanMake, sweep, vendorsFromEnv, type ScanDb, type ScanDeps, type ScanStore } from "./scan";

export function supabaseScanDb(sb: SupabaseClient): ScanDb {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as unknown;
  };
  return {
    pending: async (limit) => (await rpc("scan_pending", { p_limit: limit })) as string[],
    claim: async (makeId) => ScanClaim.parse(await rpc("scan_claim", { p_make_id: makeId })),
    save: async (makeId, result, reasons, vendor) =>
      (await rpc("scan_save", { p_make_id: makeId, p_result: result, p_reasons: reasons, p_vendor: vendor })) as string,
  };
}

export function supabaseScanStore(sb: SupabaseClient): ScanStore {
  return {
    async read(path) {
      const { data, error } = await sb.storage.from("makes").download(path);
      if (error || !data) throw new Error(`couldn't read the photo: ${error?.message ?? "missing"}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async replace(path, bytes) {
      const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const { error } = await sb.storage.from("makes").upload(path, body, { contentType: "image/jpeg", upsert: true });
      if (error) throw new Error(`couldn't replace the photo: ${error.message}`);
    },
  };
}

export function scanDepsFromEnv(env: Record<string, string | undefined>): ScanDeps {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return { db: supabaseScanDb(sb), store: supabaseScanStore(sb), ...vendorsFromEnv(env), log: (e) => console.log(JSON.stringify({ safety: e })) };
}

// The edge function's handler (supabase/functions/safety-scan): a database
// webhook on new makes, plus a schedule that sweeps anything missed.
export async function handleScanRequest(req: Request, env: Record<string, string | undefined>, deps?: ScanDeps): Promise<Response> {
  const secret = env.SAFETY_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-safety-secret") !== secret) return new Response("forbidden", { status: 403 });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  let d: ScanDeps;
  try {
    d = deps ?? scanDepsFromEnv(env);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "not configured", { status: 503 });
  }
  const body = (await req.json().catch(() => ({}))) as { makeId?: unknown; record?: { id?: unknown; status?: unknown } };
  const makeId = typeof body.makeId === "string" ? body.makeId : typeof body.record?.id === "string" && body.record.status === "uploaded" ? body.record.id : null;
  const results = makeId ? { [makeId]: await scanMake(makeId, d) } : await sweep(d);
  return Response.json({ results });
}

// For the bundle's smoke test.
export { exactHashMatcher, passingClassifier, sha256Hex } from "./scan";
