// Sets up RevenueCat for Plus: the `plus` entitlement, the monthly product in
// each store, the current `default` offering with its monthly package, and
// the webhook to the payments function. Safe to run again. Prices aren't set
// here: they're set in each store once agreed.
//
// First add the App Store and Play Store apps in the RevenueCat dashboard
// (they need your store credentials). Then, with a v2 secret API key:
//
//   REVENUECAT_API_KEY=sk_... npm run setup:revenuecat
//
// Options:
//   RC_PROJECT_ID=proj...     if the key can see more than one project
//   PROJECT_REF=<supabase project id>   also add the webhook; its secret comes from
//       REVENUECAT_WEBHOOK_SECRET or supabase/.env.production (ENV_FILE)
//   --write                   make the webhook secret if there isn't one and save it in that file
//   --push-to-app-store       also create the subscription in App Store Connect (no price yet)
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { setupRevenueCat } from "../packages/payments/src/revenuecat-setup.ts";

const key = process.env.REVENUECAT_API_KEY;
if (!key) {
  console.error("Set REVENUECAT_API_KEY to a RevenueCat v2 secret key (see the top of scripts/setup-revenuecat.mjs).");
  process.exit(1);
}
const write = process.argv.includes("--write");
const envFile = process.env.ENV_FILE ?? "supabase/.env.production";
const fromFile = (k) => (existsSync(envFile) ? readFileSync(envFile, "utf8").match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim() : undefined);

let webhook;
if (process.env.PROJECT_REF) {
  let secret = process.env.REVENUECAT_WEBHOOK_SECRET || fromFile("REVENUECAT_WEBHOOK_SECRET");
  if (!secret && write) {
    if (!existsSync(envFile)) {
      console.error(`${envFile} doesn't exist: copy supabase/.env.production.example first.`);
      process.exit(1);
    }
    secret = randomBytes(32).toString("hex");
    let text = readFileSync(envFile, "utf8");
    text = /^REVENUECAT_WEBHOOK_SECRET=.*$/m.test(text)
      ? text.replace(/^REVENUECAT_WEBHOOK_SECRET=.*$/m, `REVENUECAT_WEBHOOK_SECRET=${secret}`)
      : `${text.replace(/\n?$/, "\n")}REVENUECAT_WEBHOOK_SECRET=${secret}\n`;
    writeFileSync(envFile, text);
    console.log(`Made a webhook secret and saved it as REVENUECAT_WEBHOOK_SECRET in ${envFile}.`);
  }
  if (!secret) {
    console.error(`No REVENUECAT_WEBHOOK_SECRET in the environment or ${envFile}. Add one, or run with --write to make it.`);
    process.exit(1);
  }
  webhook = { url: `https://${process.env.PROJECT_REF}.supabase.co/functions/v1/payments/webhook`, secret };
}

let r;
try {
  r = await setupRevenueCat((url, init) => fetch(url, init), key, {
    projectId: process.env.RC_PROJECT_ID || undefined,
    webhook,
    pushToAppStore: process.argv.includes("--push-to-app-store"),
  });
} catch (e) {
  const cause = e.cause ? ` (${e.cause.code ?? e.cause.message})` : "";
  console.error(`RevenueCat setup stopped: ${e.message}${cause}. Nothing after that point was changed; fix it and run again.`);
  process.exit(1);
}

console.log(`RevenueCat project ${r.projectId}`);
console.log(r.created.length ? r.created.map((c) => `  created ${c}`).join("\n") : "  everything was already there");
if (r.todo.length) console.log(`\nStill to do:\n${r.todo.map((t) => `  - ${t}`).join("\n")}`);
console.log("\nFor the app's EAS environment variables (public keys, safe to share):");
if (r.publicKeys.ios) console.log(`EXPO_PUBLIC_REVENUECAT_IOS_KEY=${r.publicKeys.ios}`);
if (r.publicKeys.android) console.log(`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=${r.publicKeys.android}`);
if (r.webhook?.created) console.log("\nRun scripts/setup-production.sh again so the payments function has the same webhook secret.");
