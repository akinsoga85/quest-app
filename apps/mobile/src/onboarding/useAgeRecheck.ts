import { AGE_RECHECK_MONTHS, AgeBracket } from "@quest/contract";
import { useEffect } from "react";
import { useAccount } from "../lib/account";
import { supabase } from "../lib/supabase";
import { getStoreAgeSignal } from "./ageSignal";
import { recheckDue } from "./ageSignalLogic";

// Every 6 months, a teen placed by their app store's age range is asked again
// (the store shows its own sheet). The server only ever moves them up, one
// group at a time. Anything else (not shared, not supported) changes nothing.
export function useAgeRecheck() {
  const { teen, refresh } = useAccount();
  useEffect(() => {
    if (!teen || !recheckDue(teen.ageSource, teen.ageCheckedAt, new Date(), AGE_RECHECK_MONTHS)) return;
    void (async () => {
      const r = await getStoreAgeSignal();
      const bracket = r.kind === "verdict" ? AgeBracket.safeParse(r.verdict).data : undefined;
      if (!bracket) return;
      const { data } = await supabase.rpc("confirm_age_group", { p_age_bracket: bracket });
      if ((data as { moved?: boolean } | null)?.moved) await refresh();
    })();
    // Once per sign-in: the server records the check, so it isn't asked again for 6 months.
  }, [teen?.id]);
}
