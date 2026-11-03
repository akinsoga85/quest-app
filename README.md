# Quest (working name)

Daily creative quests for teens 13–19, with an AI coach and family-only sharing.
This repo is **Lean V1**: Studio for everyone, on iPhone and Android, no walls yet.
The plan, PRD and design review live in the product doc; screens are in Figma
(file `DJ7C4eGOmgahBCPVsbHhnc`).

## What's here

| Path | What it is |
|---|---|
| `apps/mobile` | Expo (React Native) app: one codebase for iPhone and Android |
| `apps/parent` | The parent page (A8): consent and what the teen sends, a small React web app on the same backend; `/delete` for downloading data and deleting an account (A11) |
| `apps/admin` | The admin site (A11), staff only: safety queue, quest weeks, coach spot check, deletions |
| `packages/tokens` | Colours, type, spacing and tap sizes from Figma, with contrast tests |
| `packages/contract` | The shared contract: data shapes, rules and server-function signatures, plus generated database types |
| `supabase/migrations` | Database schema with row-level security on every table |
| `supabase/seed.sql` | Test quests for local development (never loaded into production) |
| `scripts/` | Local Postgres, access-rule tests, database type generator |
| `packages/coach` | The coach agent (A4): knowledge pack, prompts, guardrail checks, server worker and test-set runner |
| `packages/notify` | The evening drop (A10): who's due, Expo pushes, quiet hours |
| `packages/ops` | The account deletion job (A11): stops web Plus, empties the photo folder, deletes the account |
| `packages/payments` | Plus and payments (A9): RevenueCat and Stripe webhooks, Stripe Checkout and the manage page |
| `packages/quests` | The quest writer agent (A6): curriculum, Claude writer with rule checks, weekly job |
| `packages/safety` | The child-safety scan (A5): hash match, classifier, decision and server worker |
| `supabase/functions` | Edge functions bundled from the packages by `npm run build:functions` |
| `docs/agents.md` | Rules and briefs for the AI agents building packages A1–A12 |
| `docs/operations.md` | How staff run things: the safety queue, quest weeks, the coach spot check, deletions |
| `docs/production-setup.md` | Setting up the production Supabase project |
| `docs/payments-setup.md` | Setting up Stripe, RevenueCat and the store subscriptions |
| `docs/store-release.md` | Store release (A12): accounts, internal testing, listing, privacy labels, age ratings, release checklist |

## Run it

Needs Node 22.13+ and, for the database tests, a local PostgreSQL 16 (no Docker needed).

```sh
npm install
npm run check          # types, lint, unit tests
npm run db:up          # start a throwaway Postgres and load the schema
npm run db:test        # access-rule and integrity tests
npm run gen:types      # regenerate database types after a migration
npm run start -w @quest/mobile   # Expo dev server (needs a development build, see below)
```

To connect the app to Supabase, copy `apps/mobile/.env.example` to `.env` and fill
in the project URL, anon key and parent site URL. To set up the production
Supabase project (schema, functions, secrets, schedules), follow
`docs/production-setup.md`: one script, `scripts/setup-production.sh`, plus a
few dashboard steps.

