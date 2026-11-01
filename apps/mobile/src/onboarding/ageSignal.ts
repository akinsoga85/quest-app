import { Platform } from "react-native";
import { interpretAndroidAccess, interpretRange, iosSupported, type StoreAgeResult } from "./ageSignalLogic";

// Asks the phone's app store for the teen's age range: Apple's Declared Age
// Range on iOS 26+, Google Play Age Signals on Android. Any failure means
// "ask for birth month and year instead", never "assume an adult".
export async function getStoreAgeSignal(): Promise<StoreAgeResult> {
  if (Platform.OS === "ios" && !iosSupported(Platform.Version)) return { kind: "unavailable" };
  if (Platform.OS !== "ios" && Platform.OS !== "android") return { kind: "unavailable" };

  try {
    // Loaded lazily: the native module only exists in development and store builds, not Expo Go.
    const AgeRange = await import("expo-age-range");
    if (Platform.OS === "android") {
      const access = interpretAndroidAccess(await AgeRange.requestAgeSignalsAccessAsync());
      if (access !== "ask_range") return access;
    }
    const range = await AgeRange.requestAgeRangeAsync({ threshold1: 13, threshold2: 16, threshold3: 18 });
    return interpretRange(range);
  } catch {
    return { kind: "unavailable" };
  }
}
