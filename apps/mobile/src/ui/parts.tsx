import { colors, minTouch, radius, space } from "@quest/tokens";
import { router } from "expo-router";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Text } from "./Text";

// A selectable chip (birth year, month). At least 44 pt / 48 dp tall.
export function Pill({ label, selected, onPress, accessibilityLabel }: { label: string; selected: boolean; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={[styles.pill, { minHeight: minTouch(Platform.OS) }, selected ? styles.pillOn : styles.pillOff]}
    >
      <Text variant="label" color={selected ? "limeInk" : "text"}>
        {label}
      </Text>
    </Pressable>
  );
}

// The numbered list in a card (H3, H22): lime circles with dark numbers.
export function NumberedSteps({ steps }: { steps: string[] }) {
  return (
    <View style={styles.card}>
      {steps.map((s, i) => (
        <View key={s} style={styles.stepRow}>
          <View style={styles.num}>
            <Text variant="micro" color="limeInk">
              {i + 1}
            </Text>
          </View>
          <Text variant="bodySmall" style={{ flex: 1 }}>
            {s}
          </Text>
        </View>
      ))}
    </View>
  );
}

// Back arrow plus a centred step label, as at the top of H2, H3 and H22.
export function StepHeader({ label, back = true }: { label: string; back?: boolean }) {
  const size = minTouch(Platform.OS);
  return (
    <View style={styles.header}>
      {back && router.canGoBack() ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={[styles.back, { width: size, height: size }]}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={colors.text} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </Pressable>
      ) : (
        <View style={{ width: size }} />
      )}
      <Text variant="label" style={{ flex: 1, textAlign: "center" }}>
        {label}
      </Text>
      <View style={{ width: size }} />
    </View>
  );
}

// A quiet strip with text on the left and an optional action on the right.
export function InfoRow({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.info}>
      <Text variant="caption" color="text2" style={{ flex: 1 }}>
        {text}
      </Text>
      {action && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} style={{ minHeight: minTouch(Platform.OS), justifyContent: "center" }}>
          <Text variant="label" color="lime">
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text variant="bodySmall" color="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: radius.pill, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  pillOn: { backgroundColor: colors.lime },
  pillOff: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.md,
    gap: space.sm,
  },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  num: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.lime, alignItems: "center", justifyContent: "center", marginTop: 1 },
  header: { flexDirection: "row", alignItems: "center" },
  back: { borderRadius: radius.pill, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  info: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.limeTint,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xxs,
    minHeight: 44,
  },
});
