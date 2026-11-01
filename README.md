# Quest (working name)

Daily creative quests for teens 13–19, with an AI coach and family-only sharing.
This repo is **Lean V1**: Studio for everyone, on iPhone and Android, no walls yet.
The plan, PRD and design review live in the product doc; screens are in Figma
(file `DJ7C4eGOmgahBCPVsbHhnc`).

## What's here

| Path | What it is |
|---|---|
| `apps/mobile` | Expo (React Native) app: one codebase for iPhone and Android |
| `packages/tokens` | Colours, type, spacing and tap sizes from Figma, with contrast tests |
| `packages/contract` | The shared contract: data shapes, rules and server-function signatures, plus generated database types |
| `supabase/migrations` | Database schema with row-level security on every table |
| `supabase/seed.sql` | Zones, skills and a first day of quests |
| `scripts/` | Local Postgres, access-rule tests, database type generator |
| `packages/coach` | The coach agent (A4): knowledge pack, prompts, guardrail checks, server worker and test-set runner |
| `packages/safety` | The child-safety scan (A5): hash match, classifier, decision and server worker |
| `supabase/functions` | Edge functions (the safety scan and the coach), bundled from `packages/safety` and `packages/coach` |
| `docs/agents.md` | Rules and briefs for the AI agents building packages A1–A12 |

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
in the project URL, anon key and parent site URL. Deploy the schema with `supabase db push`.

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

To deploy: `npm run build:functions`, `supabase functions deploy safety-scan
--no-verify-jwt`, set `SAFETY_WEBHOOK_SECRET`, add a database webhook on
`makes` INSERT (header `x-safety-secret`), and a schedule that POSTs `{}`
every minute.

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

To deploy:

1. `npm run build:functions`, then `supabase functions deploy coach-review --no-verify-jwt`.
2. `supabase secrets set ANTHROPIC_API_KEY=... COACH_WEBHOOK_SECRET=<random>`.
3. Database → Webhooks: on `makes` UPDATE, POST to the function's URL with the
   header `x-coach-secret: <the secret>`. The function only acts on rows whose
   status is `reviewing` (set by the safety scan, A5).
4. A schedule (Supabase Cron) that POSTs `{}` to the same URL every minute, to pick up
   anything missed or waiting for consent.

## Before the first store build

- Replace the working name, `com.example.quest` bundle IDs and the `quest` URL scheme in `apps/mobile/app.json` once the name is cleared.
- The skills for Fashion, Art and crafts, Music and Words are drafts for the mentor sprint to confirm (`packages/contract/src/zones.ts` and `supabase/seed.sql` must match; `npm run db:test` checks this).
- Level thresholds in `packages/contract/src/levels.ts` are a first guess to tune in the pilot.
