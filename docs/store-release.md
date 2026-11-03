# Store release (A12)

Everything needed to put Quest into internal testing on the App Store and
Google Play, then release it. Answers below follow what the code actually does;
if a package changes what data it keeps or sends, update this file and the
labels in the store consoles together. `apps/mobile/src/release.test.ts` fails
if the app's privacy and permission settings drift from what's written here.

## 1. Accounts and IDs (needs you)

| What | Where | Then |
|---|---|---|
| Apple Developer Program (organisation) | developer.apple.com | Note the Team ID |
| App Store Connect app record | App Store Connect → Apps → + | Note the Apple ID (ascAppId) |
| Google Play developer account (organisation) | play.google.com/console | Create the app; pick the default language and "App", "Free" |
| Expo account and project | `cd apps/mobile && npx eas init` | Writes `extra.eas.projectId` into `app.json` (push notifications need it) |
| Bundle ID and package name | `apps/mobile/app.json` | Replace `com.example.quest` in both places with your own reverse domain. It can't change after the first upload |
| App name | `app.json` → `name` | "Quest" is a working name: check it's free on both stores before the record is made |

Build-time settings live in EAS environment variables (`eas env:create`), per
environment (development, preview, production):

```
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
EXPO_PUBLIC_PARENT_SITE_URL
```

Only the anon key goes in the app. The service role key, Anthropic, Stripe and
RevenueCat secrets stay in Supabase function secrets.

## 2. Internal testing

```sh
cd apps/mobile
npx eas build --profile production --platform all     # build numbers count up on EAS
npx eas submit --profile production --platform ios     # to TestFlight
npx eas submit --profile production --platform android # to the internal testing track, as a draft
```

- **iOS:** in App Store Connect → TestFlight, add an internal group (up to 100
  people on your team). Internal testers don't need Beta App Review.
- **Android:** Google needs the **first** upload done by hand: download the
  `.aab` from the EAS build page and upload it in Play Console → Testing →
  Internal testing. After that, `eas submit` works (it needs a Google service
  account key, see Expo's "Submit to Google Play" guide). Add testers by email
  list and share the opt-in link.
- Use the `preview` profile for quick installs on team phones (an `.apk` on
  Android, ad-hoc on registered iPhones).

What to check on real phones before going wider (the parts no test here can
reach): both sign-ins, the store age signals (A1), the camera and photo picker
(A3), pushes at drop time (A10), Download my work and Delete my account (A11).

## 3. Store listing

**Name:** Quest (working name) · **Subtitle** (App Store, 30 characters): A daily creative quest

**Short description** (Google Play, 80 characters):
One short creative quest a day, with coaching that helps you get better.

**Description:**

> One short creative quest a day, in the zones you pick: Photography, Fashion,
> and Art and crafts. Make it, snap it, and get coaching on what worked and
> one thing to try next.
>
> - Quests take 5 to 20 minutes, and a new one arrives every day at midnight.
> - The coach talks about technique: light, colour, framing, story. Never
>   about how anyone looks.
> - Your Studio keeps everything you make. Nobody else sees it unless you send
>   a piece to family.
> - Level up your skills in each zone and collect a postcard at every level.
> - An evening drop sums up your day. Never during quiet hours.
>
> No feed, no likes, no followers, no messages. For ages 13 to 19; under-18s
> need a parent to say yes before the coach can see their work.

**Keywords** (App Store, 100 characters):
`creative,photography,fashion,art,crafts,daily,challenge,skills,portfolio,coach,practice,teen`

**Category:** Photo & Video (primary), Education (secondary).
**Support URL, privacy policy URL, marketing URL:** needed on both stores.
The privacy policy must cover everything in section 4, the 30-day deletion
promise and its one exception (evidence kept for a safety report).

**Screenshots:** 6.9" iPhone (1320 × 2868) and Android phone. Suggested set:
Today (H15), the camera (H6), a coach review (H7), Studio (H12), Levels (H13),
the evening drop (H19). Use test accounts and test photos only.

**App Review notes** (App Store) / **App access** (Play): a demo account that's
18–19 (no parent step) with a quest already made, and a line on how the parent
consent works for under-18s. Reviewers can't receive the parent email. Say
that Plus is free for 13–15s and sold in the app to 16+, and that the demo
account can buy it with a sandbox tester.

## 4. Privacy labels

What the app and its backend keep, and why. Nothing is used for tracking or
advertising, and no data is sold. Every type below is **linked to the user**
and used for **app functionality** only.

| Data | What exactly | Apple label | Google Play data safety |
|---|---|---|---|
| Email address | From Apple or Google sign-in (Apple may give a relay address) | Contact Info → Email Address | Personal info → Email address |
| User ID | The account id | Identifiers → User ID | Personal info → User IDs |
| Photos | The photos teens make for quests (location and camera data removed on the phone) | User Content → Photos or Videos | Photos and videos → Photos |
| Other user content | Coach review ratings ("helpful"), family cheers | User Content → Other User Content | App activity → Other user-generated content |
| Purchase history | Whether Plus is on, and until when | Purchases → Purchase History | Financial info → Purchase history |
| Other | Age group (13–15, 16–17, 18–19) and the month it changes, country, time zone | Other Data → Other Data Types | Personal info → Other info |

The same list is in the iOS privacy manifest (`app.json` → `ios.privacyManifests`).

- **Not collected:** location, contacts, browsing, search, health, diagnostics
  or crash data, advertising ID (blocked on Android), audio, name, birthday
  (only the age group and the month it changes are kept), anything from other apps.
- **Google Play extra answers:** data is encrypted in transit: yes. Users can
  ask for deletion: yes, in the app and at `<parent site>/delete`. Data shared
  with third parties: no; the services below process data for us as service
  providers, which Play doesn't count as sharing.
- **Service providers:** Supabase (database, sign-in, photo storage), Anthropic
  (the coach reads the photo and quest to write a review; teens' yes and, under
  18, a parent's, are asked for first), the child-safety scan vendors (to be
  chosen, A5), Expo (push delivery), Stripe and RevenueCat (Plus payments).
  Check each one's data-processing terms before launch, including that
  Anthropic API inputs aren't used for training under your agreement.

## 5. Age ratings

**App Store** (the age rating questionnaire): no violence, sexual content,
profanity, drugs, gambling, horror or medical content; no unrestricted web
access; no messaging or chat; user-generated photos exist but are private (no
public sharing, no feed, no contact between users); an AI coach writes
feedback on photos. Set the app's minimum age to 13. Expected result: 13+.
Don't choose the Kids category (that's for under 12s).

