import { Api } from "@quest/contract";
import { createClient } from "@supabase/supabase-js";
import { handlePayments, type PaymentsDeps } from "./handler";

export function paymentsDepsFromEnv(env: Record<string, string | undefined>): PaymentsDeps {
  const url = env.SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = env.SUPABASE_ANON_KEY;
  if (!url || !service || !anon) throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY must be set");
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as unknown;
  };
  return {
    apply: async (e) => (await rpc("apply_entitlement_event", { p_event_id: e.eventId, p_teen_id: e.teenId, p_source: e.source, p_kind: e.kind, p_active_until: e.activeUntil, p_sandbox: e.sandbox })) as string,
    saveCustomer: async (parentId, customerId) => {
      await rpc("save_billing_customer", { p_parent_id: parentId, p_customer_id: customerId });
    },
    customerFor: async (parentId) => ((await rpc("billing_customer_for", { p_parent_id: parentId })) as string | null) ?? null,
    // The parent's own session decides which teens are theirs.
    parentFromJwt: async (jwt) => {
      const asParent = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } });
      const { data: user } = await asParent.auth.getUser(jwt);
      if (!user.user) return null;
      const { data } = await asParent.rpc("parent_overview");
      const overview = Api["parent.overview"].output.safeParse(data);
      return { id: user.user.id, email: user.user.email ?? null, teenIds: overview.success ? overview.data.teens.map((t) => t.teenId) : [] };
    },
    fetch: (u, init) => fetch(u, init),
    now: () => Date.now(),
  };
}

export async function handlePaymentsRequest(req: Request, env: Record<string, string | undefined>, deps?: PaymentsDeps): Promise<Response> {
  let d = deps;
  if (!d) {
    try {
      d = paymentsDepsFromEnv(env);
    } catch (e) {
      return new Response(e instanceof Error ? e.message : "not configured", { status: 503 });
    }
  }
  return handlePayments(req, env, d);
}
