import { Api, DELETION_DAYS, ZONES, type PlusStatus } from "@quest/contract";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { pendingInvite, useAccount } from "../../src/lib/account";
import { signOut } from "../../src/lib/auth";
import { supabase } from "../../src/lib/supabase";
import { Button } from "../../src/ui/Button";
import { Card, Screen } from "../../src/ui/Screen";
import { Text } from "../../src/ui/Text";
import { ErrorText } from "../../src/ui/parts";

const BRACKET_LABEL = { "13_15": "13–15", "16_17": "16–17", "18_19": "18–19" } as const;

// Sign-in, zones (A2), coach consent and parent link (A1). The full Settings screen,
// with download and delete, comes in A11 (Figma H20a / H21).
export default function You() {
  const { teen, parentLinks, zones, refresh } = useAccount();
  const [error, setError] = useState<string | null>(null);
  const [plus, setPlus] = useState<PlusStatus | null>(null);

  useFocusEffect(
    useCallback(() => {
      void supabase.rpc("plus_status").then(({ data }) => setPlus(Api["plus.status"].output.safeParse(data).data ?? null));
    }, []),
  );
  const linked = parentLinks.some((l) => l.status === "active");
  const waiting = pendingInvite(parentLinks) !== null;

  const coachOff = async () => {
    setError(null);
    const { error: rpcError } = await supabase.rpc("set_ai_coach_consent", { p_allow: false });
    if (rpcError) setError(rpcError.message);
    await refresh();
  };

  return (
    <Screen title="Settings" eyebrow="You">
      <Card>
        <Text variant="label">{teen?.handle ?? "Signed in"}</Text>
        <Text variant="bodySmall" color="text2">
          {teen ? `Ages ${BRACKET_LABEL[teen.ageBracket]} · ${teen.mode === "studio" ? "Studio" : "Walls"}` : ""}
        </Text>
      </Card>

      <Card>
        <Text variant="label">Your zones</Text>
        <Text variant="bodySmall" color="text2">
          {zones.map((z) => ZONES[z].name).join(", ") || "None picked yet."} Swap any time; your levels stay.
        </Text>
        <Button label="Change zones" variant="secondary" onPress={() => router.push("/edit-zones")} />
      </Card>

      <Card>
        <Text variant="label">Plus</Text>
        <Text variant="bodySmall" color="text2">
          {plus?.active
            ? `On${plus.until ? ` until ${plus.until.slice(0, 10)}` : ""}: deeper coaching and a second take on each quest.`
            : plus?.canBuyInApp
              ? "Deeper coaching and a second take on each quest. Plus in the app arrives with the store release."
              : "Deeper coaching and a second take on each quest. A parent can start Plus on their parent page."}
        </Text>
      </Card>

      <Card>
        <Text variant="label">AI coach reviews</Text>
        <Text variant="bodySmall" color="text2">
          {teen?.aiCoachConsent ? "On. Your photos go to the coach for feedback." : "Off. You still get quests and levels."}
        </Text>
        {teen?.aiCoachConsent ? (
          <Button label="Turn off" variant="secondary" onPress={coachOff} />
        ) : (
          <Button label="Turn on" variant="secondary" onPress={() => router.push("/ai-consent")} />
        )}
      </Card>

      <Card>
        <Text variant="label">Parent link</Text>
        <Text variant="bodySmall" color="text2">
          {linked ? "Connected." : waiting ? "Waiting for your parent to say yes." : "No parent linked yet."}
        </Text>
        {!linked ? <Button label="Send link to a parent" variant="secondary" onPress={() => router.push("/invite-parent")} /> : null}
      </Card>

      <ErrorText message={error} />
      <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      <Text variant="caption" color="muted">
        Download my work and delete my account arrive with Settings. Deleting removes everything within {DELETION_DAYS} days.
      </Text>
    </Screen>
  );
}