**Google Play** (IARC questionnaire): same answers; users can't interact or
exchange content with each other (sharing is only to a linked parent, one way,
with fixed cheers back); there are digital purchases (Plus). Expected result:
Everyone or Teen depending on region, with "In-app purchases".

**Google Play target audience:** 13–15, 16–17 and 18+. Because it includes
under-18s: no ads (there are none), and the teen-appropriate content
requirements apply. It doesn't include under-13s, so the Families policy's
child requirements don't, but the app stops under-13s at sign-up and deletes
what they entered (A1).

## 6. Policy points reviewers check

- **Account deletion** (Apple 5.1.1(v), Google Play): in the app (You → Delete
  my account) and on the web at `/delete`. Put that URL in Play Console → App
  content → Data deletion.
- **Sign in with Apple** is offered next to Google on iOS (4.8).
- **Minors and consent:** under-18s need a parent's yes before photos go to
  the coach; the database enforces it (A1, `private.coach_allowed`).
- **Safety:** every photo is checked before anyone sees it, known abuse
  imagery is blocked and reported (A5, `docs/operations.md`).
- **Plus and in-app purchase (decided).** 13–15s get Plus free, so they're
  never sold anything. 16+ pay, and Plus is sold in the app (App Store and
  Google Play, through RevenueCat), as Apple asks for a subscription the app
  unlocks (3.1.3(b)). A 16–17 taps "Ask my parent"; a linked parent says yes
  or not now on the parent page, and only after a yes (valid 7 days) does the
  app show "Start Plus". A parent can also buy it on the parent page. 18–19s
  need nobody's yes. The app never points to buying anywhere else. The Plus
  screen shows the store's price, the renewal terms, "Restore purchases", and
  links to the terms of use and privacy policy, as both stores require.
- **Age groups move up.** For teens who give a birth month and year, the
  month their age group ends is kept (not the birth date, though together
  with the group it shows the birth month and year); a daily job moves them
  up then. Teens placed by their app store are asked the store again every
  6 months. Teens stay in 18–19 after they turn 20 and keep their account
  (new sign-ups over 19 are still stopped). The privacy policy should say this.

## 7. Release checklist

- [ ] Bundle ID, package name and app name set; `eas init` run
- [ ] Final app icon and splash from design (the current ones are placeholders: a dark Q on lime)
- [ ] EAS environment variables set for production
- [ ] Supabase production project set up (`docs/production-setup.md`)
- [ ] Privacy policy and support pages live; URLs in both consoles
- [ ] Privacy labels (section 4), age ratings (section 5) and data deletion URL entered
- [ ] Plus set up in the stores (section 8)
- [ ] Internal testing on both stores, with the real-phone checks in section 2
- [ ] Demo account for review
- [ ] Safety vendors live (A5) — the app holds every photo until they are

## 8. Selling Plus in the app (needs your accounts)

The store subscriptions, RevenueCat, and the sandbox tests are in
`docs/payments-setup.md`. Store products must exist (and the first
subscription goes to review with a build) before Plus can be bought in the app.
