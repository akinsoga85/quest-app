import { DELETION_DAYS } from "@quest/contract";
import { Card, Screen } from "../../src/ui/Screen";
import { Text } from "../../src/ui/Text";

export default function You() {
  return (
    <Screen title="Settings" eyebrow="You">
      <Card>
        <Text variant="label">Settings and privacy</Text>
        <Text variant="bodySmall" color="text2">
          AI coach switch, download my work and delete my account. Deleting removes everything within {DELETION_DAYS} days. Built in
          packages A1 and A11 (Figma H20a).
        </Text>
      </Card>
    </Screen>
  );
}
