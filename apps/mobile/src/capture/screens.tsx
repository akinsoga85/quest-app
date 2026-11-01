import type { TodayQuest } from "@quest/contract";
import { colors, minTouch, radius, space } from "@quest/tokens";
import { CameraView, type CameraType } from "expo-camera";
import { useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { Button } from "../ui/Button";
import { AlertIcon, CloseIcon, FlipIcon, ImageIcon } from "../ui/icons";
import { NumberedSteps, InfoRow, StepHeader, ErrorText } from "../ui/parts";
import { Screen } from "../ui/Screen";
import { Text } from "../ui/Text";

// H23: shown before the system asks for the camera, and again (with a way to
// Settings) if the camera was turned off.
export function CameraAccess({ blocked, busy, onContinue, onLibrary }: { blocked: boolean; busy: boolean; onContinue: () => void; onLibrary: () => void }) {
  return (
    <Screen
      title="Camera, only when you tap"
      titleSize="title"
      header={
        <>
          <StepHeader label="Before your first photo" />
          <Glow />
        </>
      }
      footer={
        <>
          {blocked ? (
            <Button label="Open Settings" onPress={() => void Linking.openSettings()} />
          ) : (
            <Button label="Continue" onPress={onContinue} disabled={busy} />
          )}
          <Button label="Use my photo library" variant="secondary" onPress={onLibrary} disabled={busy} />
        </>
      }
    >
      <Text variant="body" color="text2">
        {blocked
          ? "The camera is turned off for this app. Turn it on in Settings, or pick a photo from your library instead."
          : "You take one photo a day for your quest. The camera opens only when you tap it, and nothing is kept until you choose."}
      </Text>
      <NumberedSteps
        steps={[
          "Location data is removed from every photo",
          "Prefer your library? The system picker shares only the photo you choose",
          "Faces, names and addresses are checked before anything is shared",
        ]}
      />
      <InfoRow text="You can change this in Settings" action="Settings" onAction={() => void Linking.openSettings()} />
    </Screen>
  );
}

function Glow() {
  return (
    <View style={styles.glow} accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="g" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor="#FFE2B0" stopOpacity="1" />
            <Stop offset="0.35" stopColor="#E8964A" stopOpacity="0.85" />
            <Stop offset="1" stopColor="#1B2236" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="#141824" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#g)" />
      </Svg>
    </View>
  );
}

// H6: the camera, 4:5, with the quest's title and a reminder about privacy.
export function CameraCapture({
  quest,
  busy,
  error,
  onClose,
  onShot,
  onLibrary,
}: {
  quest: TodayQuest;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onShot: (uri: string) => void;
  onLibrary: () => void;
}) {
  const camera = useRef<CameraView>(null);
  const [facing, setFacing] = useState<CameraType>("back");
  const [ready, setReady] = useState(false);
  const target = minTouch(Platform.OS);

  const shoot = async () => {
    if (!camera.current || busy) return;
    const photo = await camera.current.takePictureAsync({ quality: 1, exif: false, skipProcessing: false });
    if (photo?.uri) onShot(photo.uri);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close camera" onPress={onClose} style={[styles.round, { width: target, height: target }]}>
          <CloseIcon color={colors.text} size={20} />
        </Pressable>
        <Text variant="label" style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
          {quest.title}
        </Text>
        <View style={{ width: target }} />
      </View>

      <View style={styles.finder}>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing={facing} mode="picture" mute animateShutter onCameraReady={() => setReady(true)} />
        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.lime} accessibilityLabel="Getting your photo ready" />
          </View>
        ) : null}
      </View>

      <View style={styles.note}>
        <AlertIcon color={colors.lime} size={18} />
        <Text variant="caption" color="text2" style={{ flex: 1 }}>
          Keep faces, names and addresses out of the shot
        </Text>
      </View>
      {error ? (
        <View style={{ paddingHorizontal: space.screenSide }}>
          <ErrorText message={error} />
        </View>
      ) : null}

      <View style={styles.controls}>
        <Pressable accessibilityRole="button" accessibilityLabel="Choose from your photo library" onPress={onLibrary} disabled={busy} style={[styles.library, { minWidth: target, minHeight: target }]}>
          <ImageIcon color={colors.text} size={24} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          accessibilityState={{ disabled: busy || !ready }}
          disabled={busy || !ready}
          onPress={() => void shoot()}
          style={({ pressed }) => [styles.shutter, { opacity: busy || !ready ? 0.5 : pressed ? 0.8 : 1 }]}
        >
          <View style={styles.shutterInner} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={facing === "back" ? "Switch to the front camera" : "Switch to the back camera"}
          onPress={() => setFacing(facing === "back" ? "front" : "back")}
          disabled={busy}
          style={[styles.round, { width: target, height: target }]}
        >
          <FlipIcon color={colors.text} size={20} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// After the shot: keep it or take another. Nothing is saved until "Use photo".
export function PhotoPreview({ uri, busy, error, onUse, onRetake }: { uri: string; busy: boolean; error: string | null; onUse: () => void; onRetake: () => void }) {
  return (
    <Screen
      title="Use this photo?"
      titleSize="title"
      footer={
        <>
          <ErrorText message={error} />
          <Button label="Use photo" onPress={onUse} disabled={busy} />
          <Button label="Retake" variant="secondary" onPress={onRetake} disabled={busy} />
        </>
      }
    >
      <Image source={{ uri }} style={styles.preview} accessibilityLabel="The photo you just took" />
      <Text variant="caption" color="muted">
        Cropped to 4:5, with location and camera details removed.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.screenSide, paddingTop: space.xs, gap: space.xs },
  headerTitle: { flex: 1, textAlign: "center" },
  round: { borderRadius: radius.pill, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  finder: {
    marginTop: space.md,
    marginHorizontal: space.screenSide,
    aspectRatio: 4 / 5,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  busy: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(15,15,17,0.55)" },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    marginTop: space.md,
    marginHorizontal: space.screenSide,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  controls: {
    marginTop: "auto",
    marginBottom: space.lg,
    paddingHorizontal: space.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  library: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  shutter: { width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: colors.lime, alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.text },
  glow: { height: 150, borderRadius: radius.card, overflow: "hidden", marginTop: space.md },
  preview: { width: "100%", aspectRatio: 4 / 5, borderRadius: 24, backgroundColor: colors.surface },
});
