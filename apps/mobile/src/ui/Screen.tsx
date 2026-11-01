import { colors, radius, space } from "@quest/tokens";
import { ScrollView, StyleSheet, View, type ViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "./Text";

type ScreenProps = {
  title: string;
  eyebrow?: string;
  header?: React.ReactNode; // above the title, e.g. a StepHeader
  titleSize?: "screenTitle" | "title";
  footer?: React.ReactNode; // pinned below the content: the screen's buttons
  children?: React.ReactNode;
};

// Every screen scrolls, so nothing is cut off when teens use larger text.
export function Screen({ title, eyebrow, header, titleSize = "screenTitle", footer, children }: ScreenProps) {
  return (
    <SafeAreaView edges={footer ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        {header}
        {eyebrow ? (
          <Text variant="eyebrow" color="muted">
            {eyebrow.toUpperCase()}
          </Text>
        ) : null}
        <Text variant={titleSize} accessibilityRole="header">
          {title}
        </Text>
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
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.md,
    gap: space.xs,
  },
});
