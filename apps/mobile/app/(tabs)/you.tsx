import { Api, DELETION_DAYS, ZONES, type PlusStatus } from "@quest/contract";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { pendingInvite, useAccount } from "../../src/lib/account";
import { signOut } from "../../src/lib/auth";
import { supabase } from "../../src/lib/supabase";
import { Button } from "../../src/ui/Button";
import { Card, Screen } from "../../src/ui/Screen";
import { Text } from "../../src/ui/Text";
import { ErrorText, Pill } from "../../src/ui/parts";
import { dropPushesOn, enableDropPushes } from "../../src/notify/push";
import { View } from "react-native";

// Drop times that stay outside the default quiet hours (9 pm to 7 am).
const DROP_TIMES = ["17:00", "18:00", "19:00", "20:00"];

const BRACKET_LABEL = { "13_15": "13–15", "16_17": "16–17", "18_19": "18–19" } as const;

// Sign-in, zones (A2), coach consent and parent link (A1). The full Settings screen,
// with download and delete, comes in A11 (Figma H20a / H21).
export default function You() {
  const { teen, parentLinks, zones, refresh } = useAccount();
  const [error, setError] = useState<string | null>(null);
  const [plus, setPlus] = useState<PlusStatus | null>(null);
  const [pushes, setPushes] = useState<"on" | "off" | "denied" | "unavailable">("off");
  const [dropTime, setDropTime] = useState("20:00");

  useFocusEffect(
    useCallback(() => {
      void supabase.rpc("plus_status").then(({ data }) => setPlus(Api["plus.status"].output.safeParse(data).data ?? null));
      void dropPushesOn().then((on) => setPushes((p) => (on ? "on" : p === "on" ? "off" : p)));
      if (teen) {
        void supabase
          .from("notification_prefs")
          .select("drop_time")
          .eq("teen_id", teen.id)
          .maybeSingle()
          .then(({ data }) => data && setDropTime(String(data.drop_time).slice(0, 5)));
      }
    }, [teen]),
  );

  // Quiet hours stay at the defaults (9 pm to 7 am), which suit every age.
  const saveDropTime = async (t: string) => {
    setDropTime(t);
    const { error: e } = await supabase.rpc("set_notification_prefs", { p_drop_time: t, p_quiet_start: "21:00", p_quiet_end: "07:00", p_daily_reminder: false });
    if (e) setError("Couldn't save the drop time.");
  };

  const linked = parentLinks.some((l) => l.status === "active");
  const waiting = pendingInvite(parentLinks) !== null;

  const coachOff = async () => {
    setError(null);
    const { error: rpcError } = await supabase.rpc("set_ai_coach_consent", { p_allow: false });
    if (rpcError) setError(rpcError.message);
    await refresh();
  };

  return (
    <Screen title="Settings" eyebrow="You">
      <Card>
        <Text variant="label">{teen?.handle ?? "Signed in"}</Text>
        <Text variant="bodySmall" color="text2">
          {teen ? `Ages ${BRACKET_LABEL[teen.ageBracket]} · ${teen.mode === "studio" ? "Studio" : "Walls"}` : ""}
        </Text>
      </Card>

      <Card>
        <Text variant="label">Your zones</Text>
        <Text variant="bodySmall" color="text2">
          {zones.map((z) => ZONES[z].name).join(", ") || "None picked yet."} Swap any time; your levels stay.
        </Text>
        <Button label="Change zones" variant="secondary" onPress={() => router.push("/edit-zones")} />
      </Card>

      <Card>
        <Text variant="label">Evening drop</Text>
        <Text variant="bodySmall" color="text2">
          Once a day, what your makes earned and any cheers from family. Never during quiet hours (9 pm to 7 am).
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {DROP_TIMES.map((t) => (
            <Pill key={t} label={t} selected={dropTime === t} onPress={() => void saveDropTime(t)} />
          ))}
        </View>
        {pushes === "on" ? (
          <Text variant="caption" color="lime">
            Notifications are on.
          </Text>
        ) : (
          <Button label="Turn on notifications" variant="secondary" onPress={() => void enableDropPushes().then((r) => setPushes(r))} />
        )}
        {pushes === "denied" ? (
          <Text variant="caption" color="muted">
            Notifications are off for this app. You can turn them on in Settings, or open the drop from the You tab.
          </Text>
        ) : null}
        <Button label="See tonight's drop" variant="secondary" onPress={() => router.push("/drop")} />
      </Card>

      <Card>
        <Text variant="label">Plus</Text>
        <Text variant="bodySmall" color="text2">
          {plus?.active
            ? `On${plus.until ? ` until ${plus.until.slice(0, 10)}` : ""}: deeper coaching and a second take on each quest.`
            : plus?.canBuyInApp
              ? "Deeper coaching and a second take on each quest. Plus in the app arrives with the store release."
              : "Deeper coaching and a second take on each quest. A parent can start Plus on their parent page."}
        </Text>
      </Card>

      <Card>
        <Text variant="label">AI coach reviews</Text>
        <Text variant="bodySmall" color="text2">
          {teen?.aiCoachConsent ? "On. Your photos go to the coach for feedback." : "Off. You still get quests and levels."}
        </Text>
        {teen?.aiCoachConsent ? (
          <Button label="Turn off" variant="secondary" onPress={coachOff} />
        ) : (
          <Button label="Turn on" variant="secondary" onPress={() => router.push("/ai-consent")} />
        )}
      </Card>

      <Card>
        <Text variant="label">Parent link</Text>
        <Text variant="bodySmall" color="text2">
          {linked ? "Connected." : waiting ? "Waiting for your parent to say yes." : "No parent linked yet."}
        </Text>
        {!linked ? <Button label="Send link to a parent" variant="secondary" onPress={() => router.push("/invite-parent")} /> : null}
      </Card>

      <ErrorText message={error} />
      <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      <Text variant="caption" color="muted">
        Download my work and delete my account arrive with Settings. Deleting removes everything within {DELETION_DAYS} days.
      </Text>
    </Screen>
  );
}
