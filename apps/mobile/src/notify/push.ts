import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { Platform } from "react-native";
import { supabase } from "../lib/supabase";

// Pushes for the evening drop (A10). Asked for only when the teen taps "Turn
// on", never at launch.
export async function enableDropPushes(): Promise<"on" | "denied" | "unavailable"> {
  if (!Device.isDevice) return "unavailable"; // simulators can't get push tokens
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return "unavailable"; // set by `eas init` (A12)
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("drop", { name: "Evening drop", importance: Notifications.AndroidImportance.DEFAULT });
  }
  const current = await Notifications.getPermissionsAsync();
  const status = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!status.granted) return "denied";
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  const { error } = await supabase.rpc("register_push_token", { p_token: token, p_platform: Platform.OS === "ios" ? "ios" : "android" });
  return error ? "unavailable" : "on";
}

export async function dropPushesOn(): Promise<boolean> {
  return (await Notifications.getPermissionsAsync()).granted;
}

// Tapping a drop push opens the drop screen, also when it started the app.
export function listenForDropTaps(): () => void {
  const open = (data: unknown) => {
    if ((data as { screen?: string } | undefined)?.screen === "drop") router.push("/drop");
  };
  const last = Notifications.getLastNotificationResponse();
  if (last) {
    open(last.notification.request.content.data);
    Notifications.clearLastNotificationResponse();
  }
  const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
  return () => sub.remove();
}
