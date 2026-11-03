// Sets up Stripe for Plus: product, prices (from the contract), customer
// portal, and the webhook to the payments function. Safe to run again.
// Run it on your own computer, with a test key first, then the live key:
//
//   STRIPE_SECRET_KEY=sk_test_... PROJECT_REF=<supabase project id> \
//   PARENT_SITE_URL=https://parents.<your domain> npm run setup:stripe
//
// Optional: PRIVACY_URL and TERMS_URL (shown on the manage page).
// Add --write to put the results in supabase/.env.production (or ENV_FILE);
// do that with the live key only, so production never gets test values.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { setupStripe } from "../packages/payments/src/setup.ts";

const need = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`Set ${k} (see the top of scripts/setup-stripe.mjs).`);
    process.exit(1);
  }
  return v;
};
const key = need("STRIPE_SECRET_KEY");
const ref = need("PROJECT_REF");
const site = need("PARENT_SITE_URL").replace(/\/+$/, "");
const write = process.argv.includes("--write");
const envFile = process.env.ENV_FILE ?? "supabase/.env.production";

let r;
try {
  r = await setupStripe((url, init) => fetch(url, init), key, {
    webhookUrl: `https://${ref}.supabase.co/functions/v1/payments/webhook`,
    returnUrl: site,
    privacyUrl: process.env.PRIVACY_URL,
    termsUrl: process.env.TERMS_URL,
  });
} catch (e) {
  const cause = e.cause ? ` (${e.cause.code ?? e.cause.message})` : "";
  console.error(`Stripe setup stopped: ${e.message}${cause}. Nothing after that point was changed; fix it and run again.`);
  process.exit(1);
}

console.log(`Stripe ${r.live ? "LIVE" : "test"} mode`);
console.log(r.created.length ? r.created.map((c) => `  created ${c}`).join("\n") : "  everything was already there");

const values = {
  STRIPE_SECRET_KEY: key,
  STRIPE_PRICE_PLUS: r.pricePlus,
  STRIPE_PRICE_PLUS_EXTRA: r.priceExtraTeen,
  STRIPE_PORTAL_CONFIGURATION: r.portalConfiguration,
  PARENT_SITE_URL: site,
  ...(r.webhook.secret ? { STRIPE_WEBHOOK_SECRET: r.webhook.secret } : {}),
};
if (!r.webhook.secret) {
  console.log(`\nThe webhook ${r.webhook.id} already existed, so Stripe won't show its secret again.`);
  console.log("Keep the STRIPE_WEBHOOK_SECRET you saved, or roll it in Stripe: Developers → Webhooks → the endpoint → Roll secret.");
}

if (write) {
  if (!r.live) {
    console.error("\n--write is for the live key only, so production never gets test values. Nothing written.");
    process.exit(1);
  }
  if (!existsSync(envFile)) {
    console.error(`\n${envFile} doesn't exist: copy supabase/.env.production.example first.`);
    process.exit(1);
  }
  let text = readFileSync(envFile, "utf8");
  for (const [k, v] of Object.entries(values)) {
    const line = `${k}=${v}`;
    text = new RegExp(`^${k}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
  }
  writeFileSync(envFile, text);
  console.log(`\nWrote ${Object.keys(values).join(", ")} to ${envFile}.`);
  console.log("Run scripts/setup-production.sh again to send them to the payments function.");
} else {
  console.log("\nFor supabase/.env.production (the secret key is the one you just used):");
  for (const [k, v] of Object.entries(values)) console.log(k === "STRIPE_SECRET_KEY" ? `${k}=<the key you used>` : `${k}=${v}`);
}
