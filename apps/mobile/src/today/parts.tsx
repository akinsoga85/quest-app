import { ZONES, type TodayQuest, type TodayZone, type ZoneId } from "@quest/contract";
import { colors, minTouch, radius, space, zoneColors } from "@quest/tokens";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { Button } from "../ui/Button";
import { AlertIcon, ArrowRightIcon, CheckIcon, ClockIcon, FlameIcon, LockIcon } from "../ui/icons";
import { Text } from "../ui/Text";
import { makeStatusLabel } from "../review/logic";
import {
  questMeta,
  streakAccessibilityLabel,
  streakLabel,
  weekAccessibilityLabel,
  weekCaption,
  zoneLine,
  type WeekDot,
} from "./logic";

// Quests have no photos of their own, so each zone gets a striped panel in its
// colour where Figma shows a sample photo.
export function ZoneArt({ zone, height, width = "100%", rounded = 0 }: { zone: ZoneId; height: number; width?: number | `${number}%`; rounded?: number }) {
  const stripes = zone === "fashion" ? 6 : 10;
  return (
    <View style={{ width, height, borderRadius: rounded, overflow: "hidden", backgroundColor: colors.surface2 }} accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        {Array.from({ length: stripes }, (_, i) => (
          <Rect key={i} x={(i * 100) / stripes} y={0} width={50 / stripes} height={100} fill={zoneColors[zone]} opacity={0.85} />
        ))}
      </Svg>
    </View>
  );
}

export function StreakPill({ weeks }: { weeks: number }) {
  return (
    <View style={styles.streak} accessible accessibilityLabel={streakAccessibilityLabel(weeks)}>
      <FlameIcon color={colors.lime} size={18} />
      <Text variant="label" color="lime">
        {streakLabel(weeks)}
      </Text>
    </View>
  );
}

export function WeekRow({ dots, streakWeeks }: { dots: WeekDot[]; streakWeeks: number }) {
  const made = dots.filter((d) => d.made).length;
  return (
    <View style={{ gap: space.xs }}>
      <View style={styles.week} accessible accessibilityLabel={weekAccessibilityLabel(dots)}>
        {dots.map((d) => (
          <View key={d.day} style={styles.dayCol}>
            <Text variant="micro" color={d.isToday ? "text" : "muted"}>
              {d.letter}
            </Text>
            <View style={[styles.dot, d.made ? styles.dotMade : d.isToday ? styles.dotToday : styles.dotEmpty]}>
              {d.made ? <CheckIcon color={colors.limeInk} size={16} strokeWidth={3} /> : null}
            </View>
          </View>
        ))}
      </View>
      <Text variant="caption" color="muted">
        {weekCaption(made, streakWeeks)}
      </Text>
    </View>
  );
}

export function StudioNote() {
  return (
    <View style={styles.note}>
      <LockIcon color={colors.text2} size={16} />
      <Text variant="caption" color="text2" style={{ flex: 1 }}>
        Studio: just for you and your family
      </Text>
    </View>
  );
}

// The big card (H15): the next quest to do.
export function QuestCard({ zone, quest, onStart }: { zone: TodayZone; quest: TodayQuest; onStart: () => void }) {
  return (
    <View style={styles.card}>
      <View>
        <ZoneArt zone={zone.zone} height={128} />
        <View style={styles.chip}>
          <Text variant="micro" style={{ color: zoneColors[zone.zone] }}>
            {zoneLine(zone.zone, zone.points)}
          </Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text variant="eyebrow" color="muted">
          {questMeta(quest).toUpperCase()}
        </Text>
        <Text variant="heading" accessibilityRole="header">
          {quest.title}
        </Text>
        <Text variant="body" color="text2">
          {quest.brief}
        </Text>
        {zone.make?.status === "retake" ? (
          <Text variant="bodySmall" color="lime">
            Your coach asked for another photo. Tap to see why, or just retake it.
          </Text>
        ) : null}
        <Button label={zone.make?.status === "retake" ? "Retake" : "Start quest"} onPress={onStart} />
      </View>
    </View>
  );
}

export interface RowSaving {
  label: string; // "Saving your photo…", or why it couldn't be saved
  failed: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}

