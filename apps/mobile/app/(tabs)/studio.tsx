import { Api, ZONES, type StudioMake, type ZoneId } from "@quest/contract";
import { colors, minTouch, radius, space, zoneColors } from "@quest/tokens";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, View } from "react-native";
import { useAccount } from "../../src/lib/account";
import { usePhotoUrls } from "../../src/lib/photos";
import { supabase } from "../../src/lib/supabase";
import { dayChip, makesCount } from "../../src/studio/logic";
import { ZoneArt } from "../../src/today/parts";
import { useToday } from "../../src/today/TodayProvider";
import { Button } from "../../src/ui/Button";
import { CheckIcon } from "../../src/ui/icons";
import { Screen } from "../../src/ui/Screen";
import { Text } from "../../src/ui/Text";
import { Pill } from "../../src/ui/parts";

const PAGE = 30;

// H18: everything the teen has made, newest first, by zone. Tap a make for its
// coach review. Only the teen and their family see these.
export default function Studio() {
  const { zones } = useAccount();
  const { today } = useToday();
  const [zone, setZone] = useState<ZoneId | null>(null);
  const [makes, setMakes] = useState<StudioMake[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (more: boolean) => {
      setLoading(true);
      const before = more ? (makes.at(-1)?.createdAt ?? null) : null;
      const { data, error: rpcError } = await supabase.rpc("get_studio", { p_zone: zone ?? undefined, p_before: before ?? undefined, p_limit: PAGE });
      const page = Api["studio.list"].output.safeParse(data);
      if (rpcError || !page.success) {
        setError("Couldn't load your Studio. Check your connection.");
      } else {
        setError(null);
        setTotal(page.data.total);
        setMakes(more ? [...makes, ...page.data.makes] : page.data.makes);
      }
      setLoading(false);
    },
    [zone, makes],
  );

  useFocusEffect(
    useCallback(() => {
      void load(false);
      // Reload when the zone filter changes or the tab comes back into view.
    }, [zone]), // load reads only `zone` when starting from the top
  );

  const urls = usePhotoUrls(makes.map((m) => m.storagePath));
  const columns: StudioMake[][] = [[], []];
  makes.forEach((m, i) => columns[i % 2]!.push(m));

  return (
    <Screen title="Studio">
      <View style={styles.filters}>
        <Pill label="All" selected={zone === null} onPress={() => setZone(null)} />
        {zones.map((z) => (
          <Pill key={z} label={ZONES[z].name} selected={zone === z} onPress={() => setZone(z)} />
        ))}
      </View>
      <View style={{ gap: 2 }}>
        <Text variant="subheading" accessibilityRole="header">
          Everything you've made
        </Text>
        {total !== null ? (
          <Text variant="caption" color="muted">
            {makesCount(total)}
          </Text>
        ) : null}
      </View>
      <View style={styles.tip}>
        <View style={styles.tipIcon}>
          <CheckIcon color={colors.limeInk} size={14} strokeWidth={3} />
        </View>
        <Text variant="bodySmall" style={{ flex: 1 }}>
          Tap any make to see its coach review.
        </Text>
      </View>

      {error ? (
        <Text variant="bodySmall" color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {total === 0 ? (
        <Text variant="body" color="text2">
          Nothing here yet. Your makes appear here as soon as you've made today's quest.
        </Text>
      ) : null}

      <View style={styles.grid}>
        {columns.map((col, c) => (
          <View key={c} style={styles.column}>
            {col.map((m, i) => (
              <MakeTile key={m.id} make={m} url={urls[m.storagePath]} today={today?.day ?? null} tall={(i + c) % 2 === 0} />
            ))}
          </View>
        ))}
      </View>
      {loading ? <ActivityIndicator color={colors.lime} /> : null}
      {total !== null && makes.length < total && !loading ? <Button label="Show older makes" variant="secondary" onPress={() => void load(true)} /> : null}
    </Screen>
  );
}

function MakeTile({ make, url, today, tall }: { make: StudioMake; url: string | undefined; today: string | null; tall: boolean }) {
  const isToday = make.localDay === today;
  const chip = dayChip(make.localDay, today);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${make.questTitle}, ${ZONES[make.zone as ZoneId]?.name ?? make.zone}, ${chip}`}
      accessibilityHint="Opens its coach review"
      onPress={() => router.push({ pathname: "/review/[makeId]", params: { makeId: make.id } })}
      style={({ pressed }) => [styles.tile, { aspectRatio: tall ? 0.8 : 1, opacity: pressed ? 0.85 : 1, minHeight: minTouch(Platform.OS) }, isToday ? styles.tileToday : null]}
    >
      {url ? (
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={StyleSheet.absoluteFill}>
          <ZoneArt zone={make.zone as ZoneId} height={400} />
        </View>
      )}
      <View style={styles.chip}>
        <Text variant="micro" color={isToday ? "lime" : "text"}>
          {chip}
        </Text>
      </View>
      <View style={[styles.zoneDot, { backgroundColor: zoneColors[make.zone as ZoneId] ?? colors.muted }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  tip: { flexDirection: "row", alignItems: "center", gap: space.xs, backgroundColor: colors.limeTint, borderRadius: radius.md, padding: space.sm },
  tipIcon: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.lime, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", gap: space.sm },
  column: { flex: 1, gap: space.sm },
  tile: { borderRadius: radius.card, overflow: "hidden", backgroundColor: colors.surface, borderWidth: 2, borderColor: "transparent" },
  tileToday: { borderColor: colors.lime },
  chip: { position: "absolute", left: space.xs, bottom: space.xs, backgroundColor: colors.bg, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  zoneDot: { position: "absolute", right: space.sm, top: space.sm, width: 10, height: 10, borderRadius: 5 },
});
