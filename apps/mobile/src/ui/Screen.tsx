import { colors, radius, space } from "@quest/tokens";
import { ScrollView, StyleSheet, View, type ViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "./Text";

type ScreenProps = {
  title: string; // "" when the header says it all (H16)
  eyebrow?: string;
  dateline?: string; // a small line above the title, as written (H15's "Friday, Oct 23")
  aside?: React.ReactNode; // beside the title, e.g. the streak pill
  header?: React.ReactNode; // above the title, e.g. a StepHeader
  titleSize?: "screenTitle" | "title";
  footer?: React.ReactNode; // pinned below the content: the screen's buttons
  children?: React.ReactNode;
};

// Every screen scrolls, so nothing is cut off when teens use larger text.
export function Screen({ title, eyebrow, dateline, aside, header, titleSize = "screenTitle", footer, children }: ScreenProps) {
  const heading = (
    <View style={aside ? styles.titleBlock : undefined}>
      {eyebrow ? (
        <Text variant="eyebrow" color="muted">
          {eyebrow.toUpperCase()}
        </Text>
      ) : null}
      {dateline ? (
        <Text variant="caption" color="muted">
          {dateline}
        </Text>
      ) : null}
      {title ? (
        <Text variant={titleSize} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
    </View>
  );
  return (
    <SafeAreaView edges={footer ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        {header}
        {aside ? (
          <View style={styles.titleRow}>
            {heading}
            {aside}
          </View>
        ) : (
          heading
        )}
        {children}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
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
    flexGrow: 1,
    paddingTop: space.lg,
    paddingHorizontal: space.screenSide,
    paddingBottom: space.xl,
    gap: space.md,
  },
  footer: { marginTop: "auto", paddingTop: space.md, gap: space.sm },
  titleRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: space.sm, flexWrap: "wrap" },
  titleBlock: { flexShrink: 1 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.md,
    gap: space.xs,
  },
});
