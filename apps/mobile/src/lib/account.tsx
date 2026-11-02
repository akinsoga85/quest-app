import { ZONES, type AgeBracket, type AppMode, type ZoneId } from "@quest/contract";
import type { Session } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { onboardingStep, type OnboardingStep } from "../onboarding/flow";
import { supabase, supabaseConfigured } from "./supabase";

export interface Teen {
  id: string;
  handle: string;
  ageBracket: AgeBracket;
  mode: AppMode;
  aiCoachConsent: boolean;
  country: string; // two-letter code, for the right helplines
}

export interface ParentLink {
  status: "pending" | "active" | "revoked";
  inviteExpiresAt: string | null;
  createdAt: string;
}

interface AccountValue {
  session: Session | null;
  teen: Teen | null;
  parentLinks: ParentLink[];
  zones: ZoneId[]; // picked zones, in zone order
  step: OnboardingStep;
  refresh: () => Promise<void>;
  setWaitingForParent: (waiting: boolean) => Promise<void>;
}

const AccountContext = createContext<AccountValue | null>(null);

const waitingKey = (userId: string) => `waiting-for-parent.${userId}`;

// Signed-in user, their teen profile and parent links, and where onboarding is.
export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(!supabaseConfigured);
  const [teen, setTeen] = useState<Teen | null>(null);
  const [parentLinks, setParentLinks] = useState<ParentLink[]>([]);
  const [zones, setZones] = useState<ZoneId[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  const refresh = useCallback(async () => {
    if (!userId) {
      setTeen(null);
      setParentLinks([]);
      setZones([]);
      setWaiting(false);
      setProfileLoaded(true);
      return;
    }
    const [teenRes, linksRes, zonesRes, waitingValue] = await Promise.all([
      supabase.from("teens").select("id, handle, age_bracket, mode, ai_coach_consent, country").eq("id", userId).maybeSingle(),
      supabase.from("parent_links").select("status, invite_expires_at, created_at").eq("teen_id", userId).order("created_at", { ascending: false }),
      supabase.from("teen_zones").select("zone_id").eq("teen_id", userId),
      SecureStore.getItemAsync(waitingKey(userId)),
    ]);
    const t = teenRes.data;
    setTeen(t ? { id: t.id, handle: t.handle, ageBracket: t.age_bracket, mode: t.mode, aiCoachConsent: t.ai_coach_consent, country: t.country } : null);
    setParentLinks((linksRes.data ?? []).map((l) => ({ status: l.status, inviteExpiresAt: l.invite_expires_at, createdAt: l.created_at })));
    const picked = new Set((zonesRes.data ?? []).map((z) => z.zone_id));
    setZones((Object.keys(ZONES) as ZoneId[]).filter((z) => picked.has(z)));
    setWaiting(waitingValue === "1");
    setProfileLoaded(true);
  }, [userId]);

  useEffect(() => {
    setProfileLoaded(false);
    void refresh();
  }, [refresh]);

  const setWaitingForParent = useCallback(
    async (value: boolean) => {
      if (!userId) return;
      if (value) await SecureStore.setItemAsync(waitingKey(userId), "1");
      else await SecureStore.deleteItemAsync(waitingKey(userId));
      setWaiting(value);
    },
    [userId],
  );

  const step = onboardingStep({
    loading: !sessionLoaded || (userId !== null && !profileLoaded),
    signedIn: userId !== null,
    teen,
    parentLinked: parentLinks.some((l) => l.status === "active"),
    waitingForParent: waiting,
    hasZones: zones.length > 0,
  });

  const value = useMemo(
    () => ({ session, teen, parentLinks, zones, step, refresh, setWaitingForParent }),
    [session, teen, parentLinks, zones, step, refresh, setWaitingForParent],
  );
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountValue {
  const v = useContext(AccountContext);
  if (!v) throw new Error("useAccount must be used inside AccountProvider");
  return v;
}

// The most recent invite that can still be accepted, if any.
export function pendingInvite(links: ParentLink[], now = Date.now()): ParentLink | null {
  return links.find((l) => l.status === "pending" && l.inviteExpiresAt !== null && Date.parse(l.inviteExpiresAt) > now) ?? null;
}
