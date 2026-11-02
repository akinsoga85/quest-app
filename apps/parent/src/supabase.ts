import type { Database } from "@quest/contract";
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);

// PKCE sign-in, kept in this browser only (no third-party cookies, no ads).
export const supabase = createClient<Database>(url || "http://localhost:54321", key || "public-anon-key", {
  auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
