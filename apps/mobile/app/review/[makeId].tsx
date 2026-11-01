import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect } from "react";
import { useUploads } from "../../src/capture/UploadProvider";
import { useAccount } from "../../src/lib/account";
import { ReviewView } from "../../src/review/ReviewView";
import { useReview } from "../../src/review/useReview";
import { findQuest } from "../../src/today/logic";
import { useToday } from "../../src/today/TodayProvider";

// The coach's review of one make (H16). Opened from Today, or straight after
// "Use photo" while the photo is still on its way.
export default function ReviewScreen() {
  const { makeId } = useLocalSearchParams<{ makeId: string }>();
  const { teen } = useAccount();
  const { today, refresh: refreshToday } = useToday();
  const { pending } = useUploads();
  const { state, photoUrl, stalled, error, rate, retry } = useReview(makeId, teen?.id);

  const onToday = today?.zones.find((z) => z.make?.id === makeId);
  const saving = pending.find((p) => p.makeId === makeId);
  const quest = onToday?.quest ?? findQuest(today, saving?.questId) ?? null;

  // Back from turning coach reviews on: look again.
  useFocusEffect(
    useCallback(() => {
      if (state?.state === "no_consent") retry();
    }, [state?.state, retry]),
  );

  // A finished review changes points and levels on Today.
  useEffect(() => {
    if (state?.state === "ready") void refreshToday();
  }, [state?.state, refreshToday]);

  return (
    <ReviewView
      state={state}
      zone={onToday?.zone ?? saving?.zone ?? quest?.zone ?? null}
      questTitle={quest?.title ?? null}
      photoUrl={photoUrl}
      country={teen?.country}
      stalled={stalled}
      error={error}
      onRate={(helpful) => void rate(helpful)}
      onRetake={() => (quest ? router.replace({ pathname: "/make", params: { questId: quest.id } }) : router.back())}
      onTurnOnCoach={() => router.push("/ai-consent")}
      onDone={() => router.back()}
      onRetry={retry}
    />
  );
}
