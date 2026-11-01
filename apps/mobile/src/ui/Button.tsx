import { colors, radius, touch } from "@quest/tokens";
import { Pressable, StyleSheet } from "react-native";
import { Text } from "./Text";

type Props = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
};

// The hi-fi HF/Button: lime primary, dark secondary, 54 pt tall.
export function Button({ label, onPress, variant = "primary", disabled }: Props) {
  const primary = variant === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: primary ? colors.lime : colors.surface2, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
      ]}
    >
      <Text variant="button" color={primary ? "limeInk" : "text"}>
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
