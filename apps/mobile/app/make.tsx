import { ZONES } from "@quest/contract";
import { zoneColors } from "@quest/tokens";
import { router, useLocalSearchParams } from "expo-router";
import { findQuest } from "../src/today/logic";
import { useToday } from "../src/today/TodayProvider";
import { Button } from "../src/ui/Button";
import { Card, Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";

// The quest's brief stays on screen while making (PRD R12). The camera and
// photo picker arrive in A3 (capture and upload).
export default function Make() {
  const { questId } = useLocalSearchParams<{ questId?: string }>();
  const { today } = useToday();
  const quest = findQuest(today, questId);

  return (
    <Screen
      title={quest ? quest.title : "Make something"}
      eyebrow={quest ? `${ZONES[quest.zone].name} · about ${quest.minutes} min` : "Today's quests"}
      footer={<Button label="Close" variant="secondary" onPress={() => router.back()} />}
    >
      {quest ? (
        <>
          <Text variant="body" color="text2">
            {quest.brief}
          </Text>
          {quest.tips.map((tip) => (
            <Text key={tip} variant="bodySmall" style={{ color: zoneColors[quest.zone] }}>
              • {tip}
            </Text>
          ))}
        </>
      ) : (
        <Text variant="body" color="text2">
          You've made all of today's quests. New ones arrive at midnight.
        </Text>
      )}
      <Card>
        <Text variant="label">Camera, only when you tap</Text>
        <Text variant="bodySmall" color="text2">
          The camera and photo picker arrive in package A3 (capture and upload).
        </Text>
      </Card>
    </Screen>
  );
}
