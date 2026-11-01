import { ZONES, type ZoneId } from "@quest/contract";
import { zoneColors } from "@quest/tokens";
import { View } from "react-native";
import { supabaseConfigured } from "../../src/lib/supabase";
import { Card, Screen } from "../../src/ui/Screen";
import { Text } from "../../src/ui/Text";

const liveZones = (Object.keys(ZONES) as ZoneId[]).filter((z) => ZONES[z].status === "live");

export default function Today() {
  return (
    <Screen title="Today" eyebrow="Daily quests">
      {!supabaseConfigured ? (
        <Card>
          <Text variant="label">Not connected yet</Text>
          <Text variant="bodySmall" color="text2">
            Copy .env.example to .env and add the Supabase project's URL and anon key.
          </Text>
        </Card>
      ) : null}
      {liveZones.map((zone) => (
        <Card key={zone}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: zoneColors[zone] }} />
            <Text variant="eyebrow" color="muted">
              {ZONES[zone].name.toUpperCase()}
            </Text>
          </View>
          <Text variant="subheading">Today's quest loads here</Text>
          <Text variant="bodySmall" color="text2">
            Built in package A2 (quests and Today).
          </Text>
        </Card>
      ))}
    </Screen>
  );
}
