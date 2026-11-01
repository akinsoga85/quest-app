import { router } from "expo-router";
import { useState } from "react";
import { useAccount } from "../src/lib/account";
import { supabase } from "../src/lib/supabase";
import { Button } from "../src/ui/Button";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { ErrorText, InfoRow, NumberedSteps, StepHeader } from "../src/ui/parts";

// H22: Apple guideline 5.1.2(i) asks apps to say what goes to a third-party AI,
// who gets it, and to ask first. Shown before the first coach review (A4) and
// from Settings. The wording must match the AI provider's terms.
export default function AiConsent() {
  const { refresh } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allow = async () => {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("set_ai_coach_consent", { p_allow: true });
    if (rpcError) {
      setError(rpcError.message);
      setBusy(false);
      return;
    }
    await refresh();
    router.back();
  };

  return (
    <Screen
      title="Your coach is an AI"
      titleSize="title"
      header={<StepHeader label="Before your first review" />}
      footer={
        <>
          <ErrorText message={error} />
          <Button label="Allow coach reviews" onPress={allow} disabled={busy} />
          <Button label="Not now" variant="secondary" onPress={() => router.back()} />
        </>
      }
    >
      <Text variant="body" color="text2">
        To coach you, we send each photo you make to Claude, an AI made by Anthropic. Here is exactly what happens.
      </Text>
      <NumberedSteps
        steps={[
          "Only the photo and the quest go. Never your name, age or location.",
          "Anthropic doesn't train its AI on your photo, and deletes it within 30 days.",
          "We improve the coach with your ratings, not your photos. Turn this off any time in Settings.",
        ]}
      />
      <InfoRow text="Without it you still get quests and levels." />
    </Screen>
  );
}
