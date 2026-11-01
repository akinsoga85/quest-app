import { colors, radius, space } from "@quest/tokens";
import { ScrollView, StyleSheet, View, type ViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "./Text";

// Every screen scrolls, so nothing is cut off when teens use larger text.
export function Screen({ title, eyebrow, children }: { title: string; eyebrow?: string; children?: React.ReactNode }) {
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        {eyebrow ? (
          <Text variant="eyebrow" color="muted">
            {eyebrow.toUpperCase()}
          </Text>
        ) : null}
        <Text variant="screenTitle" accessibilityRole="header">
          {title}
        </Text>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ style, ...rest }: ViewProps) {
  return <View style={[styles.card, style]} {...rest} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingTop: space.lg,
    paddingHorizontal: space.screenSide,
    paddingBottom: space.xl,
    gap: space.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.md,
    gap: space.xs,
  },
});
