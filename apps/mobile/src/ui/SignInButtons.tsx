import { colors, radius, touch } from "@quest/tokens";
import * as AppleAuthentication from "expo-apple-authentication";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Text } from "./Text";

type Props = { onApple: () => void; onGoogle: () => void; disabled?: boolean };

// H1 / H14a. iOS uses Apple's own button (Human Interface Guidelines); Apple
// must be at least as prominent as Google. Android leads with Google.
export function SignInButtons({ onApple, onGoogle, disabled }: Props) {
  const apple =
    Platform.OS === "ios" ? (
      <AppleAuthentication.AppleAuthenticationButton
        key="apple"
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={touch.buttonHeight / 2}
        style={styles.appleNative}
        onPress={disabled ? () => undefined : onApple}
      />
    ) : (
      <BrandButton key="apple" label="Continue with Apple" logo={<AppleLogo />} light onPress={onApple} disabled={disabled} />
    );
  const google = <BrandButton key="google" label="Continue with Google" logo={<GoogleLogo />} onPress={onGoogle} disabled={disabled} />;
  return <View style={styles.stack}>{Platform.OS === "ios" ? [apple, google] : [google, apple]}</View>;
}

function BrandButton({ label, logo, light, onPress, disabled }: { label: string; logo: React.ReactNode; light?: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.brand,
        light ? styles.light : styles.dark,
        { opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {logo}
      <Text variant="button" style={{ color: light ? colors.black : colors.text, fontSize: 17 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function GoogleLogo() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <Path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
      <Path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
      <Path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
    </Svg>
  );
}

function AppleLogo() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path
        fill="#000000"
        d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  appleNative: { height: touch.buttonHeight, width: "100%" },
  brand: {
    minHeight: touch.buttonHeight,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 24,
  },
  light: { backgroundColor: colors.white },
  dark: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
});
