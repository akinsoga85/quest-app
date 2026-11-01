import { colors, type, type ColorToken, type TypeToken } from "@quest/tokens";
import { Text as RNText, type TextProps } from "react-native";

// All app text goes through this, so sizes come from the tokens and every
// label grows with the phone's text-size setting (up to 200%).
export function Text({
  variant = "body",
  color = "text",
  style,
  ...rest
}: TextProps & { variant?: TypeToken; color?: ColorToken }) {
  const t = type[variant];
  return (
    <RNText
      maxFontSizeMultiplier={2}
      style={[
        {
          fontFamily: t.font,
          fontSize: t.size,
          lineHeight: t.lineHeight,
          letterSpacing: "letterSpacing" in t ? t.letterSpacing : undefined,
          color: colors[color],
        },
        style,
      ]}
      {...rest}
    />
  );
}
