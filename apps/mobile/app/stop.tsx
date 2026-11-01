import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { supabase } from "../src/lib/supabase";
import { Button } from "../src/ui/Button";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";

// Under 13 or over 19: delete the just-made sign-in and keep nothing.
export default function Stop() {
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const [done, setDone] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          await supabase.rpc("abandon_signup");
          // The account is gone on the server, so only the phone's copy is left to clear.
          await supabase.auth.signOut({ scope: "local" });
        }
      } catch {
        // Offline or failed: still sign out on this phone; the server keeps no profile anyway.
        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      } finally {
        setDone(true);
      }
    })();
  }, []);

  const under13 = reason !== "over19";
  return (
    <Screen
      title="Thanks for stopping by"
      titleSize="title"
      footer={<Button label="OK" variant="secondary" disabled={!done} onPress={() => router.replace("/welcome")} />}
    >
      <Text variant="body" color="text2">
        {under13
          ? "[App name] is for teens 13 to 19. Come back when you're 13. We haven't kept anything about you."
          : "[App name] is for teens 13 to 19, so we can't set up an account. We haven't kept anything about you."}
      </Text>
    </Screen>
  );
}
