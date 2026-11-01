import { MAX_ZONES_PER_TEEN, ZONES, type ZoneId } from "@quest/contract";
import { colors, radius, space, zoneColors } from "@quest/tokens";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAccount } from "../lib/account";
import { supabase } from "../lib/supabase";
import { Button } from "../ui/Button";
import { CheckIcon, ZONE_ICONS } from "../ui/icons";
import { Screen } from "../ui/Screen";
import { Text } from "../ui/Text";
import { ErrorText, InfoRow, StepHeader } from "../ui/parts";

const ALL = Object.keys(ZONES) as ZoneId[];
const rows = Array.from({ length: Math.ceil(ALL.length / 2) }, (_, i) => ALL.slice(i * 2, i * 2 + 2));

// H4: pick up to three zones. In onboarding it's the last step; from the You
// tab it swaps zones, keeping progress in every zone.
export function ZonePicker({ mode }: { mode: "onboarding" | "edit" }) {
  const { zones, refresh } = useAccount();
  const [picked, setPicked] = useState<ZoneId[]>(mode === "edit" ? zones : []);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (z: ZoneId) => {
    setError(null);
    if (picked.includes(z)) {
      setFull(false);
      setPicked(picked.filter((p) => p !== z));
    } else if (picked.length >= MAX_ZONES_PER_TEEN) {
      setFull(true);
    } else {
      setPicked(ALL.filter((a) => a === z || picked.includes(a)));
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("set_teen_zones", { p_zones: picked });
    if (rpcError) {
      setError("Couldn't save your zones. Check your connection and try again.");
      setBusy(false);
      return;
    }
    await refresh(); // onboarding moves on by itself
    setBusy(false);
    if (mode === "edit") router.back();
  };

  const n = picked.length;
  const label = mode === "onboarding" ? `Start with ${n} ${n === 1 ? "zone" : "zones"}` : "Save zones";

  return (
    <Screen
      title="What do you make?"
      titleSize="title"
      header={<StepHeader label={mode === "onboarding" ? "Step 3 of 3" : "Your zones"} back={mode === "edit"} />}
      footer={
        <>
          <ErrorText message={error} />
          <Button label={label} onPress={save} disabled={busy || n === 0} />
        </>
      }
    >
      <Text variant="body" color="text2">
        Pick up to {MAX_ZONES_PER_TEEN}. You get one quest a day in each.
      </Text>
      <View style={{ gap: space.sm }}>
        {rows.map((row) => (
          <View key={row.join()} style={styles.row}>
            {row.map((z) => (
              <ZoneCard key={z} zone={z} picked={picked.includes(z)} onPress={() => toggle(z)} />
            ))}
            {row.length === 1 ? <View style={[styles.card, styles.spacer]} /> : null}
          </View>
        ))}
      </View>
      <Text variant="label" color="lime" accessibilityLiveRegion="polite">
        {full ? `That's ${MAX_ZONES_PER_TEEN}. Unpick one to swap.` : `${n} of ${MAX_ZONES_PER_TEEN} picked`}
      </Text>
      {mode === "edit" ? <InfoRow text="Swapping keeps your levels and work in every zone, so you can come back any time." /> : null}
    </Screen>
  );
}

function ZoneCard({ zone, picked, onPress }: { zone: ZoneId; picked: boolean; onPress: () => void }) {
  const z = ZONES[zone];
  const live = z.status === "live";
  const Icon = ZONE_ICONS[zone];
  const note = live ? z.blurb : "Coming in v1.1";
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: picked, disabled: !live }}
      accessibilityLabel={`${z.name}. ${note}`}
      disabled={!live}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { borderColor: picked ? zoneColors[zone] : colors.border, opacity: live ? (pressed ? 0.85 : 1) : 0.5 },
      ]}
    >
      <View style={styles.cardTop}>
        <View style={styles.icon}>
          <Icon color={zoneColors[zone]} size={18} />
        </View>
        {picked ? (
          <View style={styles.check}>
            <CheckIcon color={colors.limeInk} size={16} strokeWidth={3} />
          </View>
        ) : null}
      </View>
      <Text variant="subheading" color={live ? "text" : "muted"}>
        {z.name}
      </Text>
      <Text variant="caption" color="muted">
        {note}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.sm },
  card: {
    flex: 1,
    minHeight: 132,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderRadius: radius.card,
    padding: space.md,
    gap: space.xxs,
  },
  spacer: { borderColor: "transparent", backgroundColor: "transparent" },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: space.xs },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  check: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.lime, alignItems: "center", justifyContent: "center" },
});
