import { colors, radius, space, zoneColors } from "@quest/tokens";
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { signInWithAppleNative, signInWithBrowser } from "../../src/lib/auth";
import { supabaseConfigured } from "../../src/lib/supabase";
import { Screen } from "../../src/ui/Screen";
import { SignInButtons } from "../../src/ui/SignInButtons";
import { Text } from "../../src/ui/Text";
import { ErrorText } from "../../src/ui/parts";

// H1 / H14a: sign in with Apple or Google. Lean V1 is Studio for everyone.
export default function Welcome() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<boolean>) => async () => {
    if (!supabaseConfigured) {
      setError("This build isn't connected yet: add the Supabase URL and anon key to .env.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Make something every day."
      titleSize="title"
      header={
        <View style={{ gap: space.md }}>
          <View style={styles.brand}>
            <View style={styles.dot} />
            <Text variant="label">[App name] Studio</Text>
          </View>
          <View style={styles.collage} accessible={false} importantForAccessibility="no-hide-descendants">
            <View style={[styles.tile, styles.tall, { backgroundColor: zoneColors.photography }]} />
            <View style={{ flex: 1, gap: space.xs }}>
              <View style={[styles.tile, { backgroundColor: zoneColors.art_crafts }]} />
              <View style={[styles.tile, { backgroundColor: zoneColors.fashion }]} />
            </View>
          </View>
        </View>
      }
      footer={
        <>
          <ErrorText message={error} />
          <SignInButtons
            disabled={busy}
            onApple={run(() => (Platform.OS === "ios" ? signInWithAppleNative() : signInWithBrowser("apple")))}
            onGoogle={run(() => signInWithBrowser("google"))}
          />
          <Text variant="caption" color="muted" style={{ textAlign: "center" }}>
            For teens 13–19. No real names, no DMs.
          </Text>
        </>
      }
    >
      <Text variant="body" color="text2">
        A daily quest, a coach that helps you get better, and sharing with family only.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: "row", alignItems: "center", gap: space.xs },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.lime },
  collage: { flexDirection: "row", gap: space.xs, height: 220 },
  tile: { flex: 1, borderRadius: radius.card, opacity: 0.85 },
  tall: { flex: 1.2 },
});
