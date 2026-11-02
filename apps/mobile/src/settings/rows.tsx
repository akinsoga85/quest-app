import { colors, minTouch, radius, space } from "@quest/tokens";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "../ui/Text";

// H20a's grouped settings: a small caps heading over a card of rows.
export function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="eyebrow" color="muted" accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

type RowProps = {
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  first?: boolean; // no divider above the first row
  chevron?: boolean; // › on rows that open something (not on Sign out)
  accessibilityHint?: string;
};

// A row is a button only when it does something; then it shows ›.
export function SettingsRow({ label, value, onPress, danger, first, chevron = true, accessibilityHint }: RowProps) {
  const inner = (
    <>
      <Text variant="label" color={danger ? "danger" : "text"} style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <Text variant="bodySmall" color="text2" style={styles.value} numberOfLines={2}>
        {[value, onPress && chevron ? "›" : null].filter(Boolean).join("  ")}
      </Text>
    </>
  );
  const style = [styles.row, { minHeight: minTouch(Platform.OS) }, first ? null : styles.divider];
  if (!onPress) {
    return (
      <View style={style} accessible accessibilityLabel={value ? `${label}: ${value}` : label}>
        {inner}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}: ${value}` : label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [...style, pressed ? { backgroundColor: colors.surface2 } : null]}
    >
      {inner}
    </Pressable>
  );
}

// Content under a row (the drop time choices), inside the same card.
export function SettingsExtra({ children }: { children: React.ReactNode }) {
  return <View style={styles.extra}>{children}</View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.card, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm, paddingHorizontal: space.md, paddingVertical: 12 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  value: { flexShrink: 1, textAlign: "right" },
  extra: { paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm },
});
