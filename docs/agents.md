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
| A3 | Capture and upload | `PHOTO`, `cropTo45`, `jpegMetadata`, `stripJpegMetadata`, `makePath`, `MakeStatus`; `make.record` (Postgres function); table `makes`; storage bucket `makes` | H6, H23 | **Built.** Photos lose location and device data on the phone (tested on real GPS JPEGs); the upload queue resumes after dropped connections and restarts; Android uses the system photo picker with broad photo permissions blocked |
| A4 | Coach agent | `CoachReview`, `CoachContext`, `CoachClaim`, `ReviewState`, `LESSONS`, `reviewGuardrailIssues`, `MIN_REVIEW_CONFIDENCE`; `review.forMake`, `review.rate` (Postgres functions); `coach_claim`, `coach_save_review`, `coach_save_outcome` (server only); tables `reviews`, `skill_points`, `coach_flags`; `packages/coach` | H7, H16 | **Built.** No review without consent (database and worker tests); every review passes the contract, the deterministic guardrails and a model check, with one rewrite, else a lesson. Left: run `npm run coach -- eval` on the mentors' test set |
| A5 | Safety scan | `ScanResult`, `SafetyLabel`, `SAFETY_THRESHOLDS`, `decideScan`, `ScanClaim`; `scan_claim`, `scan_save`, `scan_pending` (server only); tables `safety_scans`, `safety_queue`; `packages/safety` | H8 (safety card) | **Built.** Test hashes always blocked (and never sent on to the classifier); flagged items and coach concerns reach `safety_queue`; the database refuses `reviewing` without a passing scan. Left: choose the hash-matching and classifier vendors and add their adapters |
| A6 | Quest writer agent | `QuestWeekDraft`, `questRuleProblems`, `weekRuleProblems`; `save_quest_week`, `approve_quest_week`, `reject_quest_week`, `weeks_to_draft`, `recent_quest_titles` (server only); table `quest_weeks`; `packages/quests` | — | **Built.** Drafts a week per zone with zero rule problems (one rewrite, never saved with problems); an approved week is scheduled Monday to Sunday, with a repeat quest every fourth week. Left: the admin approval screen (A11) and the mentors' curriculum |
| A7 | Portfolio, skills, levels | `levelFor`, `levelledUp`, `skillScore`, `ZoneLevel`, `StudioPage`, `NewPostcard`; `levels.get`, `studio.list`, `postcards.new/seen/pick`, `make.delete` (Postgres functions); view `zone_progress`, table `postcards` | H12, H13, H18 | **Built.** Points are quests finished plus coach skill points (R32); level-ups follow `levelFor` (database parity test); a postcard at each level reached, made by the database |
| A8 | Family share and parent page | `Cheer`, `FamilyStatus`, `ParentFeedItem`, `ParentOverview`; `family.share`, `family.status`, `family.cheer`, `parent.preview`, `parent.consent`, `parent.feed`, `parent.overview`, `parent.weeklyEmail` (Postgres functions); tables `family_shares`, `family_cheers`; `apps/parent` | H17, H19, H24, H25 | **Built.** A parent sees only the makes sent to them, only while linked, and can send one of five cheers per make; consent needs the parent to confirm they're an adult. Left: the card check (A9), the evening drop's family cheers (A10) |
| A9 | Plus and payments | `PLUS`, `canBuyInApp`, `EntitlementEvent`, `fromRevenueCat`, `fromStripe`, `PlusStatus`; `plus.status`, `parent.plus` (Postgres functions); `plus.checkout`, `plus.portal` (edge function `payments`); tables `entitlements`, `entitlement_events`, `billing_customers`; `packages/payments` | H25 | **Built.** Buy, renew, cancel and refund tested for App Store, Google Play and the web, each event applied once; under-18s buy only through a linked parent. Left: Stripe and RevenueCat accounts, sandbox runs, and the in-app purchase screen for 18–19s |
| A10 | Evening drop and notifications | `NotificationPrefs`, `inQuietHours`, `dropDue`, `dropMessage`, `Drop`; `drop.get`, `notifications.prefs`, `push.register` (Postgres functions); tables `notification_prefs`, `push_tokens`, `drops`; `packages/notify` | H11, H19 | **Built.** Tested with the real job and a fake clock: the drop arrives at 8 pm local in Tokyo, Kathmandu and Los Angeles, once each, and never in quiet hours. Left: an EAS project id, and pushes on real phones |
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
- **A3 capture and upload:** built on branch `a3-capture` (on top of `a2-today`).
  The phone uploads the cleaned photo to `makes/<teen>/<make>.jpg`, then calls
  `record_make`, which checks the quest was open on the day the photo was taken
  (up to 48 hours earlier, for photos taken offline). The app can't insert makes
  directly. Left: try the camera and picker on real phones.
- **A4 coach agent:** built on branch `a4-coach` (on top of `a3-capture`). The worker
  reviews makes in `reviewing`; set that status in A5 once the scan passes.
- **A5 safety scan:** built on branch `a5-safety` (on top of `a4-coach`). It fails
  closed: with no vendors set up, nothing is scanned and nothing reaches the coach.
  It also strips any metadata the phone missed from the stored copy.
- **A6 quest writer:** built on branch `a6-quests` (on top of `a5-safety`).
- **A7 portfolio and levels:** built on branch `a7-levels` (on top of `a6-quests`).
  Studio and Levels tabs, the level-up postcard, and deleting a make.
- **A8 family and parent page:** built on branch `a8-family` (on top of `a7-levels`).
  The teen's "Send to family" sheet, and `apps/parent` (consent and parent page).
- **A9 Plus:** built on branch `a9-plus` (on top of `a8-family`). Still open: the card
  check for consent (a $0 Stripe SetupIntent, recorded as `parents.adult_check =
  'card_verified'`) and the in-app purchase screen.
- **A10 evening drop:** built on branch `a10-drop` (on top of `a9-plus`).
- **For A11:** list draft weeks from `quest_weeks` with their quests; approve with
  `approve_quest_week(week_id, staff)` or reject with `reject_quest_week`.
- **For A11 (safety):** the admin reads `safety_queue` (open items have no `resolved_at`) and
  resolves them; releasing a held photo means a `pass` scan, then `reviewing`.
- **For A12:** Expo's template adds `SYSTEM_ALERT_WINDOW` (used by the dev menu);
  consider blocking it in release builds.
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
- No make reaches the coach (`reviewing`) without a passing safety scan.
- No coach review is saved without the teen's consent (and a parent's for under-18s).
- Deleting an account removes the teen's data and keeps the deletion record.
