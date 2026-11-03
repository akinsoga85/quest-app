# Setting up payments: Stripe and RevenueCat

Plus is sold in two places, and both report to the same `payments` function,
which records who has Plus:

| Who | Where they buy | Through |
|---|---|---|
| A parent, for a linked 16–19 | The parent page | **Stripe** |
| An 18–19, or a 16–17 after a parent's yes | The app | App Store or Google Play, via **RevenueCat** |
| 13–15 | Nowhere: Plus is free | — |

Do this after the Supabase project exists (`docs/production-setup.md`), since
both send their webhooks to it. Start everything in test mode, try it end to
end against a staging project, then switch to live.

## Stripe (the parent page)

### 1. The account (you, in the Stripe dashboard)

- **Activate it** under Settings → Business: business type and legal name,
  address, tax ID, a bank account for payouts, and the person verifying
  identity. Turn on two-step sign-in for everyone with access.
- **Public details:** use "QUEST PLUS" as the statement descriptor, so it's
  what parents see on their card statement. Add a support email, and use the
  parent site as the website.
- **Tax (Stripe Tax is on in checkout):** prices are before tax, and Stripe
  adds US sales tax or Canadian GST/HST from the parent's address. It
  collects only where you've added a registration; elsewhere it charges no
  tax, and the Tax page shows where you're nearing a threshold. In Settings
  → Tax, in **both** test and live mode:
  - add the head office address;
  - set the default product tax code your accountant advises, typically a
    digital or electronically supplied service;
  - add registrations where you must collect.

  Until Stripe Tax is set up in a mode, Stripe refuses checkout in that
  mode. `npm run setup:stripe` warns you if it isn't. In an emergency,
  `STRIPE_AUTOMATIC_TAX=off` in the function's secrets turns it off.
  Plus bought in the app needs none of this: Apple and Google collect and
  pay the tax themselves.
- **Currency:** prices are in US dollars. Canadian parents pay in USD unless
  you turn on Adaptive Pricing in Stripe, which shows local prices.

### 2. Run the setup (your computer)

It creates the product, the two monthly prices from the contract ($7.99, and
$3.99 for each extra teen), the manage page settings (cancel at the end of
the month, change card, receipts), and the webhook to the payments function.
Running it again only fills in what's missing.

```sh
# Test mode first, against a staging Supabase project:
STRIPE_SECRET_KEY=sk_test_... PROJECT_REF=<staging project id> \
PARENT_SITE_URL=https://<staging parent site> PRIVACY_URL=... TERMS_URL=... \
npm run setup:stripe
# It prints the values to put in the staging project's secrets.

# Then live, straight into supabase/.env.production:
STRIPE_SECRET_KEY=sk_live_... PROJECT_REF=<production project id> \
PARENT_SITE_URL=https://parents.<your domain> PRIVACY_URL=... TERMS_URL=... \
npm run setup:stripe -- --write
scripts/setup-production.sh   # sends the new values to the payments function
```

Stripe shows a webhook's signing secret only when it's created. The first
run saves it. If you lose it, roll it in Stripe (Developers → Webhooks → the
endpoint → Roll secret), then update `STRIPE_WEBHOOK_SECRET`.

### 3. Try it (test mode)

On the staging parent page, start Plus for a linked 16–19 test teen with the
card `4242 4242 4242 4242` (any future date, any CVC). Then check:

- Plus shows as on in the parent page, and in the teen's Settings.
- A second teen on the same parent account is charged $3.99.
- Checkout asks for the parent's address and shows tax for an address where
  you've added a test-mode registration.
- "Manage or cancel" opens Stripe's page. Cancelling keeps Plus to the end of
  the month.
- A refund (in Stripe, cancel the subscription immediately with a refund)
  stops Plus at once.
- A 13–15 is never offered Plus to buy.

## RevenueCat (the app)

### 1. Before RevenueCat: the stores (you)

- **App Store Connect:**
  - Sign the Paid Apps agreement and fill in tax and banking (Business).
  - Then Subscriptions: a group "Plus" with one auto-renewing subscription.
    Product ID `quest_plus_monthly`, 1 month, $7.99, display name "Quest
    Plus", a short description, and a review screenshot of the app's Plus
    screen.
  - Leave Family Sharing off, so one teen's Plus isn't shared across their
    Apple family.
- **Google Play Console:**
  - Set up a payments profile.
  - After a first build is uploaded to internal testing, go to Monetize →
    Subscriptions. Create subscription `quest_plus` with an auto-renewing
    base plan `monthly` at $7.99, and activate it.

### 2. RevenueCat (you, in the RevenueCat dashboard)

1. **Project** "Quest". Add the App Store app (bundle ID) and the Play Store
   app (package name). RevenueCat's setup screens walk you through the
   credentials each store needs: an App Store Connect in-app purchase key,
   and a Google service account with Play Console access.
2. **Products:**
   - add `quest_plus_monthly` (App Store) and `quest_plus:monthly` (Play: the
     subscription and its base plan);
   - an **entitlement** with the identifier `plus` (exactly that: the app
     looks for it), with both products attached;
   - an **offering** `default`, set as current, with a Monthly package holding
     both products.
3. **Server notifications**, so cancellations and refunds arrive promptly:
   - put the App Store Server Notifications URL RevenueCat gives you into App
     Store Connect (App Information), for production and sandbox;
   - connect Google's real-time developer notifications as RevenueCat's guide
     shows.
4. **Webhook** (Integrations → Webhooks):
   - URL `https://<project id>.supabase.co/functions/v1/payments/webhook`;
   - Authorization header value `Bearer <REVENUECAT_WEBHOOK_SECRET>`, meaning
     the word Bearer, a space, then the value from
     `supabase/.env.production` (make one with `openssl rand -hex 32`);
   - send all events: the function ignores the ones Plus doesn't need.
5. **Restore behaviour** (Project settings): choose to keep purchases with the
   original user. A teen restoring on a shared phone then can't move a
   sibling's Plus to their own account.
6. **SDK keys** (API keys): the public App Store key (`appl_…`) and Play key
   (`goog_…`) go in the EAS environment variables
   `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`.

### 3. Try it (sandbox)

With an App Store sandbox tester and a Play license tester, on a build from
the `preview` or `production` profile:

- buy, cancel, and restore on a second phone;
- try a 16–17 account before a parent links, after linking, and after the
  parent says yes;
- check Plus shows in Settings within seconds of buying.

Sandbox purchases also turn Plus on in whichever Supabase project the build
points to, so test against staging.

## Where each value goes

| Value | Where |
|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PLUS`, `STRIPE_PRICE_PLUS_EXTRA`, `STRIPE_PORTAL_CONFIGURATION` | `supabase/.env.production` (filled by `npm run setup:stripe -- --write`), then `scripts/setup-production.sh` |
| `REVENUECAT_WEBHOOK_SECRET` | `supabase/.env.production`, and after "Bearer " in RevenueCat's webhook |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | EAS environment variables (production) |
| `EXPO_PUBLIC_TERMS_URL`, `EXPO_PUBLIC_PRIVACY_URL` | EAS environment variables; the Plus screen links both, as the stores require |