The app uses native modules (store age signals, Sign in with Apple), so run it in a
[development build](https://docs.expo.dev/develop/development-builds/introduction/)
(`eas build --profile development`) rather than Expo Go.

## Sign-in setup (A1)

- **Supabase → Authentication → Providers:** turn on Apple and Google. Add
  `quest://auth/callback` to the allowed redirect URLs.
- **Apple:** in the Apple Developer account, enable *Sign in with Apple* and the
  *Declared Age Range* capability for the app ID (`app.json` already asks for both).
  Create a Services ID and key for Supabase's Apple provider, used for Apple
  sign-in on Android.
- **Google:** create an OAuth client in Google Cloud and add its ID and secret to
  Supabase's Google provider. In Play Console, set up Play Age Signals for the app.
- **Under-13 accounts:** `abandon_signup()` deletes the user from `auth.users`. On
  Supabase this works because the function runs as the database owner; check it
  once in the staging project.

## Store release (A12)

`apps/mobile/eas.json` has three build profiles (development, preview,
production; build numbers count up on EAS) and submits to TestFlight and Play's
internal testing track. Everything else, from the accounts you need to the
privacy labels and setting up Plus in the stores, is in `docs/store-release.md`.

## Admin and operations (A11)

- **Settings (H20a)** in the app: Download my work (a JSON file with week-long
  links to each photo) and Delete my account (7 days to change your mind,
  finished within 30). Apple and Google both require deleting from the app.
- **`/delete` on the parent site**: the same for parents, and for teens on the
  web. Use it as the account deletion link in the Google Play listing.
- **The admin site** (`apps/admin`): a static Vite + React site. Copy
  `.env.example` to `.env`, `npm run build -w @quest/admin`, and host `dist/`
  somewhere only staff know about (it's `noindex`); every function behind it
  checks the `staff` table. Add staff as in `docs/operations.md`, and turn on
  Google sign-in for the site's URL in Supabase.
- **The deletion job** (`account-deletions`) runs daily; it's deployed and
  scheduled by `scripts/setup-production.sh`.

## The evening drop (A10)

Every 10 minutes a schedule runs the `evening-drop` function. Each teen with
notifications on gets one push a day at their drop time (8 pm local by
default), saying what the day earned; it never arrives in quiet hours (9 pm to
7 am, and under-18s can't shorten 22:00–06:00). Tapping it opens the drop
screen, which is also in the You tab.

To deploy: run `eas init` so the app has an EAS project id (push tokens need
it). The function and its schedule come with `scripts/setup-production.sh`.

## Plus and payments (A9)

13–15s get Plus free. 16+ pay: in the app (App Store or Google Play, through
RevenueCat), where a 16–17 asks and a linked parent says yes on the parent
page first, or a linked parent buys it on the parent page (Stripe). Teens move
up an age group on the month stored at sign-up (or when their app store says
so), so free Plus ends at 16; after 20 they stay in 18–19 and keep their
account. Every purchase, renewal,
cancellation and refund arrives as a webhook at the `payments` function and is
applied once.

Setting up Stripe and RevenueCat (needs your accounts): `docs/payments-setup.md`.
`npm run setup:stripe` creates the product, both prices, the manage page
settings and the webhook. A second teen on the same parent account pays the
extra-teen price. For a refund on the web, cancel the subscription immediately
with a refund, so Plus ends at once.

## The parent page (A8)

`apps/parent` is a static web app (Vite + React): the consent page the teen's
link opens (`/consent?t=…`), and the parent page with what the teen sent,
cheers back, the weekly email switch and turning coach reviews off.

```sh
cp apps/parent/.env.example apps/parent/.env   # the same Supabase URL and anon key as the app
npm run dev -w @quest/parent
npm run build -w @quest/parent                 # static files in apps/parent/dist
```

Host `apps/parent/dist` on any static host with a single-page fallback (all
paths serve `index.html`), at the address in the app's
`EXPO_PUBLIC_PARENT_SITE_URL`. In Supabase → Authentication, turn on Apple,
Google and email sign-in links, and add the parent site's address to the
allowed redirect URLs. Parents confirm they're adults before consent counts;
the card check (no charge) comes with payments (A9).

## The quest writer (A6)

Each week a schedule runs the `quest-writer` function, which drafts the next
two weeks for every live zone that has none (7 quests per zone, with Claude
Opus 5.5). Every week must pass `weekRuleProblems`: safe, phone-only, no
people, flat-lay fashion, every skill trained, no repeats. A week with
problems gets one rewrite and is never saved with problems left. Drafts are
invisible to teens until a person approves them in the admin (A11), which
schedules them Monday to Sunday.

```sh
npm run quests -- draft --zone photography --week 2026-11-09   # prints a draft; saves nothing; costs money
```

To deploy: `scripts/setup-production.sh` deploys it and schedules it weekly
(Mondays); it needs `ANTHROPIC_API_KEY` in `supabase/.env.production`.

## The safety scan (A5)

Every photo is scanned on the server before the coach or any person sees it:
a hash match against known abuse imagery first, then a classifier for sexual
content, self-harm, violence and similar. Anything matched or flagged is
blocked or held for a person, and goes into `safety_queue`. The database
refuses to send a photo to the coach without a passing scan.

**Before real teens use it you must choose and sign up with vendors.** For
example, Thorn Safer or Microsoft PhotoDNA for hash matching (both need an
application), and a moderation classifier that covers self-harm (for example
Hive). Each needs a small adapter in `packages/safety` implementing
`HashMatcher` or `Classifier`. Until then the function answers 503 and scans
nothing, so photos wait and nothing reaches the coach. For staging only,
`SAFETY_VENDORS=test` uses exact-hash matching against `SAFETY_TEST_HASHES`
and a classifier that flags nothing; every scan records which vendor decided.

To deploy: `scripts/setup-production.sh`. A database trigger calls it for
each new photo, and a schedule sweeps every 5 minutes (migration
`20261114120100_production_wiring.sql`).

## The coach (A4)

The coach reviews each photo on the server with Claude (Claude Opus 5.5 writes
the review; Claude Haiku 5.5 checks it against the guardrails). It only ever
sees a photo when the teen has said yes to coach reviews, plus a parent for
under-18s.

```sh
export ANTHROPIC_API_KEY=...          # every run below calls Claude and costs money
npm run coach -- review path/to/photos --zone photography --quest "Shadows that tell a story"
npm run coach -- eval packages/coach/testset/sample --out report.json
```

`eval` exits with an error unless the test set passes: zero guardrail breaks,
every hard case right, and 90% of outcomes right. The sample set is drawn
stand-ins; the mentor sprint adds the real 500-photo set per zone. Change the
models or effort with `COACH_MODEL`, `COACH_GUARD_MODEL` and `COACH_EFFORT`.

To deploy: `scripts/setup-production.sh`. A database trigger calls it when a
photo passes the safety scan, and a schedule sweeps every 5 minutes for
anything missed or waiting for consent.

## Before the first store build

- Replace the working name, `com.example.quest` bundle IDs and the `quest` URL scheme in `apps/mobile/app.json` once the name is cleared.
- The skills for Fashion, Art and crafts, Music and Words are drafts for the mentor sprint to confirm (`packages/contract/src/zones.ts` and the migration `20261114120000_reference_data.sql` must match; `npm run db:test` checks this).
- Level thresholds in `packages/contract/src/levels.ts` are a first guess to tune in the pilot.
