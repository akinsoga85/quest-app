import type { Today } from "@quest/contract";
import { Text } from "../ui/Text";
import { Screen } from "../ui/Screen";
import { dayHeading, splitZones, weekRow } from "./logic";
import { AllDoneCard, QuestCard, QuestRow, StreakPill, StudioNote, WeekRow } from "./parts";

// H15 (Studio) / H5, drawn from a Today payload.
export function TodayView({ today, studio, error, onOpen }: { today: Today; studio: boolean; error?: string | null; onOpen: (questId: string) => void }) {
  const { main, rest } = splitZones(today.zones);
  const allDone = today.zones.length > 0 && today.zones.every((z) => z.madeToday);
  return (
    <Screen title="Today" dateline={dayHeading(today.day)} aside={<StreakPill weeks={today.streakWeeks} />}>
      <WeekRow dots={weekRow(today)} streakWeeks={today.streakWeeks} />
      {studio ? <StudioNote /> : null}
      {error ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {main?.quest ? <QuestCard zone={main} quest={main.quest} onStart={() => onOpen(main.quest!.id)} /> : null}
      {!main && allDone ? <AllDoneCard /> : null}
      {rest.map((z) => (
        <QuestRow key={z.zone} zone={z} onOpen={(q) => onOpen(q.id)} />
      ))}
    </Screen>
  );
}
