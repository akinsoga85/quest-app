import { PARENT_LINK_TTL_DAYS, parentInviteUrl } from "@quest/contract";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Share } from "react-native";
import { pendingInvite, useAccount } from "../lib/account";
import { PARENT_SITE_URL, supabase } from "../lib/supabase";
import { Button } from "../ui/Button";
import { Screen } from "../ui/Screen";
import { Text } from "../ui/Text";
import { ErrorText, InfoRow, NumberedSteps, StepHeader } from "../ui/parts";

function sentAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// H3: send a parent the consent link. Used in onboarding and later from You.
export function ParentInvite({ inOnboarding }: { inOnboarding: boolean }) {
  const { teen, parentLinks, refresh, setWaitingForParent } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = pendingInvite(parentLinks);
  const linked = parentLinks.some((l) => l.status === "active");

  // Check now and then whether the parent has said yes.
  useEffect(() => {
    const id = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("create_parent_invite");
      if (rpcError) throw rpcError;
      const invite = data?.[0];
      if (!invite) throw new Error("No link came back. Please try again.");
      const url = parentInviteUrl(PARENT_SITE_URL, invite.token);
      await Share.share({
        message: `Hi! I'd like to use [App name] for a daily creative quest. A parent needs to say yes first: ${url} (the link works for ${PARENT_LINK_TTL_DAYS} days)`,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make a link. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const under18 = teen?.ageBracket !== "18_19";
  return (
    <Screen
      title={under18 ? "One quick step: ask a parent" : "Link a parent"}
      titleSize="title"
      header={<StepHeader label={inOnboarding ? "Step 2 of 2" : "Parent link"} back={!inOnboarding} />}
      footer={
        <>
          <ErrorText message={error} />
          <Button label={pending ? "Send a new link" : "Send link to a parent"} onPress={send} disabled={busy || linked} />
          {inOnboarding ? (
            <Button label="Start making while I wait" variant="secondary" onPress={() => void setWaitingForParent(true)} />
          ) : (
            <Button label="Done" variant="secondary" onPress={() => router.back()} />
          )}
        </>
      }
    >
      <Text variant="body" color="text2">
        {under18
          ? "Because you're under 18, a parent says yes before anything leaves your phone. You can start making right now."
          : "Link a parent if you'd like to share your work with them. It's up to you."}
      </Text>
      <NumberedSteps
        steps={[
          "Send them a link by text, WhatsApp or email",
          "They sign in and confirm they're your parent",
          "Coach reviews and family sharing switch on",
        ]}
      />
      {linked ? <InfoRow text="Your parent said yes. You're all set." /> : null}
      {!linked && pending ? <InfoRow text={`Waiting for your parent · sent ${sentAgo(pending.createdAt)}`} action="Resend" onAction={send} /> : null}
      {!linked && !pending && parentLinks.some((l) => l.status === "pending") ? (
        <InfoRow text="Your last link expired. Send a new one." />
      ) : null}
    </Screen>
  );
}
