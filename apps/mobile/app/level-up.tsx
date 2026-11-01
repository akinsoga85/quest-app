import { Api, type NewPostcard, type StudioMake, type ZoneId } from "@quest/contract";
import { colors, radius, space } from "@quest/tokens";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";
import { usePhotoUrls } from "../src/lib/photos";
import { supabase } from "../src/lib/supabase";
import { levelUpClosed } from "../src/studio/levelUp";
import { levelView, zoneName } from "../src/studio/logic";
import { ZoneArt } from "../src/today/parts";
import { Button } from "../src/ui/Button";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { ErrorText, InfoRow } from "../src/ui/parts";

// H13: a level-up and its digital postcard. The teen picks which of their
// recent makes goes on it. Prints wait until there's a print partner.
export default function LevelUp() {
  const [cards, setCards] = useState<NewPostcard[] | null>(null);
  const [makes, setMakes] = useState<StudioMake[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The highest new level, per the first zone that has one.
  const card = cards?.reduce<NewPostcard | null>((best, c) => (!best || (c.zone === best.zone && c.level > best.level) ? c : best), null) ?? null;

  useEffect(() => {
    void supabase.rpc("get_new_postcards").then(({ data }) => {
      const parsed = Api["postcards.new"].output.safeParse(data);
      setCards(parsed.success ? parsed.data : []);
    });
    return () => levelUpClosed();
  }, []);

  useEffect(() => {
    if (!card) return;
    setPicked(card.makeId);
    void supabase.rpc("get_studio", { p_zone: card.zone, p_limit: 12 }).then(({ data }) => {
      const page = Api["studio.list"].output.safeParse(data);
      if (page.success) setMakes(page.data.makes.filter((m) => m.status === "reviewed" || m.status === "no_review").slice(0, 4));
    });
  }, [card?.id]); // runs once per postcard shown

  const urls = usePhotoUrls(makes.map((m) => m.storagePath));

  const keep = async () => {
    if (!cards) return;
    setBusy(true);
    setError(null);
    if (card && picked && picked !== card.makeId) {
      const { error: pickError } = await supabase.rpc("pick_postcard", { p_postcard_id: card.id, p_make_id: picked });
      if (pickError) {
        setError("Couldn't save your pick. Try again.");
        setBusy(false);
        return;
      }
    }
    await supabase.rpc("mark_postcards_seen", { p_ids: cards.map((c) => c.id) });
    router.back();
  };

  if (!cards) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}>
        <ActivityIndicator color={colors.lime} />
      </View>
    );
  }
  if (!card) {
    return (
      <Screen title="No new postcards" footer={<Button label="Close" variant="secondary" onPress={() => router.back()} />}>
        <Text variant="body" color="text2">
          Your postcards are in your Studio.
        </Text>
      </Screen>
    );
  }

  const v = levelView([0, 0, 10, 25, 45, 70][card.level] ?? 0);
  return (
    <Screen title="" footer={<><ErrorText message={error} /><Button label="Keep it" onPress={() => void keep()} disabled={busy} /></>}>
      <View style={styles.badge} accessible accessibilityLabel={`Level ${card.level}`}>
        <Text variant="screenTitle" color="limeInk">
          {card.level}
        </Text>
      </View>
      <Text variant="title" style={{ textAlign: "center" }} accessibilityRole="header">
        Level {card.level} · {v.name}
      </Text>
      <Text variant="body" color="text2" style={{ textAlign: "center" }}>
        {zoneName(card.zone)}. You earned this by showing up and getting better.
      </Text>
      {makes.length > 0 ? (
        <>
          <Text variant="eyebrow" color="muted">
            PICK YOUR POSTCARD
          </Text>
          <View style={styles.grid}>
            {makes.map((m) => (
              <Pressable
                key={m.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: picked === m.id }}
                accessibilityLabel={m.questTitle}
                onPress={() => setPicked(m.id)}
                style={[styles.tile, picked === m.id ? styles.tilePicked : null]}
              >
                {urls[m.storagePath] ? <Image source={{ uri: urls[m.storagePath] }} style={StyleSheet.absoluteFill} /> : <ZoneArt zone={m.zone as ZoneId} height={120} />}
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      <InfoRow text="Saved as a digital postcard in your Studio. Your family can see it too." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: "center", width: 104, height: 104, borderRadius: 26, backgroundColor: colors.lime, alignItems: "center", justifyContent: "center", transform: [{ rotate: "-6deg" }], marginTop: space.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tile: { width: "47%", height: 120, borderRadius: radius.card, overflow: "hidden", backgroundColor: colors.surface, borderWidth: 3, borderColor: "transparent" },
  tilePicked: { borderColor: colors.lime },
});
