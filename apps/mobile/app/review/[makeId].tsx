import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Alert } from "react-native";
import { supabase } from "../../src/lib/supabase";
import { useCallback, useEffect } from "react";
import { useUploads } from "../../src/capture/UploadProvider";
import { useAccount } from "../../src/lib/account";
import { ReviewView } from "../../src/review/ReviewView";
import { useReview } from "../../src/review/useReview";
import { showLevelUpIfAny } from "../../src/studio/levelUp";
import { findQuest } from "../../src/today/logic";
import { useToday } from "../../src/today/TodayProvider";

// The coach's review of one make (H16). Opened from Today, or straight after
// "Use photo" while the photo is still on its way.
export default function ReviewScreen() {
  const { makeId } = useLocalSearchParams<{ makeId: string }>();
  const { teen } = useAccount();
  const { today, refresh: refreshToday } = useToday();
  const { pending } = useUploads();
  const { state, photoUrl, family, stalled, error, rate, retry, loadFamily } = useReview(makeId, teen?.id);

  const onToday = today?.zones.find((z) => z.make?.id === makeId);
  const saving = pending.find((p) => p.makeId === makeId);
  const quest = onToday?.quest ?? findQuest(today, saving?.questId) ?? null;

  // Back from turning coach reviews on: look again.
  useFocusEffect(
    useCallback(() => {
      if (state?.state === "no_consent") retry();
      if (state?.state === "ready") void loadFamily(); // back from sending to family
    }, [state?.state, retry, loadFamily]),
  );

  // A finished review changes points and levels on Today.
  useEffect(() => {
    if (state?.state === "ready") {
      void refreshToday();
      void showLevelUpIfAny();
    }
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
      family={family}
      onSendFamily={() => router.push({ pathname: "/send-family/[makeId]", params: { makeId } })}
      onDelete={() =>
        Alert.alert("Delete this make?", "The photo and its review are deleted, and its points come off your level. Postcards stay.", [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              const { data: path, error: delError } = await supabase.rpc("delete_make", { p_make_id: makeId });
              if (delError || typeof path !== "string") return Alert.alert("Couldn't delete it", "Check your connection and try again.");
              await supabase.storage.from("makes").remove([path]);
              void refreshToday();
              router.back();
            },
          },
        ])
      }
    />
  );
}
