import { Card, Screen } from "../../src/ui/Screen";
import { Text } from "../../src/ui/Text";

export default function Studio() {
  return (
    <Screen title="Studio" eyebrow="Your work">
      <Card>
        <Text variant="label">Everything you've made</Text>
        <Text variant="bodySmall" color="text2">
          Only you and your family see your Studio. Built in package A7 (portfolio, skills, levels).
        </Text>
      </Card>
    </Screen>
  );
}
