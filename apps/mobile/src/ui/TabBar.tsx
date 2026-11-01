import { colors, minTouch, radius, space } from "@quest/tokens";
import { router, type Tabs } from "expo-router";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HomeIcon, LevelsIcon, PlusIcon, StudioIcon, YouIcon } from "./icons";
import { Text } from "./Text";

type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>>[0];

const ICONS: Record<string, typeof HomeIcon> = {
  index: HomeIcon,
  studio: StudioIcon,
  levels: LevelsIcon,
  you: YouIcon,
};

// The Studio tab bar from Figma (HF/TabBar/Studio): Today, Studio, +, Levels, You.
export function TabBar({ state, descriptors, emitter, navigateToTab }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const target = minTouch(Platform.OS);

  const tabs = state.routes.map((route, index) => {
    const focused = state.index === index;
    const label = descriptors[route.key]?.options.title ?? route.name;
    const Icon = ICONS[route.name] ?? HomeIcon;
    const color = focused ? colors.text : colors.muted;
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={label}
        onPress={() => {
          const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        }}
        style={[styles.tab, { minHeight: target, minWidth: target }]}
      >
        <Icon color={color} size={20} />
        <Text variant="micro" color={focused ? "text" : "muted"}>
          {label}
        </Text>
      </Pressable>
    );
  });

  const make = (
    <Pressable
      key="make"
      accessibilityRole="button"
      accessibilityLabel="Make something"
      onPress={() => router.push("/make")}
      style={[styles.make, { minHeight: target }]}
    >
      <PlusIcon color={colors.limeInk} size={24} strokeWidth={2.5} />
    </Pressable>
  );

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.xs) }]}>
      {tabs.slice(0, 2)}
      {make}
      {tabs.slice(2)}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingTop: space.xs,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tab: { alignItems: "center", justifyContent: "center", gap: 3, paddingHorizontal: space.xxs },
  make: {
    width: 56,
    borderRadius: radius.card,
    backgroundColor: colors.lime,
    alignItems: "center",
    justifyContent: "center",
  },
});
