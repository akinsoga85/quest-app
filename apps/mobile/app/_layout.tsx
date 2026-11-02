// Per-weight imports, so only the five weights in the tokens ship in the app.
import { BricolageGrotesque_700Bold } from "@expo-google-fonts/bricolage-grotesque/700Bold";
import { BricolageGrotesque_800ExtraBold } from "@expo-google-fonts/bricolage-grotesque/800ExtraBold";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { colors } from "@quest/tokens";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AccountProvider, useAccount } from "../src/lib/account";
import { UploadProvider } from "../src/capture/UploadProvider";
import { TodayProvider } from "../src/today/TodayProvider";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AccountProvider>
        <TodayProvider>
          <UploadProvider>
            <Routes />
          </UploadProvider>
        </TodayProvider>
      </AccountProvider>
    </SafeAreaProvider>
  );
}

// Each screen is reachable only at its step: sign in, age, ask a parent, zones, app.
// Changing step (signing in, making a profile, a parent saying yes) moves the
// teen on automatically.
function Routes() {
  const { step } = useAccount();

  useEffect(() => {
    if (step !== "loading") void SplashScreen.hideAsync();
  }, [step]);

  if (step === "loading") return null;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={step === "welcome"}>
        <Stack.Screen name="(onboarding)/welcome" />
      </Stack.Protected>
      <Stack.Protected guard={step === "age"}>
        <Stack.Screen name="(onboarding)/age" />
      </Stack.Protected>
      <Stack.Protected guard={step === "welcome" || step === "age"}>
        <Stack.Screen name="stop" />
      </Stack.Protected>
      <Stack.Protected guard={step === "parent"}>
        <Stack.Screen name="(onboarding)/parent" />
      </Stack.Protected>
      <Stack.Protected guard={step === "zones"}>
        <Stack.Screen name="(onboarding)/zones" />
      </Stack.Protected>
      <Stack.Protected guard={step === "done"}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="make" options={{ presentation: "modal" }} />
        <Stack.Screen name="ai-consent" options={{ presentation: "modal" }} />
        <Stack.Screen name="invite-parent" options={{ presentation: "modal" }} />
        <Stack.Screen name="edit-zones" options={{ presentation: "modal" }} />
        <Stack.Screen name="review/[makeId]" options={{ presentation: "modal" }} />
        <Stack.Screen name="level-up" options={{ presentation: "modal" }} />
        <Stack.Screen name="send-family/[makeId]" options={{ presentation: "modal" }} />
      </Stack.Protected>
    </Stack>
  );
}