// A smaller row for the other zones: to do, saving, done today, or not ready yet.
export function QuestRow({
  zone,
  onOpen,
  onReview,
  saving,
}: {
  zone: TodayZone;
  onOpen: (quest: TodayQuest) => void;
  onReview?: (makeId: string) => void;
  saving?: RowSaving;
}) {
  const { quest } = zone;
  const name = ZONES[zone.zone].name;
  const open = quest !== null && !zone.madeToday && !saving;
  const title = quest ? quest.title : `Today's ${name} quest is on its way`;
  const made = zone.madeToday && zone.make ? zone.make : null;
  const status = made
    ? (makeStatusLabel(made.status) ?? "Done today")
    : zone.madeToday
      ? "Done today"
      : saving
        ? saving.label
        : quest
          ? `About ${quest.minutes} minutes`
          : "Check back soon";
  const target = minTouch(Platform.OS);

  const badge = zone.madeToday ? (
    <View style={[styles.round, styles.roundDone, { width: target, height: target }]}>
      <CheckIcon color={colors.limeInk} size={20} strokeWidth={3} />
    </View>
  ) : saving ? (
    <View style={[styles.round, { width: target, height: target }]}>
      {saving.failed ? <AlertIcon color={colors.danger} size={20} /> : <ClockIcon color={colors.lime} size={20} />}
    </View>
  ) : quest ? (
    <View style={[styles.round, { width: target, height: target }]}>
      <ArrowRightIcon color={colors.text} size={20} />
    </View>
  ) : null;

  const content = (
    <>
      <ZoneArt zone={zone.zone} height={60} width={60} rounded={radius.sm} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="micro" style={{ color: zoneColors[zone.zone] }}>
          {zoneLine(zone.zone, zone.points)}
        </Text>
        <Text variant="subheading">{title}</Text>
        {!open ? (
          <Text variant="caption" color={saving?.failed ? "danger" : "muted"} accessibilityLiveRegion="polite">
            {status}
          </Text>
        ) : null}
      </View>
      {badge}
    </>
  );

  if (saving?.failed) {
    return (
      <View style={[styles.row, { flexDirection: "column", alignItems: "stretch" }]}>
        <View style={styles.rowInner} accessible accessibilityLabel={`${name}: ${title}. ${status}`}>
          {content}
        </View>
        <View style={{ flexDirection: "row", gap: space.xs }}>
          <View style={{ flex: 1 }}>
            <Button label="Try again" variant="secondary" onPress={saving.onRetry} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Discard photo" variant="secondary" onPress={saving.onDiscard} />
          </View>
        </View>
      </View>
    );
  }
  if (made && onReview) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}: ${title}. ${status}.`}
        accessibilityHint="Opens your coach review"
        onPress={() => onReview(made.id)}
        style={({ pressed }) => [styles.row, { opacity: pressed ? 0.85 : 1 }]}
      >
        {content}
      </Pressable>
    );
  }
  if (!open || !quest) {
    return (
      <View style={styles.row} accessible accessibilityLabel={`${name}: ${title}. ${status}.`}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name} quest: ${title}. ${status}.`}
      accessibilityHint="Opens the camera for this quest"
      onPress={() => onOpen(quest)}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.85 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

export function AllDoneCard() {
  return (
    <View style={[styles.card, styles.cardBody]}>
      <Text variant="heading" accessibilityRole="header">
        All done for today
      </Text>
      <Text variant="body" color="text2">
        You made every quest in your zones. New ones arrive at midnight.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  streak: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.limeTint,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  week: { flexDirection: "row", justifyContent: "space-between" },
  dayCol: { alignItems: "center", gap: 6 },
  dot: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  dotMade: { backgroundColor: colors.lime },
  dotToday: { borderWidth: 2, borderColor: colors.lime },
  dotEmpty: { backgroundColor: colors.surface2 },
  note: { flexDirection: "row", alignItems: "center", gap: space.xs, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: space.xs },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.card, overflow: "hidden" },
  cardBody: { padding: 18, gap: space.xs },
  chip: { position: "absolute", top: space.sm, left: space.sm, backgroundColor: colors.bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: 14,
  },
  rowInner: { flexDirection: "row", alignItems: "center", gap: space.sm },
  round: { borderRadius: radius.pill, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  roundDone: { backgroundColor: colors.lime },
});
