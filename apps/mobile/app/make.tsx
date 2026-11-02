import { useCameraPermissions } from "expo-camera";
import { File } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { colors } from "@quest/tokens";
import { pickFromLibrary } from "../src/capture/picker";
import { preparePhoto } from "../src/capture/prepare";
import { CameraAccess, CameraCapture, PhotoPreview } from "../src/capture/screens";
import { draftFile } from "../src/capture/store";
import { useUploads } from "../src/capture/UploadProvider";
import { findQuest } from "../src/today/logic";
import { useToday } from "../src/today/TodayProvider";
import { Button } from "../src/ui/Button";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";

interface Draft {
  bytes: Uint8Array;
  file: File; // shown in the preview; deleted as soon as the teen decides
}

const deleteQuietly = (uri: string) => {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
};

// H23 → H6 → preview. One photo for one quest (PRD R12): from the camera or
// the system photo picker, cropped to 4:5 and cleaned on the phone, then
// saved in the background so it survives a dropped connection.
export default function Make() {
  const { questId } = useLocalSearchParams<{ questId?: string }>();
  const { today } = useToday();
  const uploads = useUploads();
  const quest = findQuest(today, questId);
  const [permission, requestPermission] = useCameraPermissions();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;

  // Leaving without choosing keeps nothing.
  useEffect(() => () => draftRef.current?.file.delete(), []);

  const prepare = async (uri: string) => {
    setBusy(true);
    setError(null);
    try {
      const bytes = await preparePhoto(uri);
      const file = draftFile(`draft-${Crypto.randomUUID()}.jpg`);
      file.create({ overwrite: true });
      await file.write(bytes);
      setDraft({ bytes, file });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't use that photo. Try another.");
    } finally {
      deleteQuietly(uri); // the camera's or picker's own copy
      setBusy(false);
    }
  };

  const fromLibrary = async () => {
    const uri = await pickFromLibrary();
    if (uri) await prepare(uri);
  };

  const retake = () => {
    draft?.file.delete();
    setDraft(null);
    setError(null);
  };

  const use = async () => {
    if (!draft || !quest) return;
    setBusy(true);
    try {
      const makeId = await uploads.save(draft.bytes, { id: quest.id, zone: quest.zone });
      draft.file.delete();
      setDraft(null);
      router.replace({ pathname: "/review/[makeId]", params: { makeId } }); // the coach's review comes here
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't keep this photo. Try again.");
      setBusy(false);
    }
  };

  if (!quest) {
    return (
      <Screen title="Make something" eyebrow="Today's quests" footer={<Button label="Close" variant="secondary" onPress={() => router.back()} />}>
        <Text variant="body" color="text2">
          {today ? "You've made all of today's quests. New ones arrive at midnight." : "Today's quests are loading. Try again in a moment."}
        </Text>
      </Screen>
    );
  }

  if (draft) {
    return <PhotoPreview uri={draft.file.uri} busy={busy} error={error} onUse={() => void use()} onRetake={retake} />;
  }

  if (!permission) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}>
        <ActivityIndicator color={colors.lime} accessibilityLabel="Opening the camera" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <CameraAccess
        blocked={!permission.canAskAgain}
        busy={busy}
        onContinue={() => void requestPermission()}
        onLibrary={() => void fromLibrary()}
      />
    );
  }

  return <CameraCapture quest={quest} busy={busy} error={error} onClose={() => router.back()} onShot={(uri) => void prepare(uri)} onLibrary={() => void fromLibrary()} />;
}
