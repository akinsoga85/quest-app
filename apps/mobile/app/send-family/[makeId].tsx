import { Api, makePath, type FamilyStatus } from "@quest/contract";
import { colors, radius, space } from "@quest/tokens";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useAccount } from "../../src/lib/account";
import { usePhotoUrls } from "../../src/lib/photos";
import { supabase } from "../../src/lib/supabase";
import { familyNames } from "../../src/review/logic";
import { Button } from "../../src/ui/Button";
import { CheckIcon, LockIcon, YouIcon } from "../../src/ui/icons";
import { Screen } from "../../src/ui/Screen";
import { Text } from "../../src/ui/Text";
import { ErrorText } from "../../src/ui/parts";

// H17: send a reviewed make to the teen's linked parents. They see it on
// their parent page and can send back one cheer; nothing else.
export default function SendToFamily() {
  const { makeId } = useLocalSearchParams<{ makeId: string }>();
  const { teen } = useAccount();
  const [family, setFamily] = useState<FamilyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urls = usePhotoUrls(teen && makeId ? [makePath(teen.id, makeId)] : []);
  const url = teen && makeId ? urls[makePath(teen.id, makeId)] : undefined;

  useEffect(() => {
    void supabase.rpc("get_family_status", { p_make_id: makeId }).then(({ data }) => {
      const parsed = Api["family.status"].output.safeParse(data);
      setFamily(parsed.success ? parsed.data : null);
    });
  }, [makeId]);

  const names = familyNames(family?.parents ?? []);
  const send = async () => {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("share_with_family", { p_make_id: makeId });
    setBusy(false);
    if (rpcError) setError("Couldn't send it. Check your connection and try again.");
    else router.back();
  };

  return (
    <Screen
      title="Send to family?"
      titleSize="title"
      footer={
        <>
          <ErrorText message={error} />
          <Button label={`Send to ${names}`} onPress={() => void send()} disabled={busy || !family || family.parents.length === 0} />
          <Button label="Not now" variant="secondary" onPress={() => router.back()} />
        </>
      }
    >
      {url ? <Image source={{ uri: url }} style={styles.photo} accessibilityLabel="The make you're sending" /> : null}
      <Text variant="body" color="text2">
        Your parent sees it on their family page.
      </Text>
      <Row icon={<YouIcon color={colors.text2} size={18} />} text="Only your parent sees it. No other teens, ever." />
      <Row icon={<CheckIcon color={colors.text2} size={18} />} text="They can send back a cheer. No messages." />
      <Row icon={<LockIcon color={colors.text2} size={18} />} text="It stays in your Studio either way." />
      <View style={styles.safety}>
        <Text variant="label" color="lime">
          Safety check passed
        </Text>
        {["Location removed from the photo", "Checked by our safety scan before anyone saw it"].map((t) => (
          <View key={t} style={styles.row}>
            <CheckIcon color={colors.lime} size={14} strokeWidth={3} />
            <Text variant="caption" color="text2">
              {t}
            </Text>
          </View>
        ))}
      </View>
      {family && family.parents.length > 0 ? (
        <View style={styles.row}>
          <View style={styles.avatar} />
          <View style={{ flex: 1 }}>
            <Text variant="label">Sending to {names}</Text>
            <Text variant="caption" color="muted">
              {family.parents.length === 1 ? "The parent who said yes when you joined" : "The parents who said yes"}
            </Text>
          </View>
        </View>
      ) : family ? (
        <Text variant="bodySmall" color="text2">
          No parent is linked yet. Send a parent link from the You tab first.
        </Text>
      ) : null}
    </Screen>
  );
}

function Row({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.icon}>{icon}</View>
      <Text variant="bodySmall" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { width: "100%", height: 180, borderRadius: radius.card, backgroundColor: colors.surface },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  safety: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.card, padding: space.md, gap: space.xs },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#8EBBFF" },
});
