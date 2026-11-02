import { Api, localDay, type Today } from "@quest/contract";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAccount } from "../lib/account";
import { supabase } from "../lib/supabase";
import { deviceTimeZone } from "../lib/timezone";

interface TodayValue {
  today: Today | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const TodayContext = createContext<TodayValue | null>(null);

async function fetchToday(): Promise<Today> {
  const { data, error } = await supabase.rpc("get_today");
  if (error) throw error;
  return Api["today.get"].output.parse(data);
}

function safeLocalDay(at: Date, tz: string): string | null {
  try {
    return localDay(at, tz);
  } catch {
    return null;
  }
}

// Today's quests, week and streak from the server (`today.get`), by the teen's
// own clock. It reloads when the app comes back to the front, and when the
// phone passes local midnight, so a new quest appears without a restart.
export function TodayProvider({ children }: { children: React.ReactNode }) {
  const { teen, step, zones } = useAccount();
  const teenId = step === "done" ? (teen?.id ?? null) : null;
  const [today, setToday] = useState<Today | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0); // only the newest request's answer is shown

  const refresh = useCallback(async () => {
    if (!teenId) return;
    const mine = ++latest.current;
    setLoading(true);
    try {
      let t = await fetchToday();
      // Travelling: move the teen's day to where the phone is now. Makes
      // already made keep their day.
      const tz = deviceTimeZone();
      if (t.timezone !== tz) {
        const { error: tzError } = await supabase.from("teens").update({ timezone: tz }).eq("id", teenId);
        if (!tzError) t = await fetchToday();
      }
      if (mine === latest.current) {
        setToday(t);
        setError(null);
      }
    } catch {
      if (mine === latest.current) setError("Couldn't load today's quests. Check your connection and try again.");
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [teenId]);

  // Reload on sign-in and whenever the picked zones change.
  const zoneKey = zones.join(",");
  useEffect(() => {
    if (!teenId) {
      setToday(null);
      return;
    }
    void refresh();
  }, [teenId, zoneKey, refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // Once a minute, check whether the phone's local day has moved on.
  const tz = today?.timezone;
  useEffect(() => {
    if (!tz) return;
    let last = safeLocalDay(new Date(), tz);
    const id = setInterval(() => {
      const now = safeLocalDay(new Date(), tz);
      if (now !== last) {
        last = now;
        void refresh();
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [tz, refresh]);

  const value = useMemo(() => ({ today, loading, error, refresh }), [today, loading, error, refresh]);
  return <TodayContext.Provider value={value}>{children}</TodayContext.Provider>;
}

export function useToday(): TodayValue {
  const v = useContext(TodayContext);
  if (!v) throw new Error("useToday must be used inside TodayProvider");
  return v;
}
