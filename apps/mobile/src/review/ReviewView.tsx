import { ZONES, lessonById, type ReviewState, type ZoneId } from "@quest/contract";
import { colors, minTouch, radius, space, zoneColors } from "@quest/tokens";
import { useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { ZoneArt } from "../today/parts";
import { Button } from "../ui/Button";
import { ArrowRightIcon, CheckIcon } from "../ui/icons";
import { ErrorText, InfoRow, StepHeader } from "../ui/parts";
import { Screen } from "../ui/Screen";
import { Text } from "../ui/Text";
import { helplines, skillChips } from "./logic";

interface Props {
  state: ReviewState | null;
  zone: ZoneId | null;
  questTitle: string | null;
  photoUrl: string | null;
  country?: string;
  stalled: boolean;
  error: string | null;
  onRate: (helpful: boolean) => void;
  onRetake: () => void;
  onTurnOnCoach: () => void;
  onDone: () => void;
  onRetry: () => void;
}

// H16 (Studio) / H7: the coach's review, and what's shown while it's coming
// or when there isn't one.
export function ReviewView(p: Props) {
  const zoneName = p.zone ? ZONES[p.zone].name : null;
  const footer = <Button label={p.state?.state === "ready" ? "Save to Studio" : "Done"} variant={p.state?.state === "ready" ? "secondary" : "primary"} onPress={p.onDone} />;

  return (
    <Screen title="" header={<StepHeader label="Coach review" />} footer={footer}>
      {p.state?.state === "ready" ? (
        <View>
          {p.photoUrl ? (
            <Image source={{ uri: p.photoUrl }} style={styles.photo} accessibilityLabel="Your photo for this quest" />
          ) : p.zone ? (
            <ZoneArt zone={p.zone} height={220} rounded={radius.card} />
          ) : null}
          <View style={styles.private}>
            <Text variant="micro">Only you can see this</Text>
          </View>
        </View>
      ) : null}
      {zoneName ? (
        <Text variant="caption" color="muted">
          <Text variant="caption" style={{ color: p.zone ? zoneColors[p.zone] : colors.text }}>
            {zoneName}
          </Text>
          {p.questTitle ? ` · ${p.questTitle}` : ""}
        </Text>
      ) : null}
      <Body {...p} />
      <ErrorText message={p.error} />
    </Screen>
  );
}

function Body(p: Props) {
  const s = p.state;
  if (!s || s.state === "pending") {
    return (
      <View style={styles.card} accessibilityLiveRegion="polite">
        {p.stalled ? (
          <>
            <Text variant="subheading">Still working on it</Text>
            <Text variant="bodySmall" color="text2">
              Your coach is taking longer than usual. Your photo is saved, and the review will be here when it's ready.
            </Text>
            <Button label="Check again" variant="secondary" onPress={p.onRetry} />
          </>
        ) : (
          <View style={styles.row}>
            <ActivityIndicator color={colors.lime} />
            <Text variant="body" color="text2" style={{ flex: 1 }}>
              Your coach is looking at your photo. This usually takes under 15 seconds.
            </Text>
          </View>
        )}
      </View>
    );
  }
  if (s.state === "no_consent") {
    return (
      <View style={styles.card}>
        <Text variant="subheading">Coach reviews are off</Text>
        <Text variant="bodySmall" color="text2">
          Your photo is saved in your Studio. Turn coach reviews on to get feedback on it.
        </Text>
        <Button label="Turn on coach reviews" variant="secondary" onPress={p.onTurnOnCoach} />
      </View>
    );
  }
  if (s.state === "retake") {
    return (
      <View style={styles.card}>
        <Text variant="subheading">Try another photo?</Text>
        <Text variant="body" color="text2">
          {s.reason}
        </Text>
        <Button label="Retake" onPress={p.onRetake} />
      </View>
    );
  }
  if (s.state === "unavailable") {
    return (
      <>
        <View style={styles.card}>
          <Text variant="subheading">No review this time</Text>
          <Text variant="bodySmall" color="text2">
            Your coach couldn't finish a review of this one. Here's a short lesson for this quest instead.
          </Text>
        </View>
        <LessonCard lessonId={s.lessonId} open />
      </>
    );
  }
  if (s.state === "held") {
    return (
      <View style={styles.card}>
        <Text variant="subheading">This one is with our safety team</Text>
        <Text variant="bodySmall" color="text2">
          It won't get a review. If anything is worrying you, you can talk to someone right now. It's free and private.
        </Text>
        {helplines(p.country).map((h) => (
          <Pressable key={h.label} accessibilityRole="link" onPress={() => void Linking.openURL(h.url)} style={[styles.helpline, { minHeight: minTouch(Platform.OS) }]}>
            <Text variant="label">{h.label}</Text>
            <Text variant="caption" color="lime">
              {h.how}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }

  const r = s.review;
  const chips = skillChips(r);
  const target = minTouch(Platform.OS);
  return (
    <>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.badge, { backgroundColor: colors.lime }]}>
            <CheckIcon color={colors.limeInk} size={16} strokeWidth={3} />
          </View>
          <Text variant="subheading" accessibilityRole="header">
            What worked
          </Text>
        </View>
        <Text variant="body" color="text2">
          {r.worked}
        </Text>
        {chips.length ? (
          <View style={styles.chips}>
            {chips.map((c) => (
              <View key={c} style={styles.chip} accessibilityLabel={`${c.replace("+", "plus ")} skill points`}>
                <Text variant="label" color="lime">
                  ↑ {c}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.badge, { backgroundColor: zoneColors.photography }]}>
            <ArrowRightIcon color={colors.limeInk} size={16} strokeWidth={3} />
          </View>
          <Text variant="subheading" accessibilityRole="header">
            Try next time
          </Text>
        </View>
        <Text variant="body" color="text2">
          {r.tryNext}
        </Text>
        <Text variant="bodySmall" color="muted">
          {r.why}
        </Text>
        <LessonCard lessonId={r.lessonId} />
      </View>

      {r.question ? (
        <InfoRow text={`Something to think about: ${r.question}`} />
      ) : null}

      <View style={[styles.row, { justifyContent: "space-between" }]}>
        <Text variant="caption" color="muted">
          Was this helpful?
        </Text>
        <View style={styles.row}>
          {([
            [true, "Yes"],
            [false, "Not really"],
          ] as const).map(([value, label]) => (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityState={{ selected: s.helpful === value }}
              onPress={() => p.onRate(value)}
              style={[styles.pill, { minHeight: target }, s.helpful === value ? styles.pillOn : null]}
            >
              <Text variant="label" color={s.helpful === value ? "limeInk" : "text"}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </>
  );
}

function LessonCard({ lessonId, open: startOpen = false }: { lessonId: string | null; open?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const lesson = lessonById(lessonId);
  if (!lesson) return null;
  return (
    <View style={{ gap: space.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={[styles.lessonButton, { minHeight: minTouch(Platform.OS) }]}
      >
        <Text variant="label" color="lime">
          ▶
        </Text>
        <Text variant="label">
          Lesson: {lesson.title} · {lesson.seconds} sec
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.lesson}>
          {lesson.steps.map((step, i) => (
            <Text key={step} variant="bodySmall" color="text2">
              {i + 1}. {step}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { width: "100%", aspectRatio: 4 / 5, maxHeight: 280, borderRadius: radius.card, backgroundColor: colors.surface },
  private: { position: "absolute", left: space.sm, bottom: space.sm, backgroundColor: colors.bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.card, padding: space.md, gap: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.xs },
  badge: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: space.xxs },
  chip: { backgroundColor: colors.limeTint, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 10 },
  lessonButton: { flexDirection: "row", alignItems: "center", gap: space.xs, alignSelf: "flex-start", backgroundColor: colors.surface2, borderRadius: radius.pill, paddingHorizontal: 16 },
  lesson: { backgroundColor: colors.surface2, borderRadius: radius.md, padding: space.sm, gap: space.xxs },
  pill: { borderRadius: radius.pill, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 },
  pillOn: { backgroundColor: colors.lime },
  helpline: { backgroundColor: colors.surface2, borderRadius: radius.md, padding: space.sm, gap: 2, justifyContent: "center" },
});
