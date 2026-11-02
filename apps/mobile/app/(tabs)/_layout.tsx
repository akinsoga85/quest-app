import { Tabs } from "expo-router";
import { useAgeRecheck } from "../../src/onboarding/useAgeRecheck";
import { TabBar } from "../../src/ui/TabBar";

export default function TabsLayout() {
  useAgeRecheck();
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: "Today" }} />
      <Tabs.Screen name="studio" options={{ title: "Studio" }} />
      <Tabs.Screen name="levels" options={{ title: "Levels" }} />
      <Tabs.Screen name="you" options={{ title: "You" }} />
    </Tabs>
  );
}
