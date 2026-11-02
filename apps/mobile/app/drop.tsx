import { Api, CHEER_LABELS, ZONES, skillIdsFor, skillName, type Drop, type ZoneId } from "@quest/contract";
import { colors, radius, space, zoneColors } from "@quest/tokens";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAccount } from "../src/lib/account";
import { supabase } from "../src/lib/supabase";
import { dayHeading } from "../src/today/logic";
import { ZoneArt } from "../src/today/parts";
import { Button } from "../src/ui/Button";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";

// H19: tonight's drop. What today's make earned this week, and cheers from
// family. Cheers stay between the teen and their parent.
export default function DropScreen() {
  const { zones } = useAccount();
  const [drop, setDrop] = useState<Drop | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void supabase.rpc("get_drop").then(({ data, error: rpcError }) => {
        const parsed = Api["drop.get"].output.safeParse(data);
        if (rpcError || !parsed.success) setError("Couldn't load tonight's drop.");
        else setDrop(parsed.data);
      });
    }, []),
  );

  const zone = (zones[0] ?? "photography") as ZoneId;
  const skills = skillIdsFor(zone);
  const maxSkill = Math.max(1, ...skills.map((s) => drop?.weekSkills[s] ?? 0));
  const firstCheer = drop?.cheers[0];

  return (
    <Screen title="Tonight's drop" dateline={drop ? dayHeading(drop.day) : undefined} footer={<Button label="Done" variant="secondary" onPress={() => router.back()} />}>
      {error ? (
        <Text variant="bodySmall" color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {!drop && !error ? <ActivityIndicator color={colors.lime} /> : null}
      {drop ? (
        <>
          {drop.todays.map((t) => (
            <View key={t.makeId} style={[styles.card, styles.row]}>
              <ZoneArt zone={t.zone as ZoneId} height={56} width={56} rounded={radius.sm} />
              <View style={{ flex: 1 }}>
                <Text variant="subheading">{t.questTitle}</Text>
                <Text variant="caption" color="muted">
                  {t.sentTo.length ? `Sent to ${t.sentTo.join(" and ")}` : `${ZONES[t.zone as ZoneId]?.name ?? t.zone} · in your Studio`}
                </Text>
              </View>
            </View>
          ))}
          <View style={styles.row}>
            <View style={[styles.card, styles.stat]}>
              <Text variant="screenTitle">{drop.weekPoints}</Text>
              <Text variant="caption" color="text2">
                skill points this week
              </Text>
            </View>
            <View style={[styles.card, styles.stat, drop.cheers.length ? styles.lime : null]}>
              <Text variant="screenTitle" color={drop.cheers.length ? "limeInk" : "text"}>
                {drop.cheers.length}
              </Text>
              <Text variant="caption" color={drop.cheers.length ? "limeInk" : "text2"}>
                {drop.cheers.length === 1 ? `cheer from ${firstCheer?.from}` : "cheers from family"}
              </Text>
            </View>
          </View>
          <View style={styles.card}>
            <Text variant="subheading" accessibilityRole="header">
              Your skills this week
            </Text>
            {skills.map((s) => {
              const pts = drop.weekSkills[s] ?? 0;
              return (
                <View key={s} style={styles.row} accessible accessibilityLabel={`${skillName(s)}: plus ${pts}`}>
                  <Text variant="label" style={{ width: 90 }}>
                    {skillName(s)}
                  </Text>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${(pts / maxSkill) * 100}%`, backgroundColor: zoneColors[zone] }]} />
                  </View>
                  <Text variant="label" style={{ width: 32, textAlign: "right" }}>
                    {pts ? `+${pts}` : "0"}
                  </Text>
                </View>
              );
            })}
          </View>
          {drop.cheers.map((c, i) => (
            <View key={i} style={styles.card}>
              <Text variant="label">
                {c.from} cheered {CHEER_LABELS[c.cheer]}
              </Text>
              <Text variant="caption" color="muted">
                On "{c.questTitle}". Family cheers stay between you two.
              </Text>
            </View>
          ))}
          {drop.todays.length === 0 && drop.cheers.length === 0 ? (
            <Text variant="body" color="text2">
              Nothing new today yet. There's still time for today's quest.
            </Text>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.card, padding: space.md, gap: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  stat: { flex: 1, minHeight: 120, justifyContent: "flex-end" },
  lime: { backgroundColor: colors.lime, borderColor: colors.lime },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.surface2, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 4 },
});
