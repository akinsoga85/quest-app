import { Api, makePath, type ZoneId, type ZoneLevel } from "@quest/contract";
import { colors, minTouch, radius, space, zoneColors } from "@quest/tokens";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, View } from "react-native";
import { useAccount } from "../../src/lib/account";
import { usePhotoUrls } from "../../src/lib/photos";
import { supabase } from "../../src/lib/supabase";
import { dayChip, levelView, skillBars, zoneName } from "../../src/studio/logic";
import { ZoneArt } from "../../src/today/parts";
import { Screen } from "../../src/ui/Screen";
import { Text } from "../../src/ui/Text";
import { InfoRow } from "../../src/ui/parts";

// H12: the level, skills and "you vs. you" for one zone at a time. Points
// come from quests finished and coach skill points, never cheers.
export default function Levels() {
  const { teen } = useAccount();
  const [levels, setLevels] = useState<ZoneLevel[] | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void supabase.rpc("get_levels").then(({ data, error: rpcError }) => {
        const parsed = Api["levels.get"].output.safeParse(data);
        if (rpcError || !parsed.success) setError("Couldn't load your levels. Check your connection.");
        else {
          setError(null);
          setLevels(parsed.data);
        }
      });
    }, []),
  );

  const zone = levels?.[index % Math.max(1, levels.length)] ?? null;
  const v = zone ? levelView(zone.points) : null;
  const compare = zone?.compare ?? null;
  const urls = usePhotoUrls(compare && teen ? [makePath(teen.id, compare.before.makeId), makePath(teen.id, compare.after.makeId)] : []);
  const target = minTouch(Platform.OS);

  return (
    <Screen
      title="Levels"
      aside={
        levels && levels.length > 1 && zone ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Showing ${zoneName(zone.zone)}. Switch zone`}
            onPress={() => setIndex(index + 1)}
            style={[styles.switch, { minHeight: target }]}
          >
            <Text variant="label">{zoneName(zone.zone)}</Text>
          </Pressable>
        ) : zone ? (
          <View style={[styles.switch, { minHeight: target }]}>
            <Text variant="label">{zoneName(zone.zone)}</Text>
          </View>
        ) : null
      }
    >
      {error ? (
        <Text variant="bodySmall" color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {!levels && !error ? <ActivityIndicator color={colors.lime} accessibilityLabel="Loading your levels" /> : null}

      {zone && v ? (
        <>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.badge}>
                <Text variant="title" color="limeInk">
                  {v.level}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="label" style={{ color: zoneColors[zone.zone as ZoneId] }}>
                  {zoneName(zone.zone)}
                </Text>
                <Text variant="heading" accessibilityRole="header">
                  Level {v.level} · {v.name}
                </Text>
              </View>
            </View>
            <View style={styles.track} accessible accessibilityLabel={v.progressText}>
              <View style={[styles.fill, { width: `${v.progressPct}%` }]} />
            </View>
            <Text variant="caption" color="text2">
              {v.progressText}
            </Text>
            <View style={styles.dots}>
              {v.dots.map((d) => (
                <View key={d.name} style={styles.dotCol}>
                  <View style={[styles.dot, { backgroundColor: d.reached ? colors.lime : colors.surface2 }]} />
                  <Text variant="micro" color={d.current ? "text" : "muted"}>
                    {d.name}
                  </Text>
                </View>
              ))}
            </View>
            {v.nextText ? <InfoRow text={v.nextText} /> : null}
          </View>

          <View style={styles.card}>
            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text variant="subheading" accessibilityRole="header">
                Skills
              </Text>
              <Text variant="caption" color="muted">
                From coach reviews, never cheers
              </Text>
            </View>
            {skillBars(zone).map((b) => (
              <View key={b.skill} style={styles.row} accessible accessibilityLabel={`${b.name}: ${b.score === null ? "not scored yet" : `${b.score} out of 10`}`}>
                <Text variant="label" style={{ width: 90 }}>
                  {b.name}
                </Text>
                <View style={[styles.track, { flex: 1, height: 8 }]}>
                  <View style={[styles.fill, { width: `${(b.score ?? 0) * 10}%`, backgroundColor: zoneColors[zone.zone as ZoneId] }]} />
                </View>
                <Text variant="label" style={{ width: 44, textAlign: "right" }}>
                  {b.score === null ? "–" : `${b.score}/10`}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text variant="subheading" accessibilityRole="header">
              You vs. you
            </Text>
            {compare ? (
              <>
                <Text variant="caption" color="muted">
                  {compare.sameQuest ? "The same quest, made again." : "Your first make in this zone, and your latest."}
                </Text>
                <View style={styles.row}>
                  {[compare.before, compare.after].map((m) => {
                    const url = teen ? urls[makePath(teen.id, m.makeId)] : undefined;
                    return (
                      <Pressable
                        key={m.makeId}
                        accessibilityRole="button"
                        accessibilityLabel={`Your make from ${dayChip(m.day, null)}`}
                        onPress={() => router.push({ pathname: "/review/[makeId]", params: { makeId: m.makeId } })}
                        style={styles.compareTile}
                      >
                        {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} /> : <ZoneArt zone={zone.zone as ZoneId} height={140} />}
                        <View style={styles.chip}>
                          <Text variant="micro">{dayChip(m.day, null)}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : (
              <Text variant="bodySmall" color="text2">
                After a few more makes, your first and latest sit side by side here.
              </Text>
            )}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  switch: { backgroundColor: colors.surface2, borderRadius: radius.pill, paddingHorizontal: 16, justifyContent: "center" },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.card, padding: space.md, gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  badge: { width: 64, height: 64, borderRadius: 18, backgroundColor: colors.lime, alignItems: "center", justifyContent: "center", transform: [{ rotate: "-4deg" }] },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.surface2, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 5, backgroundColor: colors.lime },
  dots: { flexDirection: "row", justifyContent: "space-between" },
  dotCol: { alignItems: "center", gap: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  compareTile: { flex: 1, height: 140, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surface2 },
  chip: { position: "absolute", left: space.xs, bottom: space.xs, backgroundColor: colors.bg, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
});
