import type { Today } from "@quest/contract";
import type { PendingMake } from "../capture/queue";
import { pendingLabel } from "../capture/queue";
import { Text } from "../ui/Text";
import { Screen } from "../ui/Screen";
import { dayHeading, splitZones, weekRow } from "./logic";
import { AllDoneCard, QuestCard, QuestRow, StreakPill, StudioNote, WeekRow, type RowSaving } from "./parts";

interface Props {
  today: Today;
  studio: boolean;
  error?: string | null;
  saving?: PendingMake[]; // photos on their way to the server (A3)
  onOpen: (questId: string) => void;
  onReview?: (makeId: string) => void;
  onRetry?: () => void;
  onDiscard?: (makeId: string) => void;
}

// H15 (Studio) / H5, drawn from a Today payload.
export function TodayView({ today, studio, error, saving = [], onOpen, onReview, onRetry = () => undefined, onDiscard = () => undefined }: Props) {
  const savingIds = new Set(saving.map((p) => p.questId));
  const { main, rest } = splitZones(today.zones, savingIds);
  const allDone = today.zones.length > 0 && today.zones.every((z) => z.madeToday || (z.quest && savingIds.has(z.quest.id)));
  const rowSaving = (questId: string | undefined): RowSaving | undefined => {
    const p = saving.find((s) => s.questId === questId);
    return p ? { label: pendingLabel(p), failed: p.stage === "failed", onRetry, onDiscard: () => onDiscard(p.makeId) } : undefined;
  };
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
        <QuestRow key={z.zone} zone={z} onOpen={(q) => onOpen(q.id)} onReview={onReview} saving={z.madeToday ? undefined : rowSaving(z.quest?.id)} />
      ))}
    </Screen>
  );
}
