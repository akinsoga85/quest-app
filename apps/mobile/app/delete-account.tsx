import { Api, DELETION_DAYS, type DeletionRequest } from "@quest/contract";
import { router } from "expo-router";
import { useState } from "react";
import { useAccount } from "../src/lib/account";
import { signOut } from "../src/lib/auth";
import { supabase } from "../src/lib/supabase";
import { downloadMyWork } from "../src/settings/download";
import { shortDate } from "../src/settings/logic";
import { Button } from "../src/ui/Button";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { ErrorText, NumberedSteps, StepHeader } from "../src/ui/parts";

// Delete my account (H20a → here). Apple and Google both require deleting
// from inside the app. The account goes after 7 days (time to change your
// mind), and always within DELETION_DAYS.
export default function DeleteAccount() {
  const { teen, parentLinks } = useAccount();
  const [done, setDone] = useState<DeletionRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linked = parentLinks.some((l) => l.status === "active");

  const request = async () => {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("request_account_deletion");
    setBusy(false);
    const parsed = Api["account.delete"].output.safeParse(data);
    if (e || !parsed.success) setError("Couldn't start the deletion. Try again in a moment.");
    else setDone(parsed.data);
  };

  const keep = async () => {
    setBusy(true);
    const { error: e } = await supabase.rpc("cancel_account_deletion");
    setBusy(false);
    if (e) setError("Couldn't cancel. Try again in a moment.");
    else router.back();
  };

  const download = async () => {
    if (!teen) return;
    setError(null);
    try {
      await downloadMyWork(teen.handle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't gather your work.");
    }
  };

  if (done) {
    return (
      <Screen
        header={<StepHeader label="Delete account" back={false} />}
        title="Your account will be deleted"
        titleSize="title"
        footer={
          <>
            <ErrorText message={error} />
            <Button label="Keep my account" disabled={busy} onPress={() => void keep()} />
            <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
          </>
        }
      >
        <Text variant="body" color="text2">
          After {shortDate(done.deletesAfter)}, your account and all your work are deleted for good. Until then, sign in and tap Keep my account to stop it.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen
      header={<StepHeader label="Delete account" />}
      title="Delete your account?"
      titleSize="title"
      footer={
        <>
          <ErrorText message={error} />
          <Button label="Download my work first" variant="secondary" onPress={() => void download()} />
          <Button label="Delete my account" variant="danger" disabled={busy} onPress={() => void request()} />
        </>
      }
    >
      <NumberedSteps
        steps={[
          "Your photos, reviews, levels and postcards are deleted.",
          linked ? "Your parent's page stops showing your work." : "Any parent link is removed.",
          `You have 7 days to change your mind. After that it's gone for good, within ${DELETION_DAYS} days at most.`,
        ]}
      />
      <Text variant="caption" color="muted">
        Plus from the App Store or Google Play renews until you cancel it in your phone's subscriptions. Any other Plus stops when your account is deleted.
      </Text>
    </Screen>
  );
}
