import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator } from "react-native";
import { colors } from "@quest/tokens";
import { useAccount } from "../../src/lib/account";
import { supabaseConfigured } from "../../src/lib/supabase";
import { TodayView } from "../../src/today/TodayView";
import { useToday } from "../../src/today/TodayProvider";
import { Button } from "../../src/ui/Button";
import { Card, Screen } from "../../src/ui/Screen";
import { Text } from "../../src/ui/Text";

const openQuest = (questId: string) => router.push({ pathname: "/make", params: { questId } });

// H15 (Studio) / H5: today's quest in each of the teen's zones, the week so
// far and the gentle streak. Everything is by the teen's local day.
export default function TodayScreen() {
  const { teen } = useAccount();
  const { today, loading, error, refresh } = useToday();

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  if (!supabaseConfigured) {
    return (
      <Screen title="Today">
        <Card>
          <Text variant="label">Not connected yet</Text>
          <Text variant="bodySmall" color="text2">
            Copy .env.example to .env and add the Supabase project's URL and anon key.
          </Text>
        </Card>
      </Screen>
    );
  }

  if (!today) {
    return (
      <Screen title="Today">
        {error ? (
          <Card>
            <Text variant="bodySmall" color="text2" accessibilityRole="alert">
              {error}
            </Text>
            <Button label="Try again" variant="secondary" onPress={() => void refresh()} disabled={loading} />
          </Card>
        ) : (
          <ActivityIndicator color={colors.lime} accessibilityLabel="Loading today's quests" />
        )}
      </Screen>
    );
  }

  return <TodayView today={today} studio={teen?.mode === "studio"} error={error} onOpen={openQuest} />;
}
