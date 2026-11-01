import { LEVELS, levelFor } from "@quest/contract";
import { Card, Screen } from "../../src/ui/Screen";
import { Text } from "../../src/ui/Text";

export default function Levels() {
  const example = levelFor(41);
  return (
    <Screen title="Levels" eyebrow="Progress">
      <Card>
        <Text variant="label">
          Level {example.level} · {example.name}
        </Text>
        <Text variant="bodySmall" color="text2">
          {Math.round(example.progress * 100)}% of the way to Level {example.level + 1}. Sample data; real progress comes from
          coach reviews in package A7.
        </Text>
      </Card>
      <Card>
        {LEVELS.map((l) => (
          <Text key={l.level} variant="bodySmall" color="text2">
            Level {l.level} · {l.name} from {l.from} skill points
          </Text>
        ))}
      </Card>
    </Screen>
  );
}
