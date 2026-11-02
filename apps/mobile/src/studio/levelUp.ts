import { Api } from "@quest/contract";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";

let open = false;

// After a review or on Today: if a level-up postcard is waiting, show it (H13).
export async function showLevelUpIfAny(): Promise<void> {
  if (open) return;
  const { data, error } = await supabase.rpc("get_new_postcards");
  const parsed = Api["postcards.new"].output.safeParse(data);
  if (error || !parsed.success || parsed.data.length === 0) return;
  open = true;
  router.push("/level-up");
}

export function levelUpClosed(): void {
  open = false;
}
