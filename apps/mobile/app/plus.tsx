import { Api, PLUS, type PlusStatus } from "@quest/contract";
import { colors, space } from "@quest/tokens";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Pressable, View } from "react-native";
import { pendingInvite, useAccount } from "../src/lib/account";
import { PRIVACY_URL, TERMS_URL, supabase } from "../src/lib/supabase";
import { MANAGE_SUBSCRIPTIONS_URL, SYNC_WAITS_MS, manageLine, plusView, renewalTerms } from "../src/plus/logic";
import { loadOffer, restorePlus, type PlusOffer } from "../src/plus/purchases";
import { shortDate } from "../src/settings/logic";
import { Button } from "../src/ui/Button";
import { Card, Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { ErrorText, InfoRow, StepHeader } from "../src/ui/parts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Plus: free for 13–15s; 16+ buy it here (16–17s once a linked parent says yes).
export default function PlusScreen() {
  const { teen, parentLinks } = useAccount();
  const [status, setStatus] = useState<PlusStatus | null>(null);
  const [offer, setOffer] = useState<PlusOffer | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("plus_status");
    const s = Api["plus.status"].output.safeParse(data).data ?? null;
    setStatus(s);
    return s;
  }, []);

  useEffect(() => {
    void load().then((s) => {
      if (s && plusView(s) === "buy") {
        if (!teen) return setOffer(null);
        loadOffer(teen.id)
          .then(setOffer)
          .catch(() => setOffer(null));
      }
    });
  }, [load, teen]);

  // The store has taken the payment; our server hears by webhook. Ask again
  // until it shows, then say it's on either way.
  const settle = async () => {
    for (const ms of SYNC_WAITS_MS) {
      await wait(ms);
      if ((await load())?.active) return;
    }
    setNote("Plus is on. It can take a minute to show everywhere.");
  };

  const buy = async () => {
    if (!offer) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await offer.buy();
      if (r === "bought") await settle();
      else if (r === "pending") setNote("Waiting for the purchase to be approved. Plus turns on as soon as it is.");
    } catch {
      setError("The purchase didn't go through. You haven't been charged. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  // A 16–17 asks a linked parent, who says yes or not now on the parent page.
  const ask = async () => {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc("request_plus");
    setBusy(false);
    if (e) setError(/tomorrow/.test(e.message) ? "You can ask again tomorrow." : "Couldn't send that. Try again in a moment.");
    await load();
  };

  const restore = async () => {
    if (!teen) return;
    setBusy(true);
    setError(null);
    try {
      if (await restorePlus(teen.id)) await settle();
      else setNote("No Plus subscription found for this store account.");
    } catch {
      setError("Couldn't check your purchases. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const view = plusView(status);
  const os = Platform.OS === "android" ? "android" : "ios";
  const waiting = pendingInvite(parentLinks) !== null;

  const perks = (
    <Card>
      {PLUS.teenPerks.map((p) => (
        <View key={p} style={{ flexDirection: "row", gap: space.sm }}>
          <Text variant="label" color="lime" aria-hidden>
            ✓
          </Text>
          <Text variant="bodySmall" style={{ flex: 1 }}>
            {p}
          </Text>
        </View>
      ))}
    </Card>
  );

  const footer =
    view === "buy" ? (
      <>
        <ErrorText message={error} />
        <Button label={busy ? "One moment…" : "Start Plus"} disabled={busy || !offer} onPress={() => void buy()} />
        <Pressable accessibilityRole="button" onPress={() => void restore()} disabled={busy} style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}>
          <Text variant="label" color="lime">
            Restore purchases
          </Text>
        </Pressable>
      </>
    ) : view === "needs_parent" ? (
      waiting ? undefined : <Button label="Send link to a parent" onPress={() => router.push("/invite-parent")} />
    ) : view === "ask_parent" || view === "declined" ? (
      <>
        <ErrorText message={error} />
        <Button label={view === "declined" ? "Ask again" : "Ask my parent"} disabled={busy} onPress={() => void ask()} />
      </>
    ) : view === "active" && status?.source !== "web" ? (
      <Button label="Manage subscription" variant="secondary" onPress={() => void Linking.openURL(MANAGE_SUBSCRIPTIONS_URL[os])} />
    ) : undefined;

  return (
    <Screen header={<StepHeader label="Plus" />} title="Plus" titleSize="title" footer={footer}>
      {perks}
      {view === "included" ? (
        <Text variant="body" color="text2">
          Included free while you're 13 to 15. There's nothing to buy.
        </Text>
      ) : null}
      {view === "active" && status ? (
        <Text variant="body" color="text2">
          Plus is on{status.until ? ` until ${shortDate(status.until)}` : ""}. {manageLine(status)}
        </Text>
      ) : null}
      {view === "needs_parent" ? (
        <Text variant="body" color="text2">
          {waiting ? "Plus opens up once your parent says yes to your link." : "Under 18, link a parent first so they know about Plus. Then you can start it here."}
        </Text>
      ) : null}
      {view === "ask_parent" ? (
        <Text variant="body" color="text2">
          Under 18, a parent says yes before you start Plus. We'll ask them on their parent page.
        </Text>
      ) : null}
      {view === "waiting" ? (
        <Text variant="body" color="text2">
          We've asked your parent. They can say yes on their parent page, so let them know.
        </Text>
      ) : null}
      {view === "declined" ? (
        <Text variant="body" color="text2">
          Your parent said not now. You can ask again tomorrow.
        </Text>
      ) : null}
      {view === "buy" && status?.approval === "approved" ? (
        <Text variant="body" color="lime">
          Your parent said yes.
        </Text>
      ) : null}
      {view === "buy" ? (
        offer === undefined ? (
          <Text variant="bodySmall" color="muted">
            Getting the price…
          </Text>
        ) : offer === null ? (
          <Text variant="body" color="text2">
            Plus can't be bought on this phone right now. Try again later.
          </Text>
        ) : (
          <>
            <Text variant="title">{offer.price} a month</Text>
            <Text variant="caption" color="muted">
              {renewalTerms(offer.price, os)}
            </Text>
            <View style={{ flexDirection: "row", gap: space.md }}>
              <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(TERMS_URL)} style={{ minHeight: 44, justifyContent: "center" }}>
                <Text variant="caption" style={{ color: colors.text2, textDecorationLine: "underline" }}>
                  Terms of use
                </Text>
              </Pressable>
              <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(PRIVACY_URL)} style={{ minHeight: 44, justifyContent: "center" }}>
                <Text variant="caption" style={{ color: colors.text2, textDecorationLine: "underline" }}>
                  Privacy policy
                </Text>
              </Pressable>
            </View>
          </>
        )
      ) : null}
      {note ? <InfoRow text={note} /> : null}
    </Screen>
  );
}
