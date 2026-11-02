import { ageFromBirthMonth, bracketForAge, type AgeBracket, type AgeSource } from "@quest/contract";
import { space } from "@quest/tokens";
import { getCalendars, getLocales } from "expo-localization";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { getStoreAgeSignal } from "../../src/onboarding/ageSignal";
import { AGE_GATE_KEY, birthYearsFor, closedUntil, isClosed } from "../../src/onboarding/ageGate";
import { useAccount } from "../../src/lib/account";
import { supabase } from "../../src/lib/supabase";
import { Button } from "../../src/ui/Button";
import { Card, Screen } from "../../src/ui/Screen";
import { Text } from "../../src/ui/Text";
import { ErrorText, InfoRow, Pill, StepHeader } from "../../src/ui/parts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// H2: the app store's age range first; birth month and year if it shares nothing.
// Only the bracket is kept, never the birth date.
export default function AgeCheck() {
  const { refresh } = useAccount();
  const years = useMemo(() => birthYearsFor(new Date()), []);
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [storeAdult, setStoreAdult] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A child who was stopped can't come straight back with an older year.
  useEffect(() => {
    void SecureStore.getItemAsync(AGE_GATE_KEY).then((v) => {
      if (isClosed(v, Date.now())) router.replace({ pathname: "/stop", params: { reason: "under13" } });
    });
  }, []);

  const stop = async (reason: "under13" | "over19") => {
    if (reason === "under13") await SecureStore.setItemAsync(AGE_GATE_KEY, String(closedUntil(Date.now())));
    router.replace({ pathname: "/stop", params: { reason } });
  };

  const createProfile = async (bracket: AgeBracket, source: AgeSource) => {
    const country = (getLocales()[0]?.regionCode ?? "ZZ").toUpperCase();
    const timezone = getCalendars()[0]?.timeZone ?? "UTC";
    const { error: rpcError } = await supabase.rpc("create_teen_profile", {
      p_age_bracket: bracket,
      p_age_source: source,
      p_country: country,
      p_region: "",
      p_timezone: timezone,
    });
    if (rpcError) throw rpcError;
    await refresh(); // the layout moves on to the next step
  };

  const useStore = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await getStoreAgeSignal();
      if (r.kind === "verification_required") {
        setNote("Google Play needs you to confirm your age first. Open the Play Store, then try again, or pick your birth month and year below.");
      } else if (r.kind === "unavailable") {
        setNote("Your app store didn't share an age range. Pick your birth month and year below.");
      } else if (r.verdict === "under_13") {
        await stop("under13");
      } else if (r.verdict === "over_19") {
        await stop("over19");
      } else if (r.verdict === "adult_unbounded") {
        setStoreAdult(true);
        setNote("Your app store says you're 18 or older. Pick your birth month and year so we know you're 19 or under.");
      } else {
        await createProfile(r.verdict, "store");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const useBirthMonth = async () => {
    if (year === null || month === null) return;
    setBusy(true);
    setError(null);
    try {
      let age = ageFromBirthMonth(year, month, new Date());
      if (storeAdult) age = Math.max(age, 18); // the store's minimum wins
      const check = bracketForAge(age);
      if (check === "under_13") await stop("under13");
      else if (check === "over_19") await stop("over19");
      else await createProfile(check, storeAdult ? "store" : "self_declared");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="How old are you?"
      titleSize="title"
      header={<StepHeader label="Step 1 of 2" back={false} />}
      footer={
        <>
          <ErrorText message={error} />
          <Button label="Continue" onPress={useBirthMonth} disabled={busy || year === null || month === null} />
        </>
      }
    >
      <Text variant="body" color="text2">
        We use the age range your phone's app store shares. If it isn't shared, pick your birth month and year. We only keep your age group.
      </Text>

      {!storeAdult ? (
        <Card>
          <Text variant="label">Share your age range from your app store</Text>
          <Button label="Share age range" variant="secondary" onPress={useStore} disabled={busy} />
        </Card>
      ) : null}
      {note ? <InfoRow text={note} /> : null}

      <Text variant="eyebrow" color="muted">
        OR PICK YOUR BIRTH MONTH AND YEAR
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
        {years.map((y) => (
          <Pill key={y} label={String(y)} selected={year === y} onPress={() => setYear(y)} />
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
        {MONTHS.map((m, i) => (
          <Pill key={m} label={m} accessibilityLabel={MONTH_NAMES[i]} selected={month === i + 1} onPress={() => setMonth(i + 1)} />
        ))}
      </View>

      <Text variant="caption" color="muted">
        Under 13? We stop here and keep nothing.
      </Text>
    </Screen>
  );
}
