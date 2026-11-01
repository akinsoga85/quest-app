import { router } from "expo-router";
import { Button } from "../src/ui/Button";
import { Card, Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";

export default function Make() {
  return (
    <Screen title="Make something" eyebrow="Today's quest">
      <Card>
        <Text variant="label">Camera, only when you tap</Text>
        <Text variant="bodySmall" color="text2">
          The camera and photo picker arrive in package A3 (capture and upload).
        </Text>
      </Card>
      <Button label="Close" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
