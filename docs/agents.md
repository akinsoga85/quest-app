# Building with AI agents

A0 (this foundation) is done. Packages A1–A12 can now be built in parallel, one
agent each. Every package builds against the contract in `packages/contract`
and the schema in `supabase/migrations`, so each one runs and is tested on its own.

## Rules for every agent

1. One package per agent, on its own branch (`a3-capture`), with the brief below.
2. Talk to other packages only through the contract: `Api` in
   `packages/contract/src/api.ts`, the shared types, and the database. Changing
   the contract or a migration is its own reviewed change, never part of a package.
3. Test keys only. Never production secrets or real teen data.
4. Write the done-when checks as tests first. A merge needs green CI: types,
   lint, unit tests, database tests, and both app bundles.
5. A human reviews every change to safety, consent, payments or data deletion
   (A1, A5, A9, A11) line by line.
6. Text sizes, colours and tap sizes come from `@quest/tokens`; screens use
   `Screen`, `Text` and `Button` from `apps/mobile/src/ui`, so text scales and
   tap targets stay at 44 pt (iOS) and 48 dp (Android).

## Package briefs

| ID | Package | Owns (contract and tables) | Figma | Done when |
|---|---|---|---|---|
| A1 | Sign-up, age and consent | `bracketForAge`, `bracketFromAgeRange`, `ageFromBirthMonth`, `modeFor`, `needsParentConsent`; `teen.create`, `signup.abandon`, `parent.invite`, `parent.accept`, `ai.consent` (Postgres functions); `private.coach_allowed`; tables `teens`, `parents`, `parent_links`, `app_config` | H1, H2, H3, H14a, H22 | **Built.** Ages 12–19 in Canada and the US tested; under-13s stopped and nothing kept; links expire after 7 days. Store age signal (expo-age-range) still to check on real phones |
| A2 | Quests and Today | `Quest`, `Today`, `localDay`, `weekStart`, `weekDays`, `weeklyStreak`, `MAKING_DAYS_PER_WEEK`; `zones.set`, `today.get` (Postgres functions); `makes.local_day`; tables `quests`, `quest_schedule`, `teen_zones` | H4, H5, H15 | **Built.** Quests appear at local midnight in 13 time zones, including daylight-saving days; the weekly streak matches the contract across time zones and travel |
| A3 | Capture and upload | `make.createUpload`; table `makes`; storage bucket `makes` | H6, H23 | No upload keeps location data; uploads resume after a dropped connection; system photo picker on Android |
| A4 | Coach agent | `CoachReview`, `coachReviewJsonSchema`, `reviewGuardrailIssues`, `MIN_REVIEW_CONFIDENCE`; `review.forMake`; tables `reviews`, `skill_points` | H7, H16 | Passes the coach test set (Lean V1 tab: "How we know it's good"); no review without `ai_coach_consent` |
| A5 | Safety scan | `make.submit`; table `safety_scans` | H8 (safety card) | Test hashes always blocked; flagged items reach the admin queue; nothing reaches the coach unscanned |
| A6 | Quest writer agent | `QuestWeekDraft`, `questRuleProblems`; drafts into `quests` | — | Drafts a week per zone with zero rule problems; approved in admin |
| A7 | Portfolio, skills, levels | `levelFor`, `levelledUp`; `review.rate`; view `zone_progress`, table `postcards` | H12, H13, H18 | Level-ups follow the rules; a digital postcard at each level-up |
| A8 | Family share and parent page | `Cheer`; `family.share`, `family.cheer`; tables `family_shares`, `family_cheers` | H17, H19, H24, H25 | A parent sees only the makes sent to them and can send one cheer back |
| A9 | Plus and payments | table `entitlements` (webhook only) | H25 | Buy, renew, cancel and refund on both stores and the web; under-18 purchases need a parent's approval |
| A10 | Evening drop and notifications | table `notification_prefs` | H11, H19 | Drop at 8 pm local time; no pushes during quiet hours |
| A11 | Admin and operations | `account.export`, `account.delete`, `DELETION_DAYS`; table `deletion_requests` | H20a, H21 | Quest approval, safety queue, 1% coach spot check, deletion and export all work |
| A12 | Store release | `apps/mobile/app.json` | — | Listings, privacy labels and age ratings done; internal testing on both stores |

## Status

- **A0 foundation:** done.
- **A1 sign-up, age and consent:** built on branch `a1-signup`. Left: test the store
  age signal and both sign-ins on a real iPhone (iOS 26+) and Android phone in a
  development build. The parent consent web page (H24) is A8's; it calls
  `accept_parent_invite` after its adult check.
- **A2 quests and Today:** built on branch `a2-today` (on top of `a1-signup`).
  Zone picking is the last onboarding step and can be changed from the You tab.
- **For A3, A4 and A5:** check `private.coach_allowed(teen_id)` before anything
  leaves the phone: it needs the teen's yes, plus an active parent link for under-18s.
- **For A3:** a make's `local_day` is set by a trigger from the teen's time zone and
  `created_at`. The app can't set either; a server function may pass a capture time
  for photos taken offline (never in the future). Makes count for the streak unless
  `blocked`.
- **For A6 and A11:** a scheduled quest stays hidden until the teen's local midnight on
  its day, so schedule weeks ahead freely. A day with no quest shows "on its way" for
  that zone.

## Already enforced by the database

`npm run db:test` proves these, so packages don't need to re-check them:

- Signed-out users read nothing; each teen sees only their own rows.
- Teens can't change their age bracket, mode or handle, or write reviews.
- A make can be shared only after it's reviewed, and only with an actively linked parent.
- A parent sees only the makes sent to them; only that parent can cheer.
- At most three zones per teen, only open zones; skill points must match the review's zone.
- Nobody sees a later day's quest before their local midnight; teens' time zones are real IANA names.
- Deleting an account removes the teen's data and keeps the deletion record.
