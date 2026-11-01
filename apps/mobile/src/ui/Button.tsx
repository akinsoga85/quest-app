import { colors, radius, touch } from "@quest/tokens";
import { Pressable, StyleSheet } from "react-native";
import { Text } from "./Text";

type Props = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
};

// The hi-fi HF/Button: lime primary, dark secondary, 54 pt tall. Danger (red,
// dark text) is only for deleting an account.
export function Button({ label, onPress, variant = "primary", disabled }: Props) {
  const primary = variant === "primary";
  const fill = primary ? colors.lime : variant === "danger" ? colors.danger : colors.surface2;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: fill, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
      ]}
    >
      <Text variant="button" color={variant === "secondary" ? "text" : "limeInk"}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch.buttonHeight,
    borderRadius: radius.pill,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});
