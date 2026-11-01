import { Api, ZONES, type DeletionRequest, type PlusStatus } from "@quest/contract";
import { space } from "@quest/tokens";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, View } from "react-native";
import { pendingInvite, useAccount } from "../../src/lib/account";
import { signOut } from "../../src/lib/auth";
import { supabase } from "../../src/lib/supabase";
import { dropPushesOn, enableDropPushes } from "../../src/notify/push";
import { downloadMyWork } from "../../src/settings/download";
import { DELETE_FOOTNOTE, clockLabel, deletionLine, providerLabel, shortDate } from "../../src/settings/logic";
import { SettingsExtra, SettingsRow, SettingsSection } from "../../src/settings/rows";
import { Button } from "../../src/ui/Button";
import { Card, Screen } from "../../src/ui/Screen";
import { Text } from "../../src/ui/Text";
import { ErrorText, Pill } from "../../src/ui/parts";

// Drop times that stay outside the default quiet hours (9 pm to 7 am).
const DROP_TIMES = ["17:00", "18:00", "19:00", "20:00"];

const BRACKET_LABEL = { "13_15": "13–15", "16_17": "16–17", "18_19": "18–19" } as const;

// Settings (Figma H20a): notifications, privacy (with Download my work) and
// account (with Delete my account), plus zones and Plus.
export default function You() {
  const { session, teen, parentLinks, zones, refresh } = useAccount();
  const [error, setError] = useState<string | null>(null);
  const [plus, setPlus] = useState<PlusStatus | null>(null);
  const [pushes, setPushes] = useState<"on" | "off" | "denied" | "unavailable">("off");
  const [dropTime, setDropTime] = useState("20:00");
  const [choosingTime, setChoosingTime] = useState(false);
  const [deletion, setDeletion] = useState<DeletionRequest | null>(null);
  const [downloading, setDownloading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void supabase.rpc("plus_status").then(({ data }) => setPlus(Api["plus.status"].output.safeParse(data).data ?? null));
      void supabase.rpc("my_deletion").then(({ data }) => setDeletion(Api["account.deletion"].output.safeParse(data).data ?? null));
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
    setChoosingTime(false);
    const { error: e } = await supabase.rpc("set_notification_prefs", { p_drop_time: t, p_quiet_start: "21:00", p_quiet_end: "07:00", p_daily_reminder: false });
    if (e) setError("Couldn't save the drop time.");
  };

  const linked = parentLinks.some((l) => l.status === "active");
  const waiting = pendingInvite(parentLinks) !== null;

  const coachOff = () =>
    Alert.alert("Turn off coach reviews?", "You'll still get quests, levels and postcards. You can turn reviews back on any time.", [
      { text: "Keep them on", style: "cancel" },
      {
        text: "Turn off",
        onPress: async () => {
          setError(null);
          const { error: rpcError } = await supabase.rpc("set_ai_coach_consent", { p_allow: false });
          if (rpcError) setError(rpcError.message);
          await refresh();
        },
      },
    ]);

  const download = async () => {
    if (!teen || downloading) return;
    setError(null);
    setDownloading(true);
    try {
      const r = await downloadMyWork(teen.handle);
      if (r === "unavailable") setError("This phone can't save files from the app.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't gather your work.");
    } finally {
      setDownloading(false);
    }
  };

  const keepAccount = async () => {
    const { error: e } = await supabase.rpc("cancel_account_deletion");
    if (e) setError("Couldn't cancel the deletion. Try again in a moment.");
    else setDeletion(null);
  };

  return (
    <Screen title="Settings">
      {deletion ? (
        <Card accessibilityRole="alert">
          <Text variant="label">Deleting your account</Text>
          <Text variant="bodySmall" color="text2">
            {deletionLine(deletion)}
          </Text>
          <Button label="Keep my account" onPress={() => void keepAccount()} />
        </Card>
      ) : null}

      <SettingsSection title="Your studio">
        <SettingsRow first label="Zones" value={zones.map((z) => ZONES[z].name).join(", ") || "Pick some"} onPress={() => router.push("/edit-zones")} />
        {/* Plus shows only once it's on: the app never points to buying it
            elsewhere (App Store 3.1.1; see docs/store-release.md). */}
        {plus?.active ? <SettingsRow label="Plus" value={`On${plus.until ? ` until ${shortDate(plus.until)}` : ""}`} /> : null}
      </SettingsSection>

      <SettingsSection title="Notifications">
        <SettingsRow first label="Tonight's drop" value={clockLabel(dropTime)} onPress={() => setChoosingTime((v) => !v)} accessibilityHint="Choose when the drop arrives" />
        {choosingTime ? (
          <SettingsExtra>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
              {DROP_TIMES.map((t) => (
                <Pill key={t} label={clockLabel(t)} selected={dropTime === t} onPress={() => void saveDropTime(t)} />
              ))}
            </View>
          </SettingsExtra>
        ) : null}
        <SettingsRow label="Quiet hours" value="9 pm – 7 am, always on" />
        {pushes === "on" ? (
          <SettingsRow label="Push notifications" value="On" />
        ) : (
          <SettingsRow label="Push notifications" value={pushes === "denied" ? "Off in phone settings" : "Turn on"} onPress={() => void enableDropPushes().then((r) => setPushes(r))} />
        )}
        <SettingsRow label="See tonight's drop" onPress={() => router.push("/drop")} />
      </SettingsSection>

      <SettingsSection title="Privacy">
        <SettingsRow
          first
          label="AI coach reviews"
          value={teen?.aiCoachConsent ? "On" : "Off"}
          onPress={teen?.aiCoachConsent ? coachOff : () => router.push("/ai-consent")}
        />
        <SettingsRow label="Who sees my work" value="You, and family you send to" />
        <SettingsRow label="Download my work" value={downloading ? "Gathering…" : "Photos and reviews"} onPress={() => void download()} accessibilityHint="Saves a file with your photos, reviews and levels" />
      </SettingsSection>

      <SettingsSection title="Account">
        <SettingsRow first label={teen?.handle ?? "Signed in"} value={teen ? `Ages ${BRACKET_LABEL[teen.ageBracket]}` : undefined} />
        <SettingsRow label="Signed in with" value={providerLabel(session?.user.app_metadata)} />
        <SettingsRow
          label="Parent link"
          value={linked ? "Connected" : waiting ? "Waiting for a yes" : "Send a link"}
          onPress={linked ? undefined : () => router.push("/invite-parent")}
        />
        <SettingsRow label="Sign out" chevron={false} onPress={() => void signOut()} />
        {deletion ? null : <SettingsRow danger label="Delete my account" onPress={() => router.push("/delete-account")} />}
      </SettingsSection>

      <ErrorText message={error} />
      <Text variant="caption" color="muted">
        {DELETE_FOOTNOTE}
      </Text>
    </Screen>
  );
}
